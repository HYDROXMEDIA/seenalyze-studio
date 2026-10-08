// Typed contract between the renderer and the main process. The preload
// bridge exposes exactly these methods; the main process validates every call.

import type {
  DesignRequest,
  DesignResult,
  OverlayDefinition,
  OverlayPatch,
  OverlaySummary,
  PresetSummary,
  SeenalyzeAccount,
} from "./overlays";
import type {
  AdvancedStreamSettings,
  AudioLevel,
  ChatEvent,
  ChatState,
  PermissionKind,
  PermissionState,
  BroadcastInfo,
  CategoryOption,
  DestinationDraft,
  DeviceCodePrompt,
  EngineStats,
  PropertyDTO,
  ProjectorTarget,
  ScreenChoice,
  ItemPlacement,
  ItemTransformPatch,
  Rect,
  SourceKind,
  SourceChoiceDTO,
  SourceTransform,
  SourceTransformDTO,
  StreamCheck,
  StudioSnapshot,
  TransformPreset,
  StudioPreferences,
  VideoSettings,
} from "./types";
import type { TransitionChoice } from "./transitions";
import type { AudioChange, AudioDeviceChoice, AudioSourceDetails, MonitoringDevices } from "./audio";
import type { EffectKind, EffectList, EffectSnapshot } from "./video-effects";
import type { AudioFormat } from "./formats";
import type { ImportCandidate, ImportResult } from "./workspace";

export interface StudioApi {
  getSnapshot(): Promise<StudioSnapshot>;

  // Scenes
  createScene(name: string): Promise<void>;
  removeScene(name: string): Promise<void>;
  renameScene(name: string, nextName: string): Promise<void>;
  setActiveScene(name: string): Promise<void>;
  /** Picks the scene transition preset and its duration; applies immediately. */
  setTransition(choice: TransitionChoice): Promise<void>;
  /** Sets the transition used when switching into a scene; null uses the default. */
  setSceneTransition(scene: string, choice: TransitionChoice | null): Promise<void>;
  /** Lets the user choose a stinger video; resolves with it and its length (0 when unknown). */
  pickStingerFile(): Promise<{ path: string; durationMs: number } | null>;

  // Virtual camera
  /** Checks again whether the virtual camera can start (after the user approved it). */
  checkVirtualCamera(): Promise<void>;
  /** Installs the virtual camera's system component; the system asks the user to approve it. */
  installVirtualCamera(): Promise<void>;
  startVirtualCamera(): Promise<void>;
  stopVirtualCamera(): Promise<void>;
  /** Scene the virtual camera shows; null shows the program output. */
  setVirtualCameraScene(scene: string | null): Promise<void>;

  // Sources
  /** Resolves with the final (unique) source name. */
  addSource(scene: string, kind: SourceKind, name: string): Promise<string>;
  listSourceChoices(scene: string): Promise<SourceChoiceDTO[]>;
  addExistingSource(scene: string, source: string): Promise<string>;
  removeSceneItem(scene: string, itemId: number): Promise<void>;
  setItemVisible(scene: string, itemId: number, visible: boolean): Promise<void>;
  setItemLocked(scene: string, itemId: number, locked: boolean): Promise<void>;
  moveSceneItem(scene: string, itemId: number, direction: "up" | "down"): Promise<void>;
  applyTransform(scene: string, itemId: number, preset: TransformPreset): Promise<void>;
  /** Live transform from the preview editor; `commit` refreshes state and saves (drag end). */
  patchItemTransform(scene: string, itemId: number, patch: ItemTransformPatch, commit: boolean): Promise<void>;
  /** Marks the item the preview draws its selection outline for (null clears). */
  setSelectedItem(scene: string, itemId: number | null): Promise<void>;
  /** Undoes / redoes the newest canvas edit (move, resize, rotate, crop, position presets). */
  undoCanvas(): Promise<void>;
  redoCanvas(): Promise<void>;
  getItemTransform(scene: string, itemId: number): Promise<SourceTransformDTO>;
  setItemTransform(scene: string, itemId: number, transform: SourceTransform): Promise<void>;
  getSourceProperties(source: string): Promise<PropertyDTO[]>;
  updateSourceSettings(source: string, settings: Record<string, unknown>): Promise<PropertyDTO[]>;
  clickSourceButton(source: string, property: string): Promise<PropertyDTO[]>;
  renameSource(source: string, nextName: string): Promise<void>;

