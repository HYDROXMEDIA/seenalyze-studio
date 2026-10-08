// Domain types shared by the main process, preload bridge and renderer.
// Nothing here may reference Electron, Node or libobs objects directly.

import type { TransitionChoice, TransitionPresetId } from "./transitions";
import type { VirtualCameraStatus } from "./virtual-camera";
import type { ColorFormat, ColorRange, ColorSpace } from "./formats";
import type { WorkspaceSnapshot } from "./workspace";

export type Platform = "youtube" | "twitch";

export type VideoCodec = "h264";

export interface VideoSettings {
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
  fps: number;
  /** Filter used when the output resolution differs from the canvas. */
  scaleFilter: ScaleFilter;
  /** Exact fractional frame rate (e.g. 30000/1001); absent = whole `fps` (see formats.ts). */
  fpsNum?: number;
  fpsDen?: number;
  /** Advanced color settings; absent = NV12, Rec. 709, limited range. */
  colorFormat?: ColorFormat;
  colorSpace?: ColorSpace;
  colorRange?: ColorRange;
}

export const SCALE_FILTERS = ["bilinear", "bicubic", "lanczos", "area"] as const;
export type ScaleFilter = (typeof SCALE_FILTERS)[number];

export const RECORDING_FORMATS = ["mkv", "mp4", "mov"] as const;
export type RecordingFormat = (typeof RECORDING_FORMATS)[number];

/** App behaviour preferences persisted with the studio state. */
export interface StudioPreferences {
  recordingFormat: RecordingFormat;
  recordingBitrateKbps: number;
  /** Ask before going live. */
  confirmGoLive: boolean;
  /** Ask before ending a live stream. */
  confirmEndStream: boolean;
  /** Prevent the computer from sleeping while streaming or recording. */
  keepAwakeWhileLive: boolean;
  /** Record at the stream's quality, sharing its encoder when a stream is live. */
  recordingMatchStream: boolean;
  /** Start recording whenever a stream starts. */
  autoRecord: boolean;
  /** Keep an automatic recording running after the stream ends. */
  keepRecordingAfterStream: boolean;
  /** Keep the last seconds of the program in memory so they can be saved as a clip. */
  replayBufferEnabled: boolean;
  replayBufferSeconds: number;
}

export const REPLAY_SECONDS_RANGE = { min: 5, max: 300 } as const;

export const RECORDING_BITRATE_RANGE = { min: 2500, max: 100000 } as const;

/** Stream output behaviour (Settings › Advanced). Applies to streams started afterwards. */
export interface AdvancedStreamSettings {
  /** 0 = off. */
  streamDelaySec: number;
  reconnectDelaySec: number;
  reconnectMaxRetries: number;
}

export const ADVANCED_STREAM_RANGES = {
  streamDelaySec: { min: 0, max: 600 },
  reconnectDelaySec: { min: 1, max: 30 },
  reconnectMaxRetries: { min: 1, max: 100 },
} as const;

export const DEFAULT_ADVANCED_STREAM: AdvancedStreamSettings = {
  streamDelaySec: 0,
  reconnectDelaySec: 2,
  reconnectMaxRetries: 25,
};

/** Speed/quality trade-off of the video encoder; "balanced" keeps the encoder's own default. */
export const ENCODER_PRESETS = ["performance", "balanced", "quality"] as const;
export type EncoderPreset = (typeof ENCODER_PRESETS)[number];

export interface EncoderOption {
  /** Engine encoder name, e.g. "apple_h264", "nvenc", "x264". */
  id: string;
  hardware: boolean;
}

/** What a destination needs from the video it receives. */
export interface DestinationProfile {
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  keyframeSec: number;
  codec: VideoCodec;
  /** Absent in profiles saved before the setting existed; treated as "balanced". */
  encoderPreset?: EncoderPreset;
}

export type ConnectionMode = "account" | "manual";

export interface DestinationConfig {
  id: string;
  platform: Platform;
  name: string;
  enabled: boolean;
  mode: ConnectionMode;
  /** RTMP(S) server URL. The stream key lives in secure storage, never here. */
  server: string;
  hasStreamKey: boolean;
  accountId?: string;
  profile: DestinationProfile;
}

export interface DestinationDraft {
  id?: string;
  platform: Platform;
  name: string;
  enabled: boolean;
  mode: ConnectionMode;
  server: string;
  /** Only sent when the user changes it; undefined keeps the stored key. */
  streamKey?: string;
  accountId?: string;
  profile: DestinationProfile;
}

export type OutputState =
  | "idle"
  | "preparing"
  | "connecting"
  | "live"
  | "reconnecting"
  | "stopping"
  | "error";

export interface DestinationStatus {
  id: string;
  state: OutputState;
  kbps: number;
  droppedFrames: number;
  totalFrames: number;
  encoderGroup: number | null;
  /** Translation key under `errors.*`, never raw engine text. */
  errorKey?: string;
  startedAt?: number;
}

export interface RecordingStatus {
  active: boolean;
  startedAt?: number;
  lastFile?: string;
  errorKey?: string;
}

