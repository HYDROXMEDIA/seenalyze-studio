// Studio controller (main process): owns persisted state, accounts and
// secrets, and drives the engine worker through asynchronous calls so the app
// window never waits on the engine. Implements the StudioApi contract.

import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { app, dialog, Menu, powerSaveBlocker, screen, shell, type BrowserWindow } from "electron";
import type { Notice, StudioApi, StudioMethod } from "../shared/ipc";
import { IPC } from "../shared/ipc";
import { OVERLAY_KINDS, type DesignRequest, type DesignResult, type OverlayKind } from "../shared/overlays";
import { clampProfile, PLATFORM_SPECS } from "../shared/platforms";
import { sceneIssues } from "../shared/stream-check";
import type {
  AccountDTO,
  AdvancedStreamSettings,
  BroadcastInfo,
  DestinationConfig,
  DestinationDraft,
  DestinationStatus,
  ItemPlacement,
  Rect,
  SourceKind,
  StudioPreferences,
  StreamCheck,
  StudioSnapshot,
  VideoSettings,
} from "../shared/types";
import { ADVANCED_STREAM_RANGES, DEFAULT_ADVANCED_STREAM, RECORDING_BITRATE_RANGE, RECORDING_FORMATS, SCALE_FILTERS } from "../shared/types";
import { OutputStatsProbe } from "./output-stats";
import { EngineClient } from "./engine/client";
import { PREVIEW_DISPLAY_NAME } from "./engine/preview";
import { HotkeyManager } from "./hotkeys";
import { hotkeyProblem, isReservedHotkey, parseHotkeyAction, renameHotkeyTarget, sanitizeHotkeys, type TargetHotkeyKind } from "../shared/hotkeys";
import { DEFAULT_CAPTURE_PREFERENCES, recordingBitrate, sanitizeCapturePreferences } from "../shared/recording-prefs";
import { listMicrophones, resolveDefaultMicrophone } from "./audio-inputs";
import { sanitizeAudioChange, type AudioDeviceChoice } from "../shared/audio";
import { helperPath } from "./screen-recording/pages";
import type { LiveDestination } from "./engine/outputs";
import type { SceneCollection } from "./engine/scenes";
import type { EngineEvent, EngineState } from "./engine/worker";
import { ChatHub, type ChatAccount } from "./chat/hub";
import { openPermissionSettings, permissionSnapshot, requestPermission } from "./permissions";
import { DEFAULT_OVERLAY_PORT, OverlayServer } from "./overlay/server";
import { validateDesign } from "./overlay/design";
import { StreamDataHub } from "./overlay/data";
import { OverlayLibrary, summarize } from "./overlay/library";
import { findPreset, OVERLAY_PRESETS } from "./overlay/presets";
import type { PreviewEditorWindow } from "./preview-editor-window";
import { NativeDisplay } from "./native-display";
import { Projectors, screenChoices, type ProjectorHost } from "./projectors";
import { sanitizeProjectorTarget } from "../shared/projector";
import { ScreenRecorder } from "./screen-recording";
import { SeenalyzeAccountService } from "./seenalyze/account";
import * as twitch from "./platforms/twitch";
import { forgetToken, readToken } from "./platforms/tokens";
import * as youtube from "./platforms/youtube";
import { deleteSecret, getSecret, hasSecret, secretNames, setSecret } from "./secrets";
import { debounced, readJson, writeJson } from "./store";
import { CollectionFiles, migrateWorkspace, type WorkspaceFields } from "./collections";
import { Workspace } from "./workspace";
import { findImportCandidates, importRoots, readImportCandidate, readImportFile, type ConvertedCollection } from "./obs-import";
import { DEFAULT_AUDIO_FORMAT, sanitizeVideoFormat, type AudioFormat } from "../shared/formats";
import { availablePresets, isStingerPath, parseTransition, sanitizeTransition, STINGER_EXTENSIONS, type TransitionChoice } from "../shared/transitions";
import { virtualCameraAvailability, virtualCameraScene, type VirtualCameraProbe } from "../shared/virtual-camera";
import { sanitizePlacement, sanitizeTransformPatch } from "../shared/transform-geometry";
import { isEffectKind, sanitizeEffectSnapshots } from "../shared/video-effects";

type AccountRecord =
  | ({ platform: "twitch" } & twitch.TwitchAccount & { login?: string })
  | ({ platform: "youtube" } & youtube.YouTubeAccount);

/** Workspace fields: scene collection list, profiles and audio formats (see collections.ts). */
interface PersistedState extends WorkspaceFields {
  version: 1;
  video: VideoSettings;
  encoder: string | null;
  recordingFolder: string | null;
  preferences: StudioPreferences;
  destinations: DestinationConfig[];
  broadcastInfo: Record<string, BroadcastInfo>;
  accounts: AccountRecord[];
  collection: SceneCollection | null;
  overlayPort: number;
  transition: TransitionChoice;
  /** Global hotkey combos by action (see shared/hotkeys.ts). */
  hotkeys: Record<string, string>;
  /** Stream delay and reconnect behaviour (Settings › Advanced). */
  advanced: AdvancedStreamSettings;
  /** First-run setup finished or skipped. Missing in older files, which count as set up. */
  setupCompleted: boolean;
  /** Headphones for audio monitoring; null follows the system default. */
  monitoringDevice: string | null;
  /** Scene the virtual camera shows; null shows the program output. */
  virtualCamera: { scene: string | null };
  /** Studio mode (preview and program side by side). Missing in older files: off. */
  studioMode: boolean;
}

interface YouTubeBroadcast {
  accountId: string;
  broadcastId: string;
  wentLive: boolean;
}

const STATE_FILE = "studio.json";

/** Starting size for AI-designed overlays of each kind (1080p canvas pixels). */
const DESIGN_SIZES: Record<OverlayKind, { width: number; height: number }> = {
  chat: { width: 440, height: 720 },
  alert: { width: 900, height: 400 },
  goal: { width: 760, height: 140 },
  eventList: { width: 420, height: 400 },
  viewerCount: { width: 420, height: 100 },
  label: { width: 900, height: 220 },
  ticker: { width: 1920, height: 80 },
  countdown: { width: 480, height: 200 },
  timer: { width: 360, height: 100 },
  socials: { width: 520, height: 100 },
  scene: { width: 1920, height: 1080 },
  custom: { width: 800, height: 600 },
};
/** Far off-screen coordinate for a parked (covered) preview surface. */
const PREVIEW_PARK_OFFSET = -20000;
/** The studio-mode preview's display (the program keeps PREVIEW_DISPLAY_NAME). */
const STUDIO_DISPLAY_NAME = "seenalyze-studio-preview";
/** Studio mode switched: longer than the page's 80 ms wait before it reports the new layout. */
const STUDIO_LAYOUT_FALLBACK_MS = 300;

const DEFAULT_VIDEO: VideoSettings = {
  baseWidth: 1920,
  baseHeight: 1080,
  outputWidth: 1920,
  outputHeight: 1080,
  fps: 30,
  scaleFilter: "bicubic",
};

const DEFAULT_PREFERENCES: StudioPreferences = {
  recordingFormat: "mkv",
  recordingBitrateKbps: 12000,
  confirmGoLive: false,
  confirmEndStream: true,
  keepAwakeWhileLive: true,
  ...DEFAULT_CAPTURE_PREFERENCES,
};

const ACTIVE_STATES = new Set(["preparing", "connecting", "live", "reconnecting", "stopping"]);

