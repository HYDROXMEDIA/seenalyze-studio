// Studio controller (main process): owns persisted state, accounts and
// secrets, and drives the engine worker through asynchronous calls so the app
// window never waits on the engine. Implements the StudioApi contract.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { app, dialog, powerSaveBlocker, screen, shell, type BrowserWindow } from "electron";
import type { Notice, StudioApi, StudioMethod } from "../shared/ipc";
import { IPC } from "../shared/ipc";
import { OVERLAY_KINDS, type DesignRequest, type DesignResult, type OverlayKind } from "../shared/overlays";
import { clampProfile, PLATFORM_SPECS } from "../shared/platforms";
import { sceneIssues } from "../shared/stream-check";
import type {
  AccountDTO,
  BroadcastInfo,
  DestinationConfig,
  DestinationDraft,
  DestinationStatus,
  Rect,
  SourceKind,
  StudioPreferences,
  StreamCheck,
  StudioSnapshot,
  VideoSettings,
} from "../shared/types";
import { RECORDING_BITRATE_RANGE, RECORDING_FORMATS, SCALE_FILTERS } from "../shared/types";
import { EngineClient } from "./engine/client";
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
import { MacPreviewView } from "./preview-mac";
import { ScreenRecorder } from "./screen-recording";
import { SeenalyzeAccountService } from "./seenalyze/account";
import * as twitch from "./platforms/twitch";
import { forgetToken, readToken } from "./platforms/tokens";
import * as youtube from "./platforms/youtube";
import { deleteSecret, getSecret, hasSecret, secretNames, setSecret } from "./secrets";
import { debounced, readJson, writeJson } from "./store";
import { sanitizeTransition, type TransitionChoice } from "../shared/transitions";
import { sanitizeTransformPatch } from "../shared/transform-geometry";

type AccountRecord =
  | ({ platform: "twitch" } & twitch.TwitchAccount & { login?: string })
  | ({ platform: "youtube" } & youtube.YouTubeAccount);