  // Scene and source management
  moveScene(name: string, direction: "up" | "down"): Promise<void>;
  /** Copies a scene with its items; resolves with the copy's name. */
  duplicateScene(name: string): Promise<string>;
  /** Copies an item right above itself; resolves with the new item. */
  duplicateSceneItem(scene: string, itemId: number): Promise<{ sourceName: string; itemId: number }>;
  /** Copy transform: the item's full placement. */
  getItemPlacement(scene: string, itemId: number): Promise<ItemPlacement>;
  /** Paste transform (one undo step). */
  setItemPlacement(scene: string, itemId: number, placement: ItemPlacement): Promise<void>;

  // Video effects
  listEffects(source: string): Promise<EffectList>;
  addEffect(source: string, kind: EffectKind): Promise<EffectList>;
  removeEffect(source: string, effect: string): Promise<EffectList>;
  setEffectEnabled(source: string, effect: string, enabled: boolean): Promise<EffectList>;
  moveEffect(source: string, effect: string, direction: "up" | "down"): Promise<EffectList>;
  getEffectProperties(source: string, effect: string): Promise<PropertyDTO[]>;
  updateEffectSettings(source: string, effect: string, settings: Record<string, unknown>): Promise<PropertyDTO[]>;
  copyEffects(source: string): Promise<EffectSnapshot[]>;
  /** Appends copied effects to a source. */
  pasteEffects(source: string, effects: EffectSnapshot[]): Promise<EffectList>;
  pickFile(filter: string | undefined, directory: boolean): Promise<string | null>;

  // Audio
  setVolume(source: string, deflection: number): Promise<void>;
  setMuted(source: string, muted: boolean): Promise<void>;
  /** Filters, monitoring, sync offset and mono of an audio source. */
  getAudioDetails(source: string): Promise<AudioSourceDetails>;
  changeAudio(source: string, change: AudioChange): Promise<AudioSourceDetails>;
  /** Devices a desktop-audio or microphone source can use; null when it has no device choice. */
  listAudioDevices(source: string): Promise<AudioDeviceChoice | null>;
  setAudioDevice(source: string, deviceId: string): Promise<void>;
  /** Headphones that monitored sources play on (one setting for the whole app). */
  getMonitoringDevices(): Promise<MonitoringDevices>;
  setMonitoringDevice(deviceId: string): Promise<void>;

  // Preview
  /**
   * The rect the preview occupies (CSS pixels of the main window) and the
   * page's devicePixelRatio, reported again whenever either changes.
   */
  setPreviewBounds(rect: Rect | null, pixelRatio?: number): Promise<void>;
  /**
   * Studio mode only: where the program goes, in the same units as
   * setPreviewBounds. Takes effect with the setPreviewBounds call that follows.
   */
  setProgramBounds(rect: Rect | null, pixelRatio?: number): Promise<void>;
  /** Parks the preview off-screen while floating UI covers it, without tearing it down. */
  setPreviewHidden(hidden: boolean): Promise<void>;

  // Studio mode and projectors
  /** Studio mode: scene clicks load the preview; studioTransition sends it to the program. */
  setStudioMode(enabled: boolean): Promise<void>;
  /** Sends the preview scene to the program with the scene's transition, or with a cut. */
  studioTransition(quick: "cut" | null): Promise<void>;
  /** Screens a projector can fill. */
  listScreens(): Promise<ScreenChoice[]>;
  /** Opens a projector window, filling a screen when `screenId` is set. */
  openProjector(target: ProjectorTarget, screenId: number | null): Promise<void>;
  /**
   * Shows a native popup menu at a point in the window (CSS pixels). Native
   * menus draw above the preview surface, so it never has to hide for them.
   * Resolves with the chosen entry's index, or null when dismissed.
   */
  showMenu(entries: MenuEntry[], at: { x: number; y: number }): Promise<number | null>;

  // Settings
  setVideoSettings(settings: VideoSettings): Promise<void>;
  setEncoder(encoderId: string): Promise<void>;
  chooseRecordingFolder(): Promise<string | null>;
  setPreferences(patch: Partial<StudioPreferences>): Promise<void>;
  /** Stream delay and reconnect behaviour; refused while live. */
  setAdvancedSettings(patch: Partial<AdvancedStreamSettings>): Promise<void>;
  /** Marks the first-run setup as finished (or skipped). */
  completeSetup(): Promise<void>;