export class Studio {
  private state: PersistedState;
  private readonly engine = new EngineClient();
  private engineState: EngineState | null = null;
  private engineErrorKey: string | undefined;
  private readonly statuses = new Map<string, DestinationStatus>();
  private readonly youtubeBroadcasts = new Map<string, YouTubeBroadcast>();
  private readonly preparations = new Map<string, { cancelled: boolean }>();
  /** The program; in studio mode it moves to the program rect. */
  private readonly programDisplay: NativeDisplay;
  /** The editable studio-mode preview (shows `previewScene`). */
  private readonly studioDisplay: NativeDisplay;
  /** Where the program goes in studio mode (window points), or null. */
  private programRect: Rect | null = null;
  /** Scene in the studio-mode preview. */
  private previewScene: string | null = null;
  private readonly projectors: Projectors | null;
  private previewRect: Rect | null = null;
  /** Floating UI covers the preview: keep the surface but park it off-screen. */
  private previewHidden = false;
  private previewQueue: Promise<void> = Promise.resolve();
  /**
   * The window's backing scale, from the renderer's devicePixelRatio (0 until
   * reported). It changes only once the window has really moved to a screen
   * with another scale, unlike the screen under the window's bounds, which
   * changes mid-drag.
   */
  private previewScale = 0;
  /** Selected scene item, shared by the main window and the preview editor. */
  private selectedItemId: number | null = null;
  /** Undo/redo steps for canvas edits (move, resize, rotate, crop, presets). */
  private readonly canvasPast: CanvasEdit[] = [];
  private readonly canvasFuture: CanvasEdit[] = [];
  /** Placement at the start of each live drag, keyed by scene and item. */
  private readonly dragStarts = new Map<string, ItemPlacement>();
  /** Canvas edits and undo steps run one at a time, in order. */
  private canvasQueue: Promise<unknown> = Promise.resolve();
  private twitchSignIn: AbortController | null = null;
  private readonly chat = new ChatHub({
    accounts: () => this.state.accounts as ChatAccount[],
    twitchLogin: async (account) => {
      const login = await twitch.twitchLogin(account);
      const record = this.state.accounts.find((entry) => entry.id === account.id);
      if (record?.platform === "twitch" && record.login !== login) {
        record.login = login;
        this.persist();
      }
      return login;
    },
    emit: (event) => this.send(IPC.chat, event),
  });
  private readonly library = new OverlayLibrary(path.join(app.getPath("userData"), "overlays"));
  private readonly overlayData = new StreamDataHub(this.chat, () => this.state.accounts as ChatAccount[], () => this.pushSnapshot());
  private readonly overlay = new OverlayServer(this.chat, {
    get: (id) => this.library.get(id),
    preset: (id) => findPreset(id),
    subscribe: (listener) => this.overlayData.subscribe(listener),
  });
  readonly account = new SeenalyzeAccountService();
  readonly screenRecorder = new ScreenRecorder({
    recordingFolder: () => this.recordingFolder(),
    setRecordingFolder: (folder) => {
      this.state.recordingFolder = folder;
      this.persist();
      this.pushSnapshot();
    },
    ensureScreenAccess: async () => {
      const state = await requestPermission("screen");
      this.pushSnapshot();
      return state === "granted" || state === "unsupported";
    },
    onStateChange: () => this.pushSnapshot(),
  });
  private shuttingDown = false;
  private readonly persist = debounced(() => {
    if (this.shuttingDown) return;
    this.saveNow().catch((error: unknown) => console.error("[studio] could not save", error));
  }, 400);
  private readonly pushSnapshot = debounced(() => {
    this.projectors?.refresh();
    this.syncKeepAwake();
    this.send(IPC.snapshot, this.snapshot());
  }, 30);
  private keepAwakeId: number | null = null;
  private readonly hotkeys = new HotkeyManager(
    { trigger: (action) => this.runHotkey(action), hold: (action, down) => this.holdHotkey(action, down) },
    () => this.pushSnapshot(),
  );
  /** The running recording was started by going live (auto-record). */
  private autoRecording = false;
  private readonly outputStats = new OutputStatsProbe();
  /** Last virtual camera check; null until the engine has been asked. */
  private virtualCameraProbe: VirtualCameraProbe | null = null;
  /** Scene collections and profiles; switching restarts the engine (see workspace.ts). */
  private readonly workspace: Workspace;
  /** Audio format the running engine reported. */
  private engineAudioFormat: AudioFormat | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly quit: () => void,
    private readonly editor: PreviewEditorWindow | null = null,
    projectorPages: Pick<ProjectorHost, "preload" | "load" | "isAppUrl"> | null = null,
  ) {
    this.state = this.loadState();
    this.workspace = new Workspace({
      state: this.state,
      files: new CollectionFiles(path.join(app.getPath("userData"), "scene-collections")),
      locked: () => this.busy || Boolean(this.engineState?.virtualCameraActive),
      stopEngine: () => this.stopEngineForReload(),
      startEngine: () => this.startEngineAfterReload(),
      captureCollection: async () => {
        if (this.engine.running && this.engineState) this.state.collection = await this.engine.call("saveCollection");
      },
      applyVideo: (video) => this.api.setVideoSettings(video),
      writeState: () => writeJson(STATE_FILE, this.state),
      settingsChanged: async () => {
        this.ensureEncoder();
        await this.syncReplay();
        this.pushSnapshot();
      },
      pushSnapshot: () => this.pushSnapshot(),
      sanitizeVideo,
      sanitizePreferences,
      sanitizeAdvanced,
      sanitizeProfile: (platform, profile) => clampProfile(platform, profile),
      defaults: { video: DEFAULT_VIDEO, preferences: DEFAULT_PREFERENCES, advanced: DEFAULT_ADVANCED_STREAM },
    });
    this.programDisplay = new NativeDisplay(this.engine, window, PREVIEW_DISPLAY_NAME, null);
    this.studioDisplay = new NativeDisplay(this.engine, window, STUDIO_DISPLAY_NAME, { kind: "studioPreview" });
    this.projectors = projectorPages
      ? new Projectors({
          ...projectorPages,
          engine: this.engine,
          context: () => this.projectorContext(),
          pickScene: (name) => this.api.setActiveScene(name),
        })
      : null;
    this.engine.on("event", (event: EngineEvent) => this.onEngineEvent(event));
    this.engine.on("crash", () => this.onEngineCrash());
    window.on("minimize", () => this.applyDisplays(true));
    window.on("restore", () => this.applyDisplays());
    window.on("focus", () => this.hotkeys.recheckInputAccess());
    // The editor window shows its own snapshot once it has loaded.
    editor?.window.webContents.on("did-finish-load", () => this.pushSnapshot());
  }

  // ----- lifecycle ----------------------------------------------------------

  async start(): Promise<void> {
    try {
      await this.screenRecorder.start();
    } catch (error) {
      console.error("[studio] screen recording failed to start", error);
    }
    try {
      const port = this.overlay.running ? this.state.overlayPort : await this.overlay.start(this.state.overlayPort);
      if (port !== this.state.overlayPort) {
        this.state.overlayPort = port;
        this.persist();
      }
    } catch (error) {
      console.error("[studio] overlay server failed to start", error);
    }
    try {
      await this.engine.start({
        vendorRoot: vendorRoot(),
        dataDir: app.getPath("userData"),
        appVersion: app.getVersion(),
        video: this.state.video,
        collection: this.state.collection,
        // A stinger whose video was moved or deleted cannot play; fall back to the default.
        transition: stingerFileOk(this.state.transition) ? this.state.transition : sanitizeTransition(null),
        defaultMicrophone: await resolveDefaultMicrophone(helperPath("audio-inputs")),
        monitoringDevice: this.state.monitoringDevice ?? undefined,
        audioFormat: this.state.audioFormat ?? undefined,
      });
      // Saved chat overlays follow the overlay server if its port changed.
      await this.engine.call("retargetChatOverlays", `http://127.0.0.1:${this.state.overlayPort}`);
      await this.refreshState();
      this.engineAudioFormat = await this.engine.call("audioFormat").catch(() => null);
      this.ensureEncoder();
      await this.syncReplay();
      void this.probeVirtualCamera();
      if (this.engineState?.unavailableSourceCount) this.notify({ kind: "info", key: "notices.sourcesUnavailable" });
    } catch (error) {
      console.error("[studio] engine failed to start", error);
      this.engineErrorKey = errorKey(error) === "generic" ? "engine-init-failed" : errorKey(error);
    }
    this.pushSnapshot();
  }

  get busy(): boolean {
    return Boolean(this.engineState?.recording.active || [...this.statuses.values()].some((status) => ACTIVE_STATES.has(status.state)));
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.hotkeys.dispose();
    this.twitchSignIn?.abort();
    for (const preparation of this.preparations.values()) preparation.cancelled = true;
    this.overlay.stop();
    this.overlayData.stopAll();
    this.chat.stopAll();
    try {
      await this.saveNow();
    } catch (error) {
      console.error("[studio] could not save before quitting", error);
    }
    await this.projectors?.closeAll().catch((error: unknown) => console.error("[studio] projectors did not close cleanly", error));
    this.programDisplay.reset();
    this.studioDisplay.reset();
    try {
      await this.screenRecorder.shutdown();
    } catch (error) {
      console.error("[studio] screen recording did not stop cleanly", error);
    }
    await this.engine.shutdown();
  }

  // ----- API ----------------------------------------------------------------

  readonly api: Pick<StudioApi, StudioMethod> = {
    getSnapshot: async () => this.snapshot(),

    createScene: async (name) => this.mutate(() => this.engine.call("createScene", name)),
    removeScene: async (name) => {
      await this.projectors?.closeShowing("scene", name);
      // The preview moves off the scene first, to the program or the next scene.
      if (this.state.studioMode && this.previewScene === name) {
        const program = this.engineState?.activeScene;
        const fallback = program && program !== name ? program : this.engineState?.scenes.find((scene) => scene.name !== name)?.name;
        if (fallback) await this.setPreviewScene(fallback);
      }
      await this.mutate(() => this.engine.call("removeScene", name));
      if (this.state.virtualCamera.scene === name) await this.api.setVirtualCameraScene(null);
    },
    renameScene: async (name, nextName) => {
      // The preview keeps showing the same scene object; only its name changes.
      const previewing = this.previewScene === name;
      if (previewing) this.previewScene = String(nextName).trim();
      try {
        await this.mutate(() => this.engine.call("renameScene", name, nextName));
      } catch (error) {
        if (previewing) this.previewScene = name;
        throw error;
      }
      this.renameHotkeys(["scene"], name, nextName);
      if (this.state.virtualCamera.scene === name) await this.api.setVirtualCameraScene(nextName.trim());
    },
    // In studio mode a scene loads into the preview; Transition sends it to the program.
    setActiveScene: async (name) => (this.state.studioMode ? this.setPreviewScene(String(name)) : this.mutate(() => this.engine.call("setActiveScene", name))),
    setStudioMode: async (enabled) => {
      const next = Boolean(enabled);
      if (next === this.state.studioMode) return;
      this.state.studioMode = next;
      this.persist();
      // The edited scene can change; its selection does not carry over.
      this.selectedItemId = null;
      this.previewScene = next ? (this.engineState?.activeScene ?? null) : null;
      await this.syncStudioPreview();
      this.pushSnapshot();
      // The page lays the canvases out again and reports their new rects,
      // which places the displays; this only covers an unchanged layout.
      setTimeout(() => {
        if (!this.window.isDestroyed() && !this.window.isMinimized()) this.applyDisplays();
      }, STUDIO_LAYOUT_FALLBACK_MS);
    },
    studioTransition: async (quick) => {
      const scene = this.state.studioMode ? this.previewScene : null;
      if (!scene || !this.engineState?.scenes.some((entry) => entry.name === scene)) return;
      await this.mutate(() => (quick === "cut" ? this.engine.call("cutToScene", scene) : this.engine.call("setActiveScene", scene)));
    },
    listScreens: async () => screenChoices(),
    openProjector: async (target, screenId) => {
      const clean = sanitizeProjectorTarget(target);
      if (!clean || (screenId !== null && typeof screenId !== "number")) throw new Error("invalid-request");
      if (!this.projectors) throw new Error("invalid-request");
      this.projectors.openProjector(clean, screenId);
    },
    setTransition: async (choice) => {
      // A stinger without a usable file is an error, not a silent switch to Fade.
      if (choice?.id === "stinger" && !parseTransition(choice)) throw new Error("stinger-file-invalid");
      const clean = sanitizeTransition(choice);
      if (!stingerFileOk(clean)) throw new Error("stinger-file-missing");
      await this.engine.call("setTransition", clean);
      this.state.transition = clean;
      this.persist();
      this.pushSnapshot();
    },
    setSceneTransition: async (scene, choice) => {
      const clean = choice === null ? null : parseTransition(choice);
      if (choice !== null && !clean) throw new Error("invalid-request");
      if (clean && !stingerFileOk(clean)) throw new Error("stinger-file-missing");
      await this.mutate(() => this.engine.call("setSceneTransition", String(scene), clean));
    },
    pickStingerFile: async () => {
      const result = await dialog.showOpenDialog(this.window, {
        properties: ["openFile"],
        filters: [{ name: "Video", extensions: [...STINGER_EXTENSIONS] }],
      });
      const file = result.canceled ? undefined : result.filePaths[0];
      if (!file) return null;
      if (!isStingerPath(file) || !isFile(file)) throw new Error("stinger-file-invalid");
      const durationMs = await this.engine.call("mediaDurationMs", file);
      return { path: file, durationMs };
    },

    checkVirtualCamera: async () => {
      await this.probeVirtualCamera();
    },
    installVirtualCamera: async () => {
      const probe = await this.probeVirtualCamera();
      if (!probe?.supported || !probe.canInstall) throw new Error("virtual-camera-unavailable");
      if (probe.installed) return;
      // The system approval prompt waits for the user.
      this.virtualCameraProbe = await this.engine.callWithTimeout(5 * 60_000, "installVirtualCamera");
      this.pushSnapshot();
      // macOS finishes the install only after the user approves it in System Settings.
      if (!this.virtualCameraProbe.installed) throw new Error("virtual-camera-approval-needed");
    },
    startVirtualCamera: async () => {
      const probe = this.virtualCameraProbe?.installed ? this.virtualCameraProbe : await this.probeVirtualCamera();
      if (!probe?.supported) throw new Error("virtual-camera-unavailable");
      if (!probe.installed) throw new Error("virtual-camera-not-installed");
      const scene = virtualCameraScene(this.state.virtualCamera.scene, this.engineState?.scenes.map((entry) => entry.name) ?? []);
      await this.mutate(() => this.engine.call("startVirtualCamera", scene));
    },
    stopVirtualCamera: async () => {
      await this.mutate(() => this.engine.call("stopVirtualCamera"));
    },
    setVirtualCameraScene: async (scene) => {
      const names = this.engineState?.scenes.map((entry) => entry.name) ?? [];
      if (scene !== null && !names.includes(String(scene))) throw new Error("scene-not-found");
      const clean = virtualCameraScene(scene, names);
      this.state.virtualCamera = { scene: clean };
      this.persist();
      this.pushSnapshot();
      if (this.engine.running && this.engineState) await this.engine.call("setVirtualCameraScene", clean);
    },

    addSource: async (scene, kind, name) => {
      await this.ensureCapturePermission(kind);
      const settings = kind === "chatOverlay" ? { url: this.overlay.chatUrl } : undefined;
      return this.mutate(() => this.engine.call("addSource", scene, kind, name, settings));
    },
    listSourceChoices: async (scene) => this.engine.call("listSourceChoices", scene),
    addExistingSource: async (scene, source) => this.mutate(() => this.engine.call("addExistingSource", scene, source)),
    removeSceneItem: async (scene, itemId) => this.mutate(() => this.engine.call("removeSceneItem", scene, itemId)),
    setItemVisible: async (scene, itemId, visible) => this.mutate(() => this.engine.call("setItemVisible", scene, itemId, visible)),
    setItemLocked: async (scene, itemId, locked) => this.mutate(() => this.engine.call("setItemLocked", scene, itemId, locked)),
    moveSceneItem: async (scene, itemId, direction) => this.mutate(() => this.engine.call("moveSceneItem", scene, itemId, direction)),
    applyTransform: async (scene, itemId, preset) => this.canvasEdit(scene, itemId, () => this.engine.call("applyTransform", scene, itemId, preset)),
    patchItemTransform: async (scene, itemId, patch, commit) => {
      const clean = sanitizeTransformPatch(patch);
      const key = `${scene}\u0000${itemId}`;
      // Live drag updates only touch the engine; the drag end refreshes, saves
      // and records the whole drag as one undo step.
      if (!commit) {
        return this.inCanvasQueue(async () => {
          if (!this.dragStarts.has(key)) this.dragStarts.set(key, await this.engine.call("getItemPlacement", scene, itemId));
          await this.engine.call("patchItemTransform", scene, itemId, clean);
        });
      }
      return this.canvasEdit(scene, itemId, () => this.engine.call("patchItemTransform", scene, itemId, clean), key);
    },
    undoCanvas: async () => this.inCanvasQueue(() => this.stepCanvas("undo")),
    redoCanvas: async () => this.inCanvasQueue(() => this.stepCanvas("redo")),
    setSelectedItem: async (scene, itemId) => {
      const next = typeof itemId === "number" && Number.isInteger(itemId) ? itemId : null;
      if (next !== this.selectedItemId) {
        this.selectedItemId = next;
        this.pushSnapshot();
      }
      if (!this.engine.running || !this.engineState) return;
      await this.engine.call("setSelectedItem", scene, typeof itemId === "number" ? itemId : null);
    },
    getItemTransform: async (scene, itemId) => this.engine.call("getItemTransform", scene, itemId),
    setItemTransform: async (scene, itemId, transform) => this.canvasEdit(scene, itemId, () => this.engine.call("setItemTransform", scene, itemId, transform)),
    getSourceProperties: async (source) => this.engine.call("getProperties", source),
    updateSourceSettings: async (source, settings) => {
      const result = await this.engine.call("updateSettings", source, settings);
      await this.refreshState();
      this.persist();
      return result;
    },
    clickSourceButton: async (source, property) => {
      const result = await this.engine.call("clickButton", source, property);
      await this.refreshState();
      this.persist();
      return result;
    },
    renameSource: async (source, nextName) => {
      await this.mutate(() => this.engine.call("renameSource", source, nextName));
      this.renameHotkeys(["mute", "pushToTalk", "pushToMute"], source, nextName);
    },

    moveScene: async (name, direction) => this.mutate(() => this.engine.call("moveScene", String(name), direction === "up" ? "up" : "down")),
    duplicateScene: async (name) => this.mutate(() => this.engine.call("duplicateScene", String(name))),
    duplicateSceneItem: async (scene, itemId) => this.mutate(() => this.engine.call("duplicateSceneItem", String(scene), Number(itemId))),
    getItemPlacement: async (scene, itemId) => this.engine.call("getItemPlacement", String(scene), Number(itemId)),
    setItemPlacement: async (scene, itemId, placement) => {
      const clean = sanitizePlacement(placement);
      if (!clean) throw new Error("invalid-transform");
      return this.canvasEdit(String(scene), Number(itemId), () => this.engine.call("setItemPlacement", String(scene), Number(itemId), clean));
    },

    // Effects can change a source's size (crop, scaling), so edits refresh the scene state.
    listEffects: async (source) => this.engine.call("listEffects", String(source)),
    addEffect: async (source, kind) => {
      if (!isEffectKind(kind)) throw new Error("invalid-request");
      return this.mutate(() => this.engine.call("addEffect", String(source), kind));
    },
    removeEffect: async (source, effect) => this.mutate(() => this.engine.call("removeEffect", String(source), String(effect))),
    setEffectEnabled: async (source, effect, enabled) => this.mutate(() => this.engine.call("setEffectEnabled", String(source), String(effect), Boolean(enabled))),
    moveEffect: async (source, effect, direction) => this.mutate(() => this.engine.call("moveEffect", String(source), String(effect), direction === "up" ? "up" : "down")),
    getEffectProperties: async (source, effect) => this.engine.call("getEffectProperties", String(source), String(effect)),
    updateEffectSettings: async (source, effect, settings) => {
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("invalid-request");
      return this.mutate(() => this.engine.call("updateEffectSettings", String(source), String(effect), settings));
    },
    copyEffects: async (source) => this.engine.call("copyEffects", String(source)),
    pasteEffects: async (source, effects) => this.mutate(() => this.engine.call("pasteEffects", String(source), sanitizeEffectSnapshots(effects))),
    pickFile: async (filter, directory) => {
      const result = await dialog.showOpenDialog(this.window, {
        properties: [directory ? "openDirectory" : "openFile"],
        filters: directory ? undefined : parseObsFilter(filter),
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },

    setVolume: async (source, deflection) => this.mutate(() => this.engine.call("setVolume", source, deflection)),
    setMuted: async (source, muted) => {
      // Unmuting a microphone opens its device, which needs OS access first.
      if (!muted && this.engineState?.audio.find((entry) => entry.name === source)?.microphone) {
        await this.ensureCapturePermission("microphone");
      }
      return this.mutate(() => this.engine.call("setMuted", source, muted));
    },
    getAudioDetails: async (source) => this.engine.call("audioDetails", String(source)),
    changeAudio: async (source, change) => {
      const clean = sanitizeAudioChange(change);
      if (!clean) throw new Error("invalid-request");
      const details = await this.engine.call("changeAudio", String(source), clean);
      this.persist();
      return details;
    },
    listAudioDevices: async (source) => this.listAudioDevices(String(source)),
    setAudioDevice: async (source, deviceId) => {
      if (typeof deviceId !== "string" || !deviceId || deviceId.length > 512) throw new Error("invalid-request");
      return this.mutate(() => this.engine.call("setAudioDevice", String(source), deviceId));
    },
    getMonitoringDevices: async () => this.engine.call("monitoringDevices"),
    setMonitoringDevice: async (deviceId) => {
      if (typeof deviceId !== "string" || !deviceId || deviceId.length > 512) throw new Error("invalid-request");
      await this.engine.call("setMonitoringDevice", deviceId);
      this.state.monitoringDevice = deviceId === "default" ? null : deviceId;
      this.persist();
    },

    setPreviewBounds: async (rect, pixelRatio) => {
      // The renderer measures in CSS pixels and its devicePixelRatio, both
      // scaled by the page zoom; the preview works in window points and the
      // window's backing scale.
      const zoom = this.window.webContents.getZoomFactor();
      const factor = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
      this.previewRect = rect && {
        x: Math.round(rect.x * factor),
        y: Math.round(rect.y * factor),
        width: Math.round(rect.width * factor),
        height: Math.round(rect.height * factor),
      };
      if (typeof pixelRatio === "number" && Number.isFinite(pixelRatio) && pixelRatio > 0) {
        this.previewScale = Math.round((pixelRatio / factor) * 100) / 100;
      }
      if (!rect) this.previewHidden = false;
      this.syncEditor();
      if (!this.window.isMinimized()) this.applyDisplays();
    },
    setProgramBounds: async (rect, pixelRatio) => {
      // Same units as setPreviewBounds; used only in studio mode.
      const zoom = this.window.webContents.getZoomFactor();
      const factor = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
      this.programRect = rect && {
        x: Math.round(rect.x * factor),
        y: Math.round(rect.y * factor),
        width: Math.round(rect.width * factor),
        height: Math.round(rect.height * factor),
      };
      if (typeof pixelRatio === "number" && Number.isFinite(pixelRatio) && pixelRatio > 0) {
        this.previewScale = Math.round((pixelRatio / factor) * 100) / 100;
      }
      // Placed with the setPreviewBounds call that follows, so both rects
      // change together and no display is made for a size it never keeps.
    },
    setPreviewHidden: async (hidden) => {
      if (this.previewHidden === Boolean(hidden)) return;
      this.previewHidden = Boolean(hidden);
      this.syncEditor();
      if (!this.window.isMinimized()) this.applyDisplays();
    },

    showMenu: async (entries, at) =>
      new Promise<number | null>((resolve) => {
        let chosen: number | null = null;
        const menu = Menu.buildFromTemplate(
          entries.map((entry, index) =>
            entry.separator
              ? { type: "separator" as const }
              : entry.checked !== undefined
                ? { type: "checkbox" as const, checked: entry.checked === true, label: String(entry.label ?? ""), enabled: entry.enabled !== false, click: () => (chosen = index) }
                : { label: String(entry.label ?? ""), enabled: entry.enabled !== false, click: () => (chosen = index) },
          ),
        );
        // The close callback can run before the item's click; settle after both.
        menu.popup({ window: this.window, x: Math.round(at.x), y: Math.round(at.y), callback: () => setTimeout(() => resolve(chosen), 0) });
      }),

    setVideoSettings: async (settings) => {
      if (this.busy) throw new Error("settings-locked-live");
      const clean = sanitizeVideo(settings);
      await this.engine.call("applyVideo", clean);
      this.state.video = clean;
      // The preview surface is tied to the old canvas; rebuild it.
      this.applyDisplays(true);
      this.applyDisplays();
      this.projectors?.rebuild();
      await this.refreshState();
      this.persist();
    },
    setEncoder: async (encoderId) => {
      if (this.busy) throw new Error("settings-locked-live");
      if (!this.engineState?.encoders.some((encoder) => encoder.id === encoderId)) throw new Error("encoder-unavailable");
      this.state.encoder = encoderId;
      this.persist();
      this.pushSnapshot();
      await this.syncReplay();
    },
    chooseRecordingFolder: async () => {
      const result = await dialog.showOpenDialog(this.window, {
        properties: ["openDirectory", "createDirectory"],
        defaultPath: this.recordingFolder(),
      });
      if (result.canceled || !result.filePaths[0]) return null;
      this.state.recordingFolder = result.filePaths[0];
      this.persist();
      this.pushSnapshot();
      await this.syncReplay();
      return this.state.recordingFolder;
    },
    setPreferences: async (patch) => {
      const streaming = [...this.statuses.values()].some((status) => ACTIVE_STATES.has(status.state));
      if (streaming && ("confirmGoLive" in patch || "confirmEndStream" in patch || "keepAwakeWhileLive" in patch)) throw new Error("settings-locked-live");
      this.state.preferences = sanitizePreferences({ ...this.state.preferences, ...patch });
      this.persist();
      this.pushSnapshot();
      await this.syncReplay();
    },
    setAdvancedSettings: async (patch) => {
      // Applies to stream outputs, which are configured when a stream starts.
      if ([...this.statuses.values()].some((status) => ACTIVE_STATES.has(status.state))) throw new Error("settings-locked-live");
      this.state.advanced = sanitizeAdvanced({ ...this.state.advanced, ...patch });
      this.persist();
      this.pushSnapshot();
    },
    createCollection: async (name) => this.workspace.createCollection(name),
    renameCollection: async (id, name) => this.workspace.renameCollection(String(id), name),
    duplicateCollection: async (id, name) => this.workspace.duplicateCollection(String(id), name),
    removeCollection: async (id) => this.workspace.removeCollection(String(id)),
    switchCollection: async (id) => this.workspace.switchCollection(String(id)),
    createProfile: async (name) => this.workspace.createProfile(name),
    renameProfile: async (id, name) => this.workspace.renameProfile(String(id), name),
    duplicateProfile: async (id, name) => this.workspace.duplicateProfile(String(id), name),
    removeProfile: async (id) => this.workspace.removeProfile(String(id)),
    switchProfile: async (id) => this.workspace.switchProfile(String(id)),
    setOutputFormats: async (patch) => this.workspace.setFormats(patch && typeof patch === "object" ? patch : {}),
    findImports: async () => findImportCandidates(importRoots(process.platform, app.getPath("home"), app.getPath("appData")), process.platform),
    importCollection: async (candidateId, switchTo) => {
      const canvas = { width: this.state.video.baseWidth, height: this.state.video.baseHeight };
      let converted: ConvertedCollection;
      if (candidateId === null) {
        const picked = await dialog.showOpenDialog(this.window, { properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
        const file = picked.canceled ? undefined : picked.filePaths[0];
        if (!file) return null;
        converted = readImportFile(file, process.platform, canvas);
      } else {
        converted = readImportCandidate(String(candidateId), importRoots(process.platform, app.getPath("home"), app.getPath("appData")), process.platform, canvas);
      }
      const result = await this.workspace.importCollection(converted, switchTo === true);
      // The engine knows which source types are really installed.
      return result.switched && this.engineState ? { ...result, unavailableSources: this.engineState.unavailableSourceCount } : result;
    },
    completeSetup: async () => {
      if (this.state.setupCompleted) return;
      this.state.setupCompleted = true;
      this.persist();
      this.pushSnapshot();
    },

    saveDestination: async (draft) => this.saveDestination(draft),
    removeDestination: async (id) => {
      if (this.isLive(id)) throw new Error("destination-live");
      this.state.destinations = this.state.destinations.filter((destination) => destination.id !== id);
      delete this.state.broadcastInfo[id];
      deleteSecret(secretNames.streamKey(id));
      this.statuses.delete(id);
      this.persist();
      this.pushSnapshot();
    },
    setDestinationEnabled: async (id, enabled) => {
      this.requireDestination(id).enabled = enabled;
      this.persist();
      this.pushSnapshot();
    },

    connectTwitch: async () => {
      // Only one device sign-in at a time; a new request cancels the previous one.
      this.twitchSignIn?.abort();
      const controller = new AbortController();
      this.twitchSignIn = controller;
      const { prompt, done } = await twitch.beginTwitchSignIn(controller.signal);
      done
        .then((account) => {
          this.upsertAccount({ platform: "twitch", ...account });
          this.notify({ kind: "success", key: "notices.accountConnected", values: { name: account.displayName } });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.error("[studio] Twitch sign-in failed", error);
          this.notify({ kind: "error", key: `errors.codes.${errorKey(error)}` });
        })
        .finally(() => {
          if (this.twitchSignIn === controller) this.twitchSignIn = null;
        });
      return prompt;
    },
    connectYouTube: async () => {
      const account = await youtube.signInYouTube((ok) => callbackPage(ok));
      this.upsertAccount({ platform: "youtube", ...account });
      this.notify({ kind: "success", key: "notices.accountConnected", values: { name: account.displayName } });
    },
    disconnectAccount: async (accountId) => {
      const linked = this.state.destinations.filter((destination) => destination.accountId === accountId);
      if (linked.some((destination) => this.isLive(destination.id))) throw new Error("destination-live");
      const account = this.state.accounts.find((entry) => entry.id === accountId);
      const token = readToken(accountId);
      if (account && token) {
        const revoke = account.platform === "twitch" ? twitch.revokeTwitch : youtube.revokeYouTube;
        revoke(token.accessToken).catch((error: unknown) => console.error("[studio] token revoke failed", error));
      }
      forgetToken(accountId);
      this.state.accounts = this.state.accounts.filter((entry) => entry.id !== accountId);
      for (const destination of linked) {
        destination.accountId = undefined;
        destination.mode = "manual";
        destination.enabled = false;
      }
      this.chat.sync();
    this.overlayData.sync();
      this.persist();
      this.pushSnapshot();
    },
    getBroadcastInfo: async (destinationId) => {
      const destination = this.requireDestination(destinationId);
      const saved = this.state.broadcastInfo[destinationId] ?? { title: "" };
      const account = this.accountFor(destination);
      if (account?.platform === "twitch") return { ...saved, ...(await twitch.twitchBroadcastInfo(account)) };
      return { privacy: "public", ...saved };
    },
    setBroadcastInfo: async (destinationId, info) => {
      const destination = this.requireDestination(destinationId);
      const account = this.accountFor(destination);
      if (account?.platform === "twitch") await twitch.setTwitchBroadcastInfo(account, info);
      this.state.broadcastInfo[destinationId] = {
        title: info.title.trim().slice(0, 140),
        categoryId: info.categoryId,
        categoryName: info.categoryName,
        privacy: info.privacy,
      };
      this.persist();
    },
    searchCategories: async (accountId, query) => twitch.searchTwitchCategories(accountId, query),
    openExternal: async (url) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error("invalid-url");
      await shell.openExternal(parsed.toString());
    },

    goLive: async (destinationIds) => this.goLive(destinationIds),
    checkStream: async (destinationIds) => this.checkStream(destinationIds),
    endStream: async (destinationIds) => {
      for (const id of destinationIds) {
        const preparation = this.preparations.get(id);
        if (!preparation) continue;
        preparation.cancelled = true;
        const status = this.statuses.get(id);
        if (status) this.onOutputStatus({ ...status, state: "stopping" });
      }
      await this.engine.call("stopOutputs", destinationIds);
    },
    startRecording: async () => {
      const folder = this.recordingFolder();
      if (!existsSync(folder)) throw new Error("recording-folder-missing");
      await this.engine.call("startRecording", folder, this.encoderId(), {
        format: this.state.preferences.recordingFormat,
        bitrateKbps: recordingBitrate(this.state.preferences, this.state.destinations),
        shareStreamEncoder: this.state.preferences.recordingMatchStream,
        tracks: this.state.recordingTracks,
      });
      this.autoRecording = false;
      await this.refreshState();
    },
    stopRecording: async () => {
      await this.engine.call("stopRecording");
    },
    saveReplay: async () => {
      if (!this.engineState?.replay.active) throw new Error("replay-not-running");
      await this.engine.call("saveReplay");
    },
    setHotkey: async (action, combo) => {
      const parsed = parseHotkeyAction(action);
      if (!parsed) throw new Error("invalid-request");
      const next = { ...this.state.hotkeys };
      if (combo === null) delete next[action];
      else if (hotkeyProblem(action, combo) === null && !isReservedHotkey(combo, process.platform)) next[action] = combo;
      else throw new Error("hotkey-invalid");
      this.state.hotkeys = next;
      this.persist();
      this.syncHotkeys();
      this.pushSnapshot();
      // Push-to-talk starts muted; holding the key opens the microphone.
      if (combo && "target" in parsed && parsed.kind === "pushToTalk") {
        const source = this.engineState?.audio.find((entry) => entry.name === parsed.target);
        if (source && !source.muted) await this.mutate(() => this.engine.call("setMuted", parsed.target, true));
      }
    },
    setHotkeyCapture: async (active) => this.hotkeys.setCapturing(Boolean(active)),
    openInputAccessSettings: async () => this.hotkeys.openInputAccessSettings(),
    revealRecording: async () => {
      const last = this.engineState?.recording.lastFile;
      if (last && existsSync(last)) shell.showItemInFolder(last);
      else await shell.openPath(this.recordingFolder());
    },
    toggleScreenRecording: async () => {
      // Asking before the picker opens shows the system prompt or the permission dialog.
      if (!this.screenRecorder.state.active) await this.ensureCapturePermission("display");
      await this.screenRecorder.toggle();
    },
    openRecordingEditor: async () => {
      await this.screenRecorder.openEditor(this.window);
    },
    setAppearance: async (theme) => {
      if (theme !== "dark" && theme !== "light") throw new Error("invalid-request");
      this.screenRecorder.setTheme(theme);
    },
    quitApp: async () => this.quit(),
    requestPermission: async (kind) => {
      if (kind !== "camera" && kind !== "microphone" && kind !== "screen") throw new Error("invalid-request");
      const state = await requestPermission(kind);
      this.pushSnapshot();
      return state;
    },
    openPermissionSettings: async (kind) => {
      if (kind !== "camera" && kind !== "microphone" && kind !== "screen") throw new Error("invalid-request");
      await openPermissionSettings(kind);
    },
    relaunchApp: async () => {
      if (this.busy) throw new Error("destination-live");
      app.relaunch();
      this.quit();
    },
    getChat: async () => this.chat.state(),

    listOverlays: async () => this.library.list(),
    listOverlayPresets: async () =>
      OVERLAY_PRESETS.map(({ id, name, kind, description, accent, width, height }) => ({ id, name, kind, description, accent, width, height })),
    getOverlay: async (id) => this.library.require(String(id)),
    createOverlayFromPreset: async (presetId) => summarize(this.library.createFromPreset(String(presetId))),
    updateOverlay: async (id, patch) => {
      const before = this.library.require(String(id));
      const overlay = this.library.update(before.id, patch ?? {});
      if (patch?.values) this.overlay.pushSettings(overlay);
      if (overlay.width !== before.width || overlay.height !== before.height) {
        await this.engine.call("resizeOverlaySources", overlay.id, overlay.width, overlay.height);
      }
      return overlay;
    },
    resetOverlay: async (id) => {
      const overlay = this.library.reset(String(id));
      this.overlay.pushSettings(overlay);
      return overlay;
    },
    duplicateOverlay: async (id) => summarize(this.library.duplicate(String(id))),
    deleteOverlay: async (id) => this.library.remove(String(id)),
    addOverlayToScene: async (id, scene) => {
      const overlay = this.library.require(String(id));
      const settings = { url: this.overlay.overlayUrl(overlay.id), width: overlay.width, height: overlay.height, shutdown: false, restart_when_active: false };
      return this.mutate(() => this.engine.call("addSource", scene, "overlay", overlay.name, settings));
    },
    overlayPreviewUrl: async (target) => {
      if (target?.overlayId) return this.overlay.overlayUrl(this.library.require(target.overlayId).id, true);
      if (target?.presetId && findPreset(target.presetId)) return this.overlay.presetUrl(target.presetId);
      throw new Error("overlay-not-found");
    },
    designOverlay: async (request) => this.designOverlay(request),
    resetStreamSession: async () => this.overlayData.resetSession(),

    getSeenalyzeAccount: async () => {
      if (!this.account.signedIn) return null;
      try {
        return await this.account.refreshProfile();
      } catch (error) {
        if (errorKey(error) === "seenalyze-signed-out") return null;
        // Offline: fall back to the last known profile.
        return this.account.cachedProfile();
      }
    },
    signInSeenalyze: async () => {
      const profile = await this.account.signIn();
      this.window.show();
      this.window.focus();
      return profile;
    },
    signOutSeenalyze: async () => this.account.signOut(),
    setSeenalyzeLanguage: async (language) => {
      if (!this.account.signedIn) return;
      await this.account.saveLanguage(String(language));
    },
    setChatActive: async (active) => this.chat.setActive(Boolean(active)),
    restartEngine: async () => {
      if (this.engine.running && this.engineState) return;
      await this.engine.shutdown();
      this.engineErrorKey = undefined;
      for (const [id, status] of this.statuses) if (ACTIVE_STATES.has(status.state)) this.statuses.delete(id);
      this.pushSnapshot();
      await this.start();
      this.applyDisplays();
      this.projectors?.reapply();
    },
  };

  // ----- overlay designer ---------------------------------------------------

  private async designOverlay(request: DesignRequest): Promise<DesignResult> {
    const prompt = String(request?.prompt ?? "").trim();
    if (!prompt || prompt.length > 2000) throw new Error("invalid-request");
    const kind = OVERLAY_KINDS.includes(request.kind) ? request.kind : "custom";
    const existing = request.overlayId ? this.library.require(request.overlayId) : undefined;
    const { design, creditsCharged } = await this.account.design({ prompt, kind, overlayId: existing?.id }, existing);
    // The dashboard validates too; never trust a design without checking it here.
    const valid = validateDesign(design);
    if (!valid) throw new Error("design-invalid");
    if (existing) {
      const overlay = this.library.replaceDesign(existing.id, valid);
      this.overlay.reloadOverlay(overlay.id);
      return { overlay: summarize(overlay), creditsCharged };
    }
    const size = DESIGN_SIZES[kind];
    return { overlay: summarize(this.library.createFromDesign(valid, kind, size)), creditsCharged };
  }

  // ----- go live ------------------------------------------------------------

  private async checkStream(destinationIds: string[]): Promise<StreamCheck> {
    if (!this.engineState || this.shuttingDown) throw new Error("engine-not-ready");
    const ids = [...new Set(destinationIds)];
    const issues: StreamCheck["issues"] = [];
    const readyDestinationIds: string[] = [];
    for (const id of ids) {
      const destination = this.requireDestination(id);
      if (this.isLive(id)) continue;
      let key: string | undefined;
      if (destination.mode === "account") {
        const account = this.accountFor(destination);
        if (!account || !readToken(account.id)) key = "errors.codes.account-signed-out";
        else if (account.platform === "twitch" ? !twitch.twitchConfigured() : !youtube.youtubeConfigured()) key = `errors.codes.${account.platform}-not-configured`;
      } else if (!hasSecret(secretNames.streamKey(id))) key = "errors.codes.stream-key-missing";
      if (key) issues.push({ key, blocking: true, destinationId: id });
      else readyDestinationIds.push(id);
    }
    const scene = await this.engine.call("sceneReadiness");
    issues.push(...sceneIssues(scene));
    return { readyDestinationIds, scene: scene.scene, issues };
  }

  private async goLive(destinationIds: string[]): Promise<void> {
    const encoderId = this.encoderId();
    if (!this.engineState || this.shuttingDown) throw new Error("engine-not-ready");
    const targets = [...new Set(destinationIds)].map((id) => this.requireDestination(id)).filter((destination) => !this.isLive(destination.id));
    if (targets.length === 0) return;
    for (const destination of targets) {
      this.preparations.set(destination.id, { cancelled: false });
      this.onOutputStatus({ id: destination.id, state: "preparing", kbps: 0, droppedFrames: 0, totalFrames: 0, encoderGroup: null });
    }

    const resolved = await Promise.allSettled(targets.map((destination) => this.resolveIngest(destination)));
    const ready: LiveDestination[] = [];
    resolved.forEach((result, index) => {
      const destination = targets[index];
      const cancelled = this.preparations.get(destination.id)?.cancelled || this.shuttingDown || !this.engineState;
      this.preparations.delete(destination.id);
      if (cancelled) {
        this.onOutputStatus({ id: destination.id, state: "idle", kbps: 0, droppedFrames: 0, totalFrames: 0, encoderGroup: null });
        return;
      }
      if (result.status === "fulfilled") {
        ready.push(result.value);
        return;
      }
      console.error(`[studio] could not prepare ${destination.platform} destination`, result.reason);
      this.failDestination(destination.id, `errors.codes.${errorKey(result.reason)}`);
    });
    if (ready.length === 0) return;
    try {
      await this.engine.call("startOutputs", ready, encoderId, this.state.advanced);
    } catch (error) {
      console.error("[studio] outputs failed to start", error);
      for (const { config } of ready) this.failDestination(config.id, `errors.codes.${errorKey(error)}`);
      return;
    }
    await this.autoStartRecording();
  }

  private failDestination(id: string, errorKeyValue: string): void {
    this.onOutputStatus({ id, state: "error", kbps: 0, droppedFrames: 0, totalFrames: 0, encoderGroup: null, errorKey: errorKeyValue });
  }

  private async resolveIngest(destination: DestinationConfig): Promise<LiveDestination> {
    const account = this.accountFor(destination);
    const info = this.state.broadcastInfo[destination.id] ?? { title: "" };

    if (destination.mode === "account") {
      if (!account) throw new Error("account-signed-out");
      if (account.platform === "twitch") {
        if (info.title) await twitch.setTwitchBroadcastInfo(account, info);
        return { config: destination, server: twitch.TWITCH_INGEST, streamKey: await twitch.twitchStreamKey(account) };
      }
      const ingest = await youtube.youtubeIngest(account);
      if (account.streamId !== ingest.streamId) {
        account.streamId = ingest.streamId;
        this.persist();
      }
      const broadcastId = await youtube.createYouTubeBroadcast(account, ingest.streamId, info);
      this.youtubeBroadcasts.set(destination.id, { accountId: account.id, broadcastId, wentLive: false });
      return { config: destination, server: ingest.server, streamKey: ingest.streamKey };
    }

    const streamKey = getSecret(secretNames.streamKey(destination.id));
    if (!streamKey) throw new Error("stream-key-missing");
    if (!/^rtmps?:\/\/\S+$/iu.test(destination.server)) throw new Error("invalid-server");
    return { config: destination, server: destination.server, streamKey };
  }

  private onOutputStatus(status: DestinationStatus): void {
    const previous = this.statuses.get(status.id);
    this.statuses.set(status.id, status);
    const broadcast = this.youtubeBroadcasts.get(status.id);
    if (broadcast && status.state === "live") broadcast.wentLive = true;
    const ended = previous && ACTIVE_STATES.has(previous.state) && !ACTIVE_STATES.has(status.state);
    if (ended) this.finishYouTubeBroadcast(status.id);
    if (ended && !this.isStreaming()) this.autoStopRecording();
    if (status.state === "error" && status.errorKey && previous?.state !== "error") {
      const destination = this.state.destinations.find((entry) => entry.id === status.id);
      this.notify({ kind: "error", key: status.errorKey, values: { name: destination?.name ?? "" } });
    }
    this.pushSnapshot();
  }

  private finishYouTubeBroadcast(destinationId: string): void {
    const broadcast = this.youtubeBroadcasts.get(destinationId);
    if (!broadcast) return;
    this.youtubeBroadcasts.delete(destinationId);
    const account = this.state.accounts.find((entry) => entry.id === broadcast.accountId);
    if (account?.platform !== "youtube") return;
    const finish = broadcast.wentLive ? youtube.completeYouTubeBroadcast : youtube.deleteYouTubeBroadcast;
    finish(account, broadcast.broadcastId).catch((error: unknown) => {
      // enableAutoStop also ends a live broadcast once video stops arriving.
      console.error("[studio] YouTube broadcast cleanup failed", error);
    });
  }

  // ----- engine events ------------------------------------------------------

  private onEngineEvent(event: EngineEvent): void {
    switch (event.type) {
      case "status":
        this.onOutputStatus(event.status);
        break;
      case "recording":
        if (this.engineState) this.engineState.recording = event.status;
        if (!event.status.active) this.autoRecording = false;
        if (event.status.errorKey) this.notify({ kind: "error", key: event.status.errorKey });
        this.pushSnapshot();
        break;
      case "levels":
        this.send(IPC.audioLevels, event.levels);
        break;
      case "replay":
        if (this.engineState) this.engineState.replay = event.status;
        if (event.status.errorKey) this.notify({ kind: "error", key: event.status.errorKey });
        this.pushSnapshot();
        break;
      case "replaySaved":
        if (event.file) this.notify({ kind: "success", key: "notices.replaySaved", values: { file: path.basename(event.file), folder: path.dirname(event.file) } });
        else this.notify({ kind: "error", key: "errors.output.replaySaveFailed" });
        break;
      case "stats": {
        for (const output of event.outputs) {
          const current = this.statuses.get(output.id);
          if (current) Object.assign(current, { kbps: output.kbps, droppedFrames: output.droppedFrames, totalFrames: output.totalFrames });
        }
        this.outputStats.refresh(this.recordingFolder(), this.engineState?.recording ?? { active: false });
        this.send(IPC.stats, { ...event.stats, ...this.outputStats.latest() });
        if (event.outputs.length > 0) this.pushSnapshot();
        break;
      }
    }
  }

  /**
   * Stops the engine for a collection or audio-format switch: saves the
   * collection it holds into the state first, then tears it down like a quit.
   * Displays are reset as after a crash and rebuilt by startEngineAfterReload.
   */
  private async stopEngineForReload(): Promise<void> {
    if (this.engine.running && this.engineState) this.state.collection = await this.engine.call("saveCollection");
    this.engineState = null;
    this.selectedItemId = null;
    this.canvasPast.length = 0;
    this.canvasFuture.length = 0;
    this.dragStarts.clear();
    this.programDisplay.reset();
    this.studioDisplay.reset();
    this.projectors?.reset();
    this.editor?.setRect(null);
    this.pushSnapshot();
    await this.engine.shutdown();
  }

  private async startEngineAfterReload(): Promise<void> {
    this.engineErrorKey = undefined;
    await this.start();
    this.applyDisplays();
    this.projectors?.reapply();
  }

  private onEngineCrash(): void {
    this.engineErrorKey = "engine-stopped";
    this.engineState = null;
    this.programDisplay.reset();
    this.studioDisplay.reset();
    this.projectors?.reset();
    this.editor?.setRect(null);
    for (const preparation of this.preparations.values()) preparation.cancelled = true;
    for (const status of this.statuses.values()) {
      if (ACTIVE_STATES.has(status.state)) this.onOutputStatus({ ...status, state: "error", kbps: 0, errorKey: "errors.codes.engine-stopped" });
    }
    this.notify({ kind: "error", key: "errors.codes.engine-stopped" });
    this.pushSnapshot();
  }

  // ----- preview ------------------------------------------------------------

  /**
   * The rect the surface should occupy. While floating UI covers the preview it
   * keeps its size but moves off-screen: tearing the display down and recreating
   * it (new IOSurface on macOS) for every menu was slow and could leave the
   * preview missing after the menu closed.
   */
  private shownPreviewRect(): Rect | null {
    const rect = this.previewRect;
    if (!rect || !this.previewHidden) return rect;
    return { ...rect, x: PREVIEW_PARK_OFFSET, y: PREVIEW_PARK_OFFSET };
  }

  /** The editor window covers the visible preview only (never while parked or torn down). */
  private syncEditor(): void {
    if (!this.editor) return;
    const visible = this.previewRect && !this.previewHidden && this.engine.running && this.engineState;
    this.editor.setRect(visible ? this.previewRect : null);
  }

  /**
   * Serializes preview updates; only the newest pending rects matter. The
   * renderer reports the rects again whenever the window's backing scale
   * changes (moved to another screen, or the screen's scaling changed): on
   * Windows displays are sized in physical pixels, and on macOS their views
   * must be rebuilt for the new scale (see preview-mac.ts). Outside studio
   * mode the program fills the preview rect; in studio mode the editable
   * preview takes it and the program moves to the program rect. `hide`
   * removes every display (minimized, or rebuilt for a new canvas).
   */
  private applyDisplays(hide = false): void {
    const studio = this.state.studioMode && !hide;
    const programRect = hide ? null : studio ? this.parked(this.programRect) : this.shownPreviewRect();
    const studioRect = studio ? this.shownPreviewRect() : null;
    this.previewQueue = this.previewQueue
      .then(async () => {
        if (!this.engine.running || !this.engineState) return;
        if (!studioRect) this.editor?.setRect(null);
        const scale = this.previewScale || screen.getDisplayMatching(this.window.getBounds()).scaleFactor;
        const alive = () => this.engine.running && this.engineState !== null && !this.window.isDestroyed();
        // Remove before adding, so the editable rect is never covered twice.
        const order = studioRect ? [this.programDisplay, this.studioDisplay] : [this.studioDisplay, this.programDisplay];
        let created = false;
        for (const display of order) {
          const rect = display === this.studioDisplay ? studioRect : programRect;
          // Studio mode before its program rect is known: leave the program where it is.
          if (display === this.programDisplay && studio && !rect) continue;
          created = (await display.show(rect, scale, alive)) || created;
          if (!alive()) return;
        }
        this.syncEditor();
        if (created) this.editor?.raise();
      })
      .catch((error: unknown) => console.error("[studio] preview update failed", error));
  }

  /** A rect moved off-screen while floating UI covers the preview. */
  private parked(rect: Rect | null): Rect | null {
    if (!rect || !this.previewHidden) return rect;
    return { ...rect, x: PREVIEW_PARK_OFFSET, y: PREVIEW_PARK_OFFSET };
  }

  // ----- studio mode and projectors -----------------------------------------

  /** The scene the editing UI works on: the preview scene in studio mode, otherwise the program scene. */
  private editingScene(): string | null {
    const program = this.engineState?.activeScene ?? null;
    return this.state.studioMode ? (this.previewScene ?? program) : program;
  }

  /** Puts the studio-mode preview on a scene that exists (or empties it when studio mode is off). */
  private async syncStudioPreview(): Promise<void> {
    if (!this.engine.running || !this.engineState) return;
    if (!this.state.studioMode) {
      this.previewScene = null;
      await this.engine.call("setStudioPreview", null);
      return;
    }
    const scenes = this.engineState.scenes.map((scene) => scene.name);
    const next = this.previewScene && scenes.includes(this.previewScene) ? this.previewScene : this.engineState.activeScene;
    await this.engine.call("setStudioPreview", next);
    this.previewScene = next;
  }

  private async setPreviewScene(name: string): Promise<void> {
    if (!this.engineState?.scenes.some((scene) => scene.name === name)) throw new Error("scene-not-found");
    await this.engine.call("setStudioPreview", name);
    this.previewScene = name;
    this.pushSnapshot();
  }

  private projectorContext() {
    const engine = this.engineState;
    const scenes = engine?.scenes ?? [];
    const pictureless = new Set(["microphone", "desktopAudio", "applicationAudio", "scene"]);
    const sources = new Set(scenes.flatMap((scene) => scene.items.filter((item) => !pictureless.has(item.kind)).map((item) => item.sourceName)));
    return {
      ready: this.engine.running && engine !== null,
      studioMode: this.state.studioMode,
      programScene: engine?.activeScene ?? null,
      previewScene: this.state.studioMode ? this.editingScene() : null,
      scenes: scenes.map((scene) => scene.name),
      sources: [...sources],
      aspect: this.state.video.baseWidth / this.state.video.baseHeight,
    };
  }

  // ----- destinations & accounts --------------------------------------------

  private saveDestination(draft: DestinationDraft): string {
    if (draft.platform !== "youtube" && draft.platform !== "twitch") throw new Error("invalid-platform");
    const id = draft.id ?? randomUUID();
    if (draft.id && this.isLive(draft.id)) throw new Error("destination-live");
    const existing = this.state.destinations.find((destination) => destination.id === id);
    if (draft.id && !existing) throw new Error("destination-not-found");

    const mode =
      draft.mode === "account" && draft.accountId && this.state.accounts.some((account) => account.id === draft.accountId && account.platform === draft.platform)
        ? "account"
        : "manual";
    if (draft.mode === "account" && mode !== "account") throw new Error("account-signed-out");
    // An account has one stream (key / ingest), so two destinations cannot share it.
    if (mode === "account" && this.state.destinations.some((destination) => destination.id !== id && destination.accountId === draft.accountId)) {
      throw new Error("account-in-use");
    }
    const server = (draft.server || PLATFORM_SPECS[draft.platform].defaultServer).trim();
    if (mode === "manual" && !/^rtmps?:\/\/\S+$/iu.test(server)) throw new Error("invalid-server");
    const key = draft.streamKey?.trim();
    if (mode === "manual" && !key && !hasSecret(secretNames.streamKey(id))) throw new Error("stream-key-missing");
    if (key) setSecret(secretNames.streamKey(id), key);

    const next: DestinationConfig = {
      id,
      platform: draft.platform,
      name: draft.name.trim().slice(0, 60) || PLATFORM_SPECS[draft.platform].platform,
      enabled: draft.enabled,
      mode,
      server,
      hasStreamKey: hasSecret(secretNames.streamKey(id)),
      accountId: mode === "account" ? draft.accountId : undefined,
      profile: clampProfile(draft.platform, { ...draft.profile, fps: this.state.video.fps }),
    };
    if (existing) Object.assign(existing, next);
    else this.state.destinations.push(next);
    this.statuses.delete(id);
    this.persist();
    this.pushSnapshot();
    return id;
  }

  private upsertAccount(account: AccountRecord): void {
    const index = this.state.accounts.findIndex((entry) => entry.id === account.id);
    if (index >= 0) this.state.accounts[index] = { ...this.state.accounts[index], ...account } as AccountRecord;
    else this.state.accounts.push(account);
    this.chat.sync();
    this.overlayData.sync();
    this.persist();
    this.pushSnapshot();
  }

  private accountFor(destination: DestinationConfig): AccountRecord | undefined {
    if (!destination.accountId) return undefined;
    return this.state.accounts.find((account) => account.id === destination.accountId);
  }

  // ----- permissions --------------------------------------------------------

  /**
   * Capture sources need OS access first; without it the engine captures
   * black frames or silence without any error.
   */
  private async ensureCapturePermission(kind: SourceKind): Promise<void> {
    const needed = ["camera", "captureCard", "blackmagic"].includes(kind) ? "camera" : kind === "microphone" ? "microphone" : ["display", "window", "application", "desktopAudio", "applicationAudio"].includes(kind) ? "screen" : null;
    if (!needed) return;
    const state = await requestPermission(needed);
    this.pushSnapshot();
    if (state !== "granted" && state !== "unsupported") throw new Error(`permission-${needed}-denied`);
  }

  // ----- snapshot -----------------------------------------------------------

  private snapshot(): StudioSnapshot {
    const engine = this.engineState;
    const accounts: AccountDTO[] = this.state.accounts.map(({ id, platform, displayName, channelId }) => ({ id, platform, displayName, channelId }));
    return {
      ready: engine !== null,
      engineErrorKey: this.engineErrorKey ? `errors.codes.${this.engineErrorKey}` : undefined,
      scenes: engine?.scenes ?? [],
      availableSourceKinds: engine?.availableSourceKinds ?? [],
      activeScene: this.editingScene(),
      audio: engine?.audio ?? [],
      video: this.state.video,
      encoders: engine?.encoders ?? [],
      selectedEncoder: this.state.encoder ?? "",
      destinations: this.state.destinations.map((destination) => ({ ...destination, hasStreamKey: hasSecret(secretNames.streamKey(destination.id)) })),
      destinationStatus: [...this.statuses.values()],
      recording: engine?.recording ?? { active: false },
      recordingFolder: this.recordingFolder(),
      preferences: this.state.preferences,
      advanced: this.state.advanced,
      setupPending: !this.state.setupCompleted,
      screenRecording: this.screenRecorder.state,
      accounts,
      platformsConfigured: { twitch: twitch.twitchConfigured(), youtube: youtube.youtubeConfigured() },
      permissions: permissionSnapshot(),
      overlayData: this.overlayData.status(),
      transition: this.state.transition,
      availableTransitions: availablePresets(engine?.transitionTypes ?? []).map((preset) => preset.id),
      virtualCamera: {
        availability: virtualCameraAvailability(this.virtualCameraProbe),
        active: engine?.virtualCameraActive ?? false,
        scene: this.state.virtualCamera.scene,
      },
      selectedItemId: this.selectedItemId,
      canvasHistory: { canUndo: this.canvasPast.length > 0, canRedo: this.canvasFuture.length > 0 },
      replayBuffer: engine?.replay ?? { active: false },
      hotkeys: { bindings: this.state.hotkeys, ...this.hotkeys.status() },
      workspace: {
        collections: this.state.collections,
        profiles: this.state.profiles,
        switching: this.workspace.switching,
        audioFormat: this.state.audioFormat ?? this.engineAudioFormat ?? DEFAULT_AUDIO_FORMAT,
        recordingTracks: this.state.recordingTracks,
      },
      studioMode: { enabled: this.state.studioMode, programScene: engine?.activeScene ?? null },
    };
  }

  requestQuitConfirmation(): void {
    this.send(IPC.quitRequest, null);
  }

  private notify(notice: Notice): void {
    this.send(IPC.notice, notice);
  }

  private send(channel: string, payload: unknown): void {
    if (!this.window.isDestroyed()) this.window.webContents.send(channel, payload);
    // The preview editor only needs state updates.
    if (channel === IPC.snapshot) this.editor?.webContents?.send(channel, payload);
  }

  // ----- helpers ------------------------------------------------------------

  private async refreshState(): Promise<void> {
    this.engineState = await this.engine.call("state");
    // The preview scene may be gone (removed), or be another object with the
    // same name (another collection loaded): point the preview at it again.
    if (this.state.studioMode) await this.syncStudioPreview();
    this.syncHotkeys();
    this.pushSnapshot();
  }

  // ----- hotkeys, instant replay, auto-record -------------------------------

  /** Registers the combos whose scene or audio source exists right now. */
  private syncHotkeys(): void {
    const scenes = new Set(this.engineState?.scenes.map((scene) => scene.name) ?? []);
    const audio = new Set(this.engineState?.audio.map((source) => source.name) ?? []);
    const effective = Object.fromEntries(
      Object.entries(this.state.hotkeys).filter(([action]) => {
        const parsed = parseHotkeyAction(action);
        if (!parsed) return false;
        if (!("target" in parsed)) return true;
        return parsed.kind === "scene" ? scenes.has(parsed.target) : audio.has(parsed.target);
      }),
    );
    this.hotkeys.apply(effective);
  }

  private renameHotkeys(kinds: readonly TargetHotkeyKind[], from: string, to: string): void {
    const next = renameHotkeyTarget(this.state.hotkeys, kinds, from, to.trim());
    if (next === this.state.hotkeys) return;
    this.state.hotkeys = next;
    this.persist();
    this.syncHotkeys();
    this.pushSnapshot();
  }

  private runHotkey(action: string): void {
    const parsed = parseHotkeyAction(action);
    if (!parsed || !this.engineState || this.shuttingDown) return;
    const task = async (): Promise<void> => {
      switch (parsed.kind) {
        case "goLive":
          return this.hotkeyGoLive();
        case "endStream": {
          const ids = [...this.statuses.values()].filter((status) => ACTIVE_STATES.has(status.state)).map((status) => status.id);
          if (ids.length > 0) await this.api.endStream(ids);
          return;
        }
        case "toggleRecording":
          return this.engineState?.recording.active ? this.api.stopRecording() : this.api.startRecording();
        case "saveReplay":
          return this.api.saveReplay();
        case "transition":
          return this.api.studioTransition(null);
        case "toggleVirtualCamera":
          return this.engineState?.virtualCameraActive ? this.api.stopVirtualCamera() : this.api.startVirtualCamera();
        case "scene":
          return this.api.setActiveScene(parsed.target);
        case "mute": {
          const source = this.engineState?.audio.find((entry) => entry.name === parsed.target);
          if (source) await this.api.setMuted(source.name, !source.muted);
          return;
        }
        default:
          return;
      }
    };
    task().catch((error: unknown) => this.notify({ kind: "error", key: `errors.codes.${errorKey(error)}` }));
  }

  private holdHotkey(action: string, down: boolean): void {
    const parsed = parseHotkeyAction(action);
    if (!parsed || !("target" in parsed) || !this.engineState || this.shuttingDown) return;
    if (parsed.kind !== "pushToTalk" && parsed.kind !== "pushToMute") return;
    const muted = parsed.kind === "pushToTalk" ? !down : down;
    this.api.setMuted(parsed.target, muted).catch((error: unknown) => this.notify({ kind: "error", key: `errors.codes.${errorKey(error)}` }));
  }

  /** Goes live on every enabled destination that is ready; the hotkey itself is the confirmation. */
  private async hotkeyGoLive(): Promise<void> {
    const ids = this.state.destinations.filter((destination) => destination.enabled && !this.isLive(destination.id)).map((destination) => destination.id);
    if (ids.length === 0) return;
    const check = await this.checkStream(ids);
    for (const issue of check.issues) {
      if (!issue.blocking) continue;
      const destination = this.state.destinations.find((entry) => entry.id === issue.destinationId);
      this.notify({ kind: "error", key: issue.key, values: { name: destination?.name ?? "" } });
    }
    if (check.readyDestinationIds.length > 0) await this.goLive(check.readyDestinationIds);
  }

  /** Asks the engine whether the virtual camera can start; never installs anything. */
  private async probeVirtualCamera(): Promise<VirtualCameraProbe | null> {
    if (!this.engine.running || !this.engineState || this.shuttingDown) return this.virtualCameraProbe;
    try {
      this.virtualCameraProbe = await this.engine.call("virtualCameraProbe");
    } catch (error) {
      console.warn("[studio] virtual camera check failed", error);
    }
    this.pushSnapshot();
    return this.virtualCameraProbe;
  }

  /** Runs, restarts or stops instant replay to match the preferences. */
  private async syncReplay(): Promise<void> {
    if (!this.engine.running || !this.engineState || this.shuttingDown) return;
    const prefs = this.state.preferences;
    const folder = this.recordingFolder();
    const options =
      prefs.replayBufferEnabled && this.state.encoder && existsSync(folder)
        ? { folder, format: prefs.recordingFormat, bitrateKbps: prefs.recordingBitrateKbps, seconds: prefs.replayBufferSeconds }
        : null;
    try {
      await this.engine.call("configureReplay", this.state.encoder ?? "", options);
    } catch (error) {
      console.error("[studio] instant replay could not be updated", error);
      this.notify({ kind: "error", key: "errors.output.replayFailed" });
    }
  }

  private async autoStartRecording(): Promise<void> {
    if (!this.state.preferences.autoRecord || this.engineState?.recording.active || !this.isStreaming()) return;
    try {
      await this.api.startRecording();
      this.autoRecording = true;
    } catch (error) {
      console.error("[studio] automatic recording failed to start", error);
      this.notify({ kind: "error", key: `errors.codes.${errorKey(error)}` });
    }
  }

  private autoStopRecording(): void {
    if (!this.autoRecording || this.state.preferences.keepRecordingAfterStream || !this.engineState?.recording.active) return;
    this.autoRecording = false;
    this.engine.call("stopRecording").catch((error: unknown) => console.error("[studio] automatic recording failed to stop", error));
  }

  private isStreaming(): boolean {
    return [...this.statuses.values()].some((status) => ACTIVE_STATES.has(status.state));
  }

  private async mutate<T>(call: () => Promise<T>): Promise<T> {
    const result = await call();
    await this.refreshState();
    this.persist();
    return result;
  }

  private inCanvasQueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.canvasQueue.then(task);
    this.canvasQueue = run.catch(() => undefined);
    return run;
  }

  /** Applies a canvas edit and records it as one undo step. */
  private canvasEdit(scene: string, itemId: number, apply: () => Promise<void>, dragKey?: string): Promise<void> {
    return this.inCanvasQueue(async () => {
      const started = dragKey === undefined ? undefined : this.dragStarts.get(dragKey);
      if (dragKey !== undefined) this.dragStarts.delete(dragKey);
      const before = started ?? (await this.engine.call("getItemPlacement", scene, itemId));
      await this.mutate(async () => {
        await apply();
        const after = await this.engine.call("getItemPlacement", scene, itemId);
        if (JSON.stringify(after) === JSON.stringify(before)) return;
        this.canvasPast.push({ scene, itemId, before, after });
        if (this.canvasPast.length > CANVAS_HISTORY_LIMIT) this.canvasPast.shift();
        this.canvasFuture.length = 0;
      });
    });
  }

  /** Undoes or redoes the newest canvas edit whose item still exists. */
  private async stepCanvas(direction: "undo" | "redo"): Promise<void> {
    const from = direction === "undo" ? this.canvasPast : this.canvasFuture;
    const to = direction === "undo" ? this.canvasFuture : this.canvasPast;
    for (let edit = from.pop(); edit; edit = from.pop()) {
      try {
        await this.engine.call("setItemPlacement", edit.scene, edit.itemId, direction === "undo" ? edit.before : edit.after);
      } catch (error) {
        // A locked item keeps its step so it can be undone once unlocked;
        // steps for removed items or scenes are dropped.
        if (errorKey(error) === "item-locked") {
          from.push(edit);
          throw error;
        }
        continue;
      }
      to.push(edit);
      await this.refreshState();
      this.persist();
      return;
    }
    this.pushSnapshot();
  }

  private isLive(destinationId: string): boolean {
    const state = this.statuses.get(destinationId)?.state;
    return Boolean(state && ACTIVE_STATES.has(state));
  }

  private ensureEncoder(): void {
    const available = this.engineState?.encoders ?? [];
    if (!available.some((encoder) => encoder.id === this.state.encoder)) {
      this.state.encoder = available.find((encoder) => encoder.hardware)?.id ?? available[0]?.id ?? null;
      this.persist();
    }
  }

  /**
   * Push-to-talk / push-to-mute (hotkeys): flips a source's mute without
   * closing a microphone's device, refreshing all state or saving, so it is
   * cheap enough for every key press and release.
   */
  async setTalkMuted(source: string, muted: boolean): Promise<void> {
    const entry = this.engineState?.audio.find((item) => item.name === source);
    if (!entry) throw new Error("source-not-found");
    if (!muted && entry.microphone) await this.ensureCapturePermission("microphone");
    await this.engine.call("setTalkMuted", source, muted);
    if (entry.muted !== muted) {
      entry.muted = muted;
      this.pushSnapshot();
    }
  }

  /** Devices for a mixer row; a muted microphone's devices are listed without opening it where possible. */
  private async listAudioDevices(source: string): Promise<AudioDeviceChoice | null> {
    const result = await this.engine.call("audioDevices", source, false);
    if (!result || !("closed" in result)) return result;
    const devices = await listMicrophones(helperPath("audio-inputs"));
    if (devices.length > 0) {
      return { current: result.current, options: [{ value: "default", label: "" }, ...devices.map((device) => ({ value: device.uid, label: device.name }))] };
    }
    return this.engine.call("audioDevices", source, true) as Promise<AudioDeviceChoice | null>;
  }

  private encoderId(): string {
    if (!this.state.encoder) throw new Error("encoder-unavailable");
    return this.state.encoder;
  }

  /** Holds a sleep blocker while streaming or recording, when the user wants it. */
  private syncKeepAwake(): void {
    const want = this.busy && this.state.preferences.keepAwakeWhileLive && !this.shuttingDown;
    if (want && this.keepAwakeId === null) this.keepAwakeId = powerSaveBlocker.start("prevent-display-sleep");
    if (!want && this.keepAwakeId !== null) {
      if (powerSaveBlocker.isStarted(this.keepAwakeId)) powerSaveBlocker.stop(this.keepAwakeId);
      this.keepAwakeId = null;
    }
  }

  private recordingFolder(): string {
    return this.state.recordingFolder ?? app.getPath("videos");
  }

  private requireDestination(id: string): DestinationConfig {
    const destination = this.state.destinations.find((entry) => entry.id === id);
    if (!destination) throw new Error("destination-not-found");
    return destination;
  }

  private loadState(): PersistedState {
    const saved = readJson<Partial<PersistedState>>(STATE_FILE, {});
    return {
      version: 1,
      video: saved.video ? sanitizeVideo(saved.video) : DEFAULT_VIDEO,
      encoder: saved.encoder ?? null,
      recordingFolder: saved.recordingFolder ?? null,
      preferences: sanitizePreferences({ ...DEFAULT_PREFERENCES, ...saved.preferences }),
      destinations: saved.destinations ?? [],
      broadcastInfo: saved.broadcastInfo ?? {},
      accounts: saved.accounts ?? [],
      collection: saved.collection ?? null,
      overlayPort: saved.overlayPort ?? DEFAULT_OVERLAY_PORT,
      transition: sanitizeTransition(saved.transition),
      hotkeys: sanitizeHotkeys(saved.hotkeys),
      advanced: sanitizeAdvanced({ ...DEFAULT_ADVANCED_STREAM, ...saved.advanced }),
      // Only a brand-new install (no saved state) sees the first-run setup.
      setupCompleted: typeof saved.setupCompleted === "boolean" ? saved.setupCompleted : Object.keys(saved).length > 0,
      monitoringDevice: typeof saved.monitoringDevice === "string" && saved.monitoringDevice ? saved.monitoringDevice : null,
      virtualCamera: { scene: typeof saved.virtualCamera?.scene === "string" && saved.virtualCamera.scene ? saved.virtualCamera.scene : null },
      studioMode: saved.studioMode === true,
      // Older files get one collection (the one above) and one profile (the settings above).
      ...migrateWorkspace(saved as Record<string, unknown>, randomUUID),
    };
  }

  private async saveNow(): Promise<void> {
    // Only replace the saved collection with one the engine actually produced.
    if (this.engine.running && this.engineState) this.state.collection = await this.engine.call("saveCollection");
    writeJson(STATE_FILE, this.state);
  }
}

/** A stinger's video must still exist; other transitions need no file. */
function stingerFileOk(choice: TransitionChoice): boolean {
  return !choice.stinger || isFile(choice.stinger.path);
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function vendorRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "vendor") : path.join(app.getAppPath(), "vendor");
}

