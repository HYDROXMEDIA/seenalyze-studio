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

export interface StudioApi {
  getSnapshot(): Promise<StudioSnapshot>;

  // Scenes
  createScene(name: string): Promise<void>;
  removeScene(name: string): Promise<void>;
  renameScene(name: string, nextName: string): Promise<void>;
  setActiveScene(name: string): Promise<void>;
  /** Picks the scene transition preset and its duration; applies immediately. */
  setTransition(choice: TransitionChoice): Promise<void>;

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
  getItemTransform(scene: string, itemId: number): Promise<SourceTransformDTO>;
  setItemTransform(scene: string, itemId: number, transform: SourceTransform): Promise<void>;
  getSourceProperties(source: string): Promise<PropertyDTO[]>;
  updateSourceSettings(source: string, settings: Record<string, unknown>): Promise<PropertyDTO[]>;
  clickSourceButton(source: string, property: string): Promise<PropertyDTO[]>;
  renameSource(source: string, nextName: string): Promise<void>;
  pickFile(filter: string | undefined, directory: boolean): Promise<string | null>;

  // Audio
  setVolume(source: string, deflection: number): Promise<void>;
  setMuted(source: string, muted: boolean): Promise<void>;

  // Preview
  setPreviewBounds(rect: Rect | null): Promise<void>;
  /** Parks the preview off-screen while floating UI covers it, without tearing it down. */
  setPreviewHidden(hidden: boolean): Promise<void>;

  // Settings
  setVideoSettings(settings: VideoSettings): Promise<void>;
  setEncoder(encoderId: string): Promise<void>;
  chooseRecordingFolder(): Promise<string | null>;
  setPreferences(patch: Partial<StudioPreferences>): Promise<void>;

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

  // Events
  onSnapshot(listener: (snapshot: StudioSnapshot) => void): () => void;
  onStats(listener: (stats: EngineStats) => void): () => void;
  onAudioLevels(listener: (levels: AudioLevel[]) => void): () => void;
  onNotice(listener: (notice: Notice) => void): () => void;
  /** Fired when the user tries to close the window while live or recording. */
  onQuitRequest(listener: () => void): () => void;
  onChat(listener: (event: ChatEvent) => void): () => void;
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
  "getItemTransform",
  "setItemTransform",
  "getSourceProperties",
  "updateSourceSettings",
  "clickSourceButton",
  "renameSource",
  "pickFile",
  "setVolume",
  "setMuted",
  "setPreviewBounds",
  "setPreviewHidden",
  "setVideoSettings",
  "setEncoder",
  "chooseRecordingFolder",
  "setPreferences",
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
];

/** Errors crossing IPC carry a translation key instead of English text. */
export class StudioError extends Error {
  constructor(public readonly key: string) {
    super(key);
    this.name = "StudioError";
  }
}

export const STUDIO_ERROR_PREFIX = "studio-error:";