  // Scene collections and profiles (switching is refused while live, recording or on the virtual camera)
  /** Creates an empty collection and switches to it. */
  createCollection(name: string): Promise<void>;
  renameCollection(id: string, name: string): Promise<void>;
  /** Copies a collection under a new name without switching to it. */
  duplicateCollection(id: string, name: string): Promise<void>;
  removeCollection(id: string): Promise<void>;
  switchCollection(id: string): Promise<void>;
  /** Creates a profile with default settings and switches to it. */
  createProfile(name: string): Promise<void>;
  renameProfile(id: string, name: string): Promise<void>;
  duplicateProfile(id: string, name: string): Promise<void>;
  removeProfile(id: string): Promise<void>;
  switchProfile(id: string): Promise<void>;
  /** Audio sample rate and speakers (null = engine default; restarts the engine) and recorded tracks. */
  setOutputFormats(patch: { audio?: AudioFormat | null; recordingTracks?: number }): Promise<void>;
  /** Scene collections of OBS Studio and Streamlabs Desktop found on this computer. */
  findImports(): Promise<ImportCandidate[]>;
  /** Imports a found collection, or a file the user picks when `candidateId` is null; null when cancelled. */
  importCollection(candidateId: string | null, switchTo: boolean): Promise<ImportResult | null>;

  // Destinations
  saveDestination(draft: DestinationDraft): Promise<string>;
  removeDestination(id: string): Promise<void>;
  setDestinationEnabled(id: string, enabled: boolean): Promise<void>;

  // Accounts
  connectTwitch(): Promise<DeviceCodePrompt>;
  connectYouTube(): Promise<void>;
  disconnectAccount(accountId: string): Promise<void>;
  getBroadcastInfo(destinationId: string): Promise<BroadcastInfo>;
  setBroadcastInfo(destinationId: string, info: BroadcastInfo): Promise<void>;
  searchCategories(accountId: string, query: string): Promise<CategoryOption[]>;
  openExternal(url: string): Promise<void>;

  // Go live / record
  goLive(destinationIds: string[]): Promise<void>;
  checkStream(destinationIds: string[]): Promise<StreamCheck>;
  endStream(destinationIds: string[]): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  revealRecording(): Promise<void>;
  /** Saves the last seconds kept by instant replay to the recording folder. */
  saveReplay(): Promise<void>;

  // Hotkeys
  /** Binds a combo (canonical accelerator) to an action; null clears it. */
  setHotkey(action: string, combo: string | null): Promise<void>;
  /** Suspends hotkeys while the user presses a new combo in Settings. */
  setHotkeyCapture(active: boolean): Promise<void>;
  /** Opens the system setting that lets held keys (push-to-talk) work. */
  openInputAccessSettings(): Promise<void>;

  // Screen recording with the editor
  /** Opens the recording picker, or stops the screen recording that is running. */
  toggleScreenRecording(): Promise<void>;
  /** Lets the user choose a video and opens it in the recording editor. */
  openRecordingEditor(): Promise<void>;
  /** Tells the screen-recording windows which appearance the app uses. */
  setAppearance(theme: "dark" | "light"): Promise<void>;

  quitApp(): Promise<void>;
  /** Starts the engine again after it stopped unexpectedly. */
  restartEngine(): Promise<void>;

  // Permissions
  /** Asks the OS for access (shows the system prompt when possible). */
  requestPermission(kind: PermissionKind): Promise<PermissionState>;
  openPermissionSettings(kind: PermissionKind): Promise<void>;
  relaunchApp(): Promise<void>;

  // Chat
  getChat(): Promise<ChatState>;
  /** Chat connects only while the chat panel is shown. */
  setChatActive(active: boolean): Promise<void>;

  // Overlays
  listOverlays(): Promise<OverlaySummary[]>;
  listOverlayPresets(): Promise<PresetSummary[]>;
  getOverlay(id: string): Promise<OverlayDefinition>;
  createOverlayFromPreset(presetId: string): Promise<OverlaySummary>;
  updateOverlay(id: string, patch: OverlayPatch): Promise<OverlayDefinition>;
  resetOverlay(id: string): Promise<OverlayDefinition>;
  duplicateOverlay(id: string): Promise<OverlaySummary>;
  deleteOverlay(id: string): Promise<void>;
  /** Adds the overlay to a scene as a source; resolves with the source name. */
  addOverlayToScene(id: string, scene: string): Promise<string>;
  /** Live editor preview URL (demo data) for a library overlay or a preset. */
  overlayPreviewUrl(target: { overlayId?: string; presetId?: string }): Promise<string>;
  designOverlay(request: DesignRequest): Promise<DesignResult>;
  /** Clears this stream's follow/sub/bits counters used by goals. */
  resetStreamSession(): Promise<void>;

  // SEENALYZE account
  getSeenalyzeAccount(): Promise<SeenalyzeAccount | null>;
  signInSeenalyze(): Promise<SeenalyzeAccount>;
  signOutSeenalyze(): Promise<void>;
  /** Saves the interface language to the signed-in account. */
  setSeenalyzeLanguage(language: string): Promise<void>;