function sanitizeVideo(settings: VideoSettings): VideoSettings {
  const even = (value: number, fallback: number) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 128 || n > 7680) return fallback;
    return n - (n % 2);
  };
  const fps = [24, 25, 30, 48, 50, 60].includes(Number(settings.fps)) ? Number(settings.fps) : 30;
  return {
    baseWidth: even(settings.baseWidth, 1920),
    baseHeight: even(settings.baseHeight, 1080),
    outputWidth: even(settings.outputWidth, 1920),
    outputHeight: even(settings.outputHeight, 1080),
    scaleFilter: SCALE_FILTERS.includes(settings.scaleFilter) ? settings.scaleFilter : "bicubic",
    // Fractional and custom frame rates, color format/space/range (Settings › Video › Advanced).
    ...sanitizeVideoFormat(settings, fps),
  };
}

function sanitizePreferences(value: StudioPreferences): StudioPreferences {
  const bitrate = Math.round(Number(value.recordingBitrateKbps));
  return {
    recordingFormat: RECORDING_FORMATS.includes(value.recordingFormat) ? value.recordingFormat : DEFAULT_PREFERENCES.recordingFormat,
    recordingBitrateKbps:
      Number.isFinite(bitrate) && bitrate >= RECORDING_BITRATE_RANGE.min && bitrate <= RECORDING_BITRATE_RANGE.max
        ? bitrate
        : DEFAULT_PREFERENCES.recordingBitrateKbps,
    confirmGoLive: typeof value.confirmGoLive === "boolean" ? value.confirmGoLive : DEFAULT_PREFERENCES.confirmGoLive,
    confirmEndStream: typeof value.confirmEndStream === "boolean" ? value.confirmEndStream : DEFAULT_PREFERENCES.confirmEndStream,
    keepAwakeWhileLive: typeof value.keepAwakeWhileLive === "boolean" ? value.keepAwakeWhileLive : DEFAULT_PREFERENCES.keepAwakeWhileLive,
    ...sanitizeCapturePreferences(value),
  };
}