export interface ReplayStatus {
  /** The buffer is running and a clip can be saved. */
  active: boolean;
  errorKey?: string;
}

/** Global hotkeys: saved combos per action and what keeps some from working. */
export interface HotkeyStatus {
  bindings: Record<string, string>;
  /** Combos another app or the system already holds. */
  unavailable: string[];
  /** Held keys (push-to-talk) need input access on macOS. */
  inputAccess: "granted" | "needed" | "unused";
}

export interface ScreenRecordingStatus {
  active: boolean;
  paused: boolean;
}

export interface EngineStats {
  cpu: number;
  fps: number;
  renderLagFrames: number;
  totalFrames: number;
  memoryMb: number;
  /** Free space where recordings are saved, added by the main process. */
  diskFreeMb?: number;
  /** Measured recording bitrate while recording, added by the main process. */
  recordingKbps?: number;
}

export type SourceKind =
  | "display"
  | "window"
  | "application"
  | "game"
  | "camera"
  | "captureCard"
  | "microphone"
  | "desktopAudio"
  | "applicationAudio"
  | "image"
  | "slideshow"
  | "media"
  | "playlist"
  | "scene"
  | "syphon"
  | "blackmagic"
  | "text"
  | "color"
  | "browser"
  | "chatOverlay"
  | "overlay";

export interface SourceChoiceDTO {
  name: string;
  kind: SourceKind | "other";
}

export interface SceneItemDTO {
  id: number;
  sourceName: string;
  kind: SourceKind | "other";
  visible: boolean;
  locked: boolean;
  /** Placement on the canvas; absent for items without a visual size. */
  transform?: ItemTransformDTO;
}

/** A scene item's placement, in canvas pixels (libobs semantics). */
export interface ItemTransformDTO {
  /** Canvas position of the item's alignment point (also the rotation pivot). */
  position: { x: number; y: number };
  scale: { x: number; y: number };
  /** Degrees, clockwise. */
  rotation: number;
  /** libobs alignment flags: left 1, right 2, top 4, bottom 8 (0 = center). */
  alignment: number;
  /** 0 = none (sized by scale); otherwise the item is sized by `bounds`. */
  boundsType: number;
  bounds: { x: number; y: number };
  /** Source size after crop, in source pixels. */
  sourceWidth: number;
  sourceHeight: number;
  /** Source pixels cut from each edge. */
  crop?: { left: number; top: number; right: number; bottom: number };
}

/** Interactive transform change from the preview editor. */
export interface ItemTransformPatch {
  position?: { x: number; y: number };
  scale?: { x: number; y: number };
  rotation?: number;
  /** Only applied to items with a bounds type. */
  bounds?: { x: number; y: number };
  /** Source pixels cut from each edge (Alt-drag on a handle). */
  crop?: { left: number; top: number; right: number; bottom: number };
}

/** Everything that places an item on the canvas; used to undo canvas edits. */
export interface ItemPlacement {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  alignment: number;
  boundsType: number;
  boundsAlignment: number;
  bounds: { x: number; y: number };
  crop: { left: number; top: number; right: number; bottom: number };
}

export interface SceneDTO {
  name: string;
  items: SceneItemDTO[];
  /** Transition used when switching into this scene; absent: the default transition. */
  transition?: TransitionChoice;
}

export interface AudioSourceDTO {
  name: string;
  /** Linear 0..1 fader deflection. */
  deflection: number;
  muted: boolean;
  global: boolean;
  /** True for a microphone, which needs microphone access before unmuting. */
  microphone: boolean;
}

export interface AudioLevel {
  name: string;
  /** Peak per channel, in dBFS. */
  peak: number[];
}

export type PropertyKind =
  | "boolean"
  | "int"
  | "float"
  | "text"
  | "password"
  | "multiline"
  | "path"
  | "list"
  | "editableList"
  | "font"
  | "color"
  | "button"
  | "info";

export interface PropertyDTO {
  name: string;
  label: string;
  kind: PropertyKind;
  enabled: boolean;
  value: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string | number }[];
  pathFilter?: string;
  directory?: boolean;
  allowUrls?: boolean;
  allowAlpha?: boolean;
}