  // Events
  onSnapshot(listener: (snapshot: StudioSnapshot) => void): () => void;
  onStats(listener: (stats: EngineStats) => void): () => void;
  onAudioLevels(listener: (levels: AudioLevel[]) => void): () => void;
  onNotice(listener: (notice: Notice) => void): () => void;
  /** Fired when the user tries to close the window while live or recording. */
  onQuitRequest(listener: () => void): () => void;
  onChat(listener: (event: ChatEvent) => void): () => void;
}

/** One row of a native popup menu; `separator` rows ignore the other fields. */
export interface MenuEntry {
  label?: string;
  enabled?: boolean;
  separator?: boolean;
  /** Shows a check mark (the current choice in a list). */
  checked?: boolean;
}

export interface Notice {
  kind: "success" | "error" | "info";
  /** Translation key under `notices.*` or `errors.*`. */
  key: string;
  values?: Record<string, string | number>;
}

export const IPC = {
  invoke: "studio:invoke",
  snapshot: "studio:snapshot",
  stats: "studio:stats",
  audioLevels: "studio:audio-levels",
  notice: "studio:notice",
  quitRequest: "studio:quit-request",
  chat: "studio:chat",
} as const;

export type StudioMethod = Exclude<keyof StudioApi, `on${string}`>;

export const STUDIO_METHODS: readonly StudioMethod[] = [
  "getSnapshot",
  "createScene",
  "removeScene",
  "renameScene",
  "setActiveScene",
  "setTransition",
  "setSceneTransition",
  "pickStingerFile",
  "checkVirtualCamera",
  "installVirtualCamera",
  "startVirtualCamera",
  "stopVirtualCamera",
  "setVirtualCameraScene",
  "addSource",
  "listSourceChoices",
  "addExistingSource",
  "removeSceneItem",
  "setItemVisible",
  "setItemLocked",
  "moveSceneItem",
  "applyTransform",
  "patchItemTransform",
  "setSelectedItem",
  "undoCanvas",
  "redoCanvas",
  "getItemTransform",
  "setItemTransform",
  "getSourceProperties",
  "updateSourceSettings",
  "clickSourceButton",
  "renameSource",
  "moveScene",
  "duplicateScene",
  "duplicateSceneItem",
  "getItemPlacement",
  "setItemPlacement",
  "listEffects",
  "addEffect",
  "removeEffect",
  "setEffectEnabled",
  "moveEffect",
  "getEffectProperties",
  "updateEffectSettings",
  "copyEffects",
  "pasteEffects",
  "pickFile",
  "setVolume",
  "setMuted",
  "getAudioDetails",
  "changeAudio",
  "listAudioDevices",
  "setAudioDevice",
  "getMonitoringDevices",
  "setMonitoringDevice",
  "setPreviewBounds",
  "setPreviewHidden",
  "setProgramBounds",
  "setStudioMode",
  "studioTransition",
  "listScreens",
  "openProjector",
  "showMenu",
  "setVideoSettings",
  "setEncoder",
  "chooseRecordingFolder",
  "setPreferences",
  "setAdvancedSettings",
  "completeSetup",
  "createCollection",
  "renameCollection",
  "duplicateCollection",
  "removeCollection",
  "switchCollection",
  "createProfile",
  "renameProfile",
  "duplicateProfile",
  "removeProfile",
  "switchProfile",
  "setOutputFormats",
  "findImports",
  "importCollection",
  "saveDestination",
  "removeDestination",
  "setDestinationEnabled",
  "connectTwitch",
  "connectYouTube",
  "disconnectAccount",
  "getBroadcastInfo",
  "setBroadcastInfo",
  "searchCategories",
  "openExternal",
  "goLive",
  "checkStream",
  "endStream",
  "startRecording",
  "stopRecording",
  "revealRecording",
  "saveReplay",
  "setHotkey",
  "setHotkeyCapture",
  "openInputAccessSettings",
  "toggleScreenRecording",
  "openRecordingEditor",
  "setAppearance",
  "quitApp",
  "restartEngine",
  "requestPermission",
  "openPermissionSettings",
  "relaunchApp",
  "getChat",
  "setChatActive",
  "listOverlays",
  "listOverlayPresets",
  "getOverlay",
  "createOverlayFromPreset",
  "updateOverlay",
  "resetOverlay",
  "duplicateOverlay",
  "deleteOverlay",
  "addOverlayToScene",
  "overlayPreviewUrl",
  "designOverlay",
  "resetStreamSession",
  "getSeenalyzeAccount",
  "signInSeenalyze",
  "signOutSeenalyze",
  "setSeenalyzeLanguage",
];

/** Errors crossing IPC carry a translation key instead of English text. */
export class StudioError extends Error {
  constructor(public readonly key: string) {
    super(key);
    this.name = "StudioError";
  }
}

export const STUDIO_ERROR_PREFIX = "studio-error:";