function sanitizeAdvanced(value: AdvancedStreamSettings): AdvancedStreamSettings {
  const whole = (input: unknown, range: { min: number; max: number }, fallback: number) => {
    const n = Math.round(Number(input));
    return Number.isFinite(n) && n >= range.min && n <= range.max ? n : fallback;
  };
  return {
    streamDelaySec: whole(value.streamDelaySec, ADVANCED_STREAM_RANGES.streamDelaySec, DEFAULT_ADVANCED_STREAM.streamDelaySec),
    reconnectDelaySec: whole(value.reconnectDelaySec, ADVANCED_STREAM_RANGES.reconnectDelaySec, DEFAULT_ADVANCED_STREAM.reconnectDelaySec),
    reconnectMaxRetries: whole(value.reconnectMaxRetries, ADVANCED_STREAM_RANGES.reconnectMaxRetries, DEFAULT_ADVANCED_STREAM.reconnectMaxRetries),
  };
}

/** Error codes are kebab-case strings thrown by the main process modules. */
const CANVAS_HISTORY_LIMIT = 100;

interface CanvasEdit {
  scene: string;
  itemId: number;
  before: ItemPlacement;
  after: ItemPlacement;
}

export function errorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(message) ? message : "generic";
}

/** Converts an OBS file filter ("Images (*.png *.jpg);;All (*.*)") to Electron filters. */
function parseObsFilter(filter: string | undefined): Electron.FileFilter[] | undefined {
  if (!filter) return undefined;
  const filters = filter
    .split(";;")
    .map((part) => {
      const match = /^(.*?)\s*\(([^)]*)\)\s*$/u.exec(part.trim());
      if (!match) return null;
      const extensions = match[2]
        .split(/\s+/u)
        .map((pattern) => pattern.replace(/^\*\./u, ""))
        .filter((extension) => extension && extension !== "*");
      return { name: match[1] || "Files", extensions: extensions.length ? extensions : ["*"] };
    })
    .filter((entry): entry is Electron.FileFilter => entry !== null);
  return filters.length ? filters : undefined;
}

function callbackPage(ok: boolean): string {
  // Minimal page shown in the browser after sign-in; the app shows the result.
  const symbol = ok ? "&#10003;" : "&#10007;";
  return `<!doctype html><html><head><meta charset="utf-8"><title>SEENALYZE STUDIO</title></head><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#000;color:#fff;font-size:48px">${symbol}</body></html>`;
}