export interface StudioSnapshot {
  ready: boolean;
  engineErrorKey?: string;
  scenes: SceneDTO[];
  availableSourceKinds: SourceKind[];
  activeScene: string | null;
  audio: AudioSourceDTO[];
  video: VideoSettings;
  encoders: EncoderOption[];
  selectedEncoder: string;
  destinations: DestinationConfig[];
  destinationStatus: DestinationStatus[];
  recording: RecordingStatus;
  recordingFolder: string;
  preferences: StudioPreferences;
  advanced: AdvancedStreamSettings;
  /** True until a new user finishes or skips the first-run setup. */
  setupPending: boolean;
  screenRecording: ScreenRecordingStatus;
  accounts: AccountDTO[];
  platformsConfigured: Record<Platform, boolean>;
  permissions: Record<PermissionKind, PermissionState>;
  /** Twitch follower alerts need a reconnect when the sign-in predates their permission. */
  overlayData: { twitchFollows: "connecting" | "connected" | "needsReconnect" | "offline" | "unavailable" };
  /** Scene transition used when switching scenes. */
  transition: TransitionChoice;
  /** Transition presets the engine can play. */
  availableTransitions: TransitionPresetId[];
  virtualCamera: VirtualCameraStatus;
  /** Scene item selected for editing (shared by the sources list and the preview editor). */
  selectedItemId: number | null;
  /** Whether canvas edits can be undone or redone. */
  canvasHistory: { canUndo: boolean; canRedo: boolean };
  replayBuffer: ReplayStatus;
  hotkeys: HotkeyStatus;
  /** Scene collections, profiles and advanced audio formats. */
  workspace: WorkspaceSnapshot;
  /** Studio mode: scene clicks load the preview (activeScene), Transition sends it to the program. */
  studioMode: StudioModeState;
}

// ----- permissions -----------------------------------------------------------

export type PermissionKind = "camera" | "microphone" | "screen";

/** "unsupported" means the OS has no per-app setting for it (nothing to ask). */
export type PermissionState = "granted" | "denied" | "not-determined" | "restricted" | "unsupported";

// ----- chat --------------------------------------------------------------------

export type ChatSegment =
  | { type: "text"; text: string }
  | { type: "emote"; name: string; url: string };

export type ChatBadge = "owner" | "moderator" | "vip" | "member" | "subscriber" | "verified";

export interface ChatMessage {
  /** Unique across platforms: `${platform}:${platform message id}`. */
  id: string;
  platform: Platform;
  accountId: string;
  authorId: string;
  authorName: string;
  /** Hex color chosen by the author (Twitch), if any. */
  authorColor?: string;
  avatarUrl?: string;
  badges: ChatBadge[];
  segments: ChatSegment[];
  /** Paid or celebratory messages (Super Chat, subscriptions…). */
  highlight?: { kind: "paid" | "membership" | "subscription" | "announcement"; label: string };
  timestamp: number;
}

export type ChatConnectionState = "connecting" | "connected" | "waiting" | "error" | "offline";

export interface ChatSourceStatus {
  accountId: string;
  platform: Platform;
  channelName: string;
  state: ChatConnectionState;
  /** Translation key under `chat.errors.*` when state is "error". */
  errorKey?: string;
}

export type ChatEvent =
  | { type: "messages"; messages: ChatMessage[] }
  | { type: "remove"; ids: string[] }
  | { type: "removeAuthor"; platform: Platform; authorId: string }
  | { type: "clear"; accountId: string }
  | { type: "sources"; sources: ChatSourceStatus[] };

export interface ChatState {
  messages: ChatMessage[];
  sources: ChatSourceStatus[];
}

export interface AccountDTO {
  id: string;
  platform: Platform;
  displayName: string;
  channelId: string;
}

export interface BroadcastInfo {
  title: string;
  /** Twitch category id (game id). */
  categoryId?: string;
  categoryName?: string;
  /** YouTube privacy status. */
  privacy?: "public" | "unlisted" | "private";
}

export interface CategoryOption {
  id: string;
  name: string;
}

export interface DeviceCodePrompt {
  verificationUri: string;
  userCode: string;
  expiresInSec: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TransformPreset = "fit" | "stretch" | "center" | "reset";

export type TransformAnchor = "topLeft" | "top" | "topRight" | "left" | "center" | "right" | "bottomLeft" | "bottom" | "bottomRight";
export interface SourceTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  sizing: "fit" | "stretch" | "scale";
  anchor: TransformAnchor;
  crop: { left: number; top: number; right: number; bottom: number };
}

export interface SourceTransformDTO extends SourceTransform {
  sourceName: string;
  sourceWidth: number;
  sourceHeight: number;
  locked: boolean;
}

export interface SceneReadiness {
  scene: string | null;
  pictureSources: number;
  pendingSources: number;
  audibleSources: number;
  missingSources: number;
}

export interface StreamCheck {
  readyDestinationIds: string[];
  scene: string | null;
  issues: { key: string; blocking: boolean; destinationId?: string; count?: number }[];
}

// ----- studio mode and projectors ----------------------------------------------

export interface StudioModeState {
  enabled: boolean;
  /** Scene on the program output (in studio mode, activeScene is the preview scene). */
  programScene: string | null;
}

/** What a projector window shows. */
export type ProjectorTarget =
  | { kind: "program" }
  | { kind: "preview" }
  | { kind: "multiview" }
  | { kind: "scene"; name: string }
  | { kind: "source"; name: string };

/** What one native display shows (resolved to an engine source by the engine). */
export type DisplaySpec = { kind: "program" } | { kind: "studioPreview" } | { kind: "scene"; name: string } | { kind: "source"; name: string };

/** A screen a projector can fill. */
export interface ScreenChoice {
  id: number;
  label: string;
  primary: boolean;
}