interface PersistedState {
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
const IS_MAC = process.platform === "darwin";
/** Far off-screen coordinate for a parked (covered) preview surface. */
const PREVIEW_PARK_OFFSET = -20000;

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
  keepAwakeWhileLive: true,
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
  private readonly macPreview: MacPreviewView | null;
  private previewRect: Rect | null = null;
  /** Floating UI covers the preview: keep the surface but park it off-screen. */
  private previewHidden = false;
  private previewQueue: Promise<void> = Promise.resolve();
  /** Selected scene item, shared by the main window and the preview editor. */
  private selectedItemId: number | null = null;
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
    this.syncKeepAwake();
    this.send(IPC.snapshot, this.snapshot());
  }, 30);
  private keepAwakeId: number | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly quit: () => void,
    private readonly editor: PreviewEditorWindow | null = null,
  ) {
    this.state = this.loadState();
    this.macPreview = IS_MAC ? new MacPreviewView(window) : null;
    this.engine.on("event", (event: EngineEvent) => this.onEngineEvent(event));
    this.engine.on("crash", () => this.onEngineCrash());
    window.on("minimize", () => this.applyPreview(null));
    window.on("restore", () => this.applyPreview(this.shownPreviewRect()));
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
        transition: this.state.transition,
      });
      // Saved chat overlays follow the overlay server if its port changed.
      await this.engine.call("retargetChatOverlays", `http://127.0.0.1:${this.state.overlayPort}`);
      await this.refreshState();
      this.ensureEncoder();
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
    this.macPreview?.detach();
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
    removeScene: async (name) => this.mutate(() => this.engine.call("removeScene", name)),
    renameScene: async (name, nextName) => this.mutate(() => this.engine.call("renameScene", name, nextName)),
    setActiveScene: async (name) => this.mutate(() => this.engine.call("setActiveScene", name)),
    setTransition: async (choice) => {
      const clean = sanitizeTransition(choice);
      await this.engine.call("setTransition", clean);
      this.state.transition = clean;
      this.persist();
      this.pushSnapshot();
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
    applyTransform: async (scene, itemId, preset) => this.mutate(() => this.engine.call("applyTransform", scene, itemId, preset)),
    patchItemTransform: async (scene, itemId, patch, commit) => {
      const clean = sanitizeTransformPatch(patch);
      // Live drag updates only touch the engine; the drag end refreshes and saves.
      if (!commit) return this.engine.call("patchItemTransform", scene, itemId, clean);
      return this.mutate(() => this.engine.call("patchItemTransform", scene, itemId, clean));
    },
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
    setItemTransform: async (scene, itemId, transform) => this.mutate(() => this.engine.call("setItemTransform", scene, itemId, transform)),
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
    renameSource: async (source, nextName) => this.mutate(() => this.engine.call("renameSource", source, nextName)),
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

    setPreviewBounds: async (rect) => {
      this.previewRect = rect;
      if (!rect) this.previewHidden = false;
      this.syncEditor();
      if (!this.window.isMinimized()) this.applyPreview(this.shownPreviewRect());
    },
    setPreviewHidden: async (hidden) => {
      if (this.previewHidden === Boolean(hidden)) return;
      this.previewHidden = Boolean(hidden);
      this.syncEditor();
      if (!this.window.isMinimized()) this.applyPreview(this.shownPreviewRect());
    },

    setVideoSettings: async (settings) => {
      if (this.busy) throw new Error("settings-locked-live");
      const clean = sanitizeVideo(settings);
      await this.engine.call("applyVideo", clean);
      this.state.video = clean;
      // The preview surface is tied to the old canvas; rebuild it.
      this.applyPreview(null);
      this.applyPreview(this.shownPreviewRect());
      await this.refreshState();
      this.persist();
    },
    setEncoder: async (encoderId) => {
      if (this.busy) throw new Error("settings-locked-live");
      if (!this.engineState?.encoders.some((encoder) => encoder.id === encoderId)) throw new Error("encoder-unavailable");
      this.state.encoder = encoderId;
      this.persist();
      this.pushSnapshot();
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
      return this.state.recordingFolder;
    },
    setPreferences: async (patch) => {
      this.state.preferences = sanitizePreferences({ ...this.state.preferences, ...patch });
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
        bitrateKbps: this.state.preferences.recordingBitrateKbps,
      });
      await this.refreshState();
    },
    stopRecording: async () => {
      await this.engine.call("stopRecording");
    },
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
    setChatActive: async (active) => this.chat.setActive(Boolean(active)),
    restartEngine: async () => {
      if (this.engine.running && this.engineState) return;
      await this.engine.shutdown();
      this.engineErrorKey = undefined;
      for (const [id, status] of this.statuses) if (ACTIVE_STATES.has(status.state)) this.statuses.delete(id);
      this.pushSnapshot();
      await this.start();
      this.applyPreview(this.shownPreviewRect());
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
      await this.engine.call("startOutputs", ready, encoderId);
    } catch (error) {
      console.error("[studio] outputs failed to start", error);
      for (const { config } of ready) this.failDestination(config.id, `errors.codes.${errorKey(error)}`);
    }
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
        if (event.status.errorKey) this.notify({ kind: "error", key: event.status.errorKey });
        this.pushSnapshot();
        break;
      case "levels":
        this.send(IPC.audioLevels, event.levels);
        break;
      case "stats": {
        for (const output of event.outputs) {
          const current = this.statuses.get(output.id);
          if (current) Object.assign(current, { kbps: output.kbps, droppedFrames: output.droppedFrames, totalFrames: output.totalFrames });
        }
        this.send(IPC.stats, event.stats);
        if (event.outputs.length > 0) this.pushSnapshot();
        break;
      }
    }
  }

  private onEngineCrash(): void {
    this.engineErrorKey = "engine-stopped";
    this.engineState = null;
    this.macPreview?.detach();
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

  /** Serializes preview updates; only the newest pending rect matters. */
  private applyPreview(rect: Rect | null): void {
    this.previewQueue = this.previewQueue
      .then(async () => {
        if (!this.engine.running || !this.engineState) return;
        if (!rect || rect.width < 2 || rect.height < 2) {
          this.editor?.setRect(null);
          this.macPreview?.detach();
          await this.engine.call("hidePreview");
          return;
        }
        const result = await this.engine.call("setPreview", {
          rect,
          windowHandle: new Uint8Array(this.window.getNativeWindowHandle()),
          scale: screen.getDisplayMatching(this.window.getBounds()).scaleFactor,
          mac: IS_MAC,
        });
        if (this.macPreview) {
          if (result.surface !== undefined) this.macPreview.attach(result.surface);
          this.macPreview.move(rect);
          this.syncEditor();
          if (result.surface !== undefined) this.editor?.raise();
        }
      })
      .catch((error: unknown) => console.error("[studio] preview update failed", error));
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
      activeScene: engine?.activeScene ?? null,
      audio: engine?.audio ?? [],
      video: this.state.video,
      encoders: engine?.encoders ?? [],
      selectedEncoder: this.state.encoder ?? "",
      destinations: this.state.destinations.map((destination) => ({ ...destination, hasStreamKey: hasSecret(secretNames.streamKey(destination.id)) })),
      destinationStatus: [...this.statuses.values()],
      recording: engine?.recording ?? { active: false },
      recordingFolder: this.recordingFolder(),
      preferences: this.state.preferences,
      screenRecording: this.screenRecorder.state,
      accounts,
      platformsConfigured: { twitch: twitch.twitchConfigured(), youtube: youtube.youtubeConfigured() },
      permissions: permissionSnapshot(),
      overlayData: this.overlayData.status(),
      transition: this.state.transition,
      selectedItemId: this.selectedItemId,
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
    this.pushSnapshot();
  }

  private async mutate<T>(call: () => Promise<T>): Promise<T> {
    const result = await call();
    await this.refreshState();
    this.persist();
    return result;
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
    };
  }

  private async saveNow(): Promise<void> {
    // Only replace the saved collection with one the engine actually produced.
    if (this.engine.running && this.engineState) this.state.collection = await this.engine.call("saveCollection");
    writeJson(STATE_FILE, this.state);
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
    fps,
    scaleFilter: SCALE_FILTERS.includes(settings.scaleFilter) ? settings.scaleFilter : "bicubic",
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
    keepAwakeWhileLive: typeof value.keepAwakeWhileLive === "boolean" ? value.keepAwakeWhileLive : DEFAULT_PREFERENCES.keepAwakeWhileLive,
  };
}

/** Error codes are kebab-case strings thrown by the main process modules. */
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
