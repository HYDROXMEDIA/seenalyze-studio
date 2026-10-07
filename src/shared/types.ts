// Domain types shared by the main process, preload bridge and renderer.
// Nothing here may reference Electron, Node or libobs objects directly.

import type { TransitionChoice } from "./transitions";

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
}

export const SCALE_FILTERS = ["bilinear", "bicubic", "lanczos", "area"] as const;
export type ScaleFilter = (typeof SCALE_FILTERS)[number];

export const RECORDING_FORMATS = ["mkv", "mp4", "mov"] as const;
export type RecordingFormat = (typeof RECORDING_FORMATS)[number];

/** App behaviour preferences persisted with the studio state. */
export interface StudioPreferences {
  recordingFormat: RecordingFormat;
  recordingBitrateKbps: number;
  /** Ask before going live. Ending a stream always asks. */
  confirmGoLive: boolean;
  /** Prevent the computer from sleeping while streaming or recording. */
  keepAwakeWhileLive: boolean;
}

export const RECORDING_BITRATE_RANGE = { min: 2500, max: 100000 } as const;

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

export interface EngineStats {
  cpu: number;
  fps: number;
  renderLagFrames: number;
  totalFrames: number;
  memoryMb: number;
}

export type SourceKind =
  | "display"
  | "window"
  | "camera"
  | "microphone"
  | "desktopAudio"
  | "image"
  | "media"
  | "text"
  | "color"
  | "browser"
  | "chatOverlay"
  | "overlay";

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
}

/** Interactive transform change from the preview editor. */
export interface ItemTransformPatch {
  position?: { x: number; y: number };
  scale?: { x: number; y: number };
  rotation?: number;
  /** Only applied to items with a bounds type. */
  bounds?: { x: number; y: number };
}

export interface SceneDTO {
  name: string;
  items: SceneItemDTO[];
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
}

export interface StudioSnapshot {
  ready: boolean;
  engineErrorKey?: string;
  scenes: SceneDTO[];
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
  accounts: AccountDTO[];
  platformsConfigured: Record<Platform, boolean>;
  permissions: Record<PermissionKind, PermissionState>;
  /** Twitch follower alerts need a reconnect when the sign-in predates their permission. */
  overlayData: { twitchFollows: "connecting" | "connected" | "needsReconnect" | "offline" | "unavailable" };
  /** Scene transition used when switching scenes. */
  transition: TransitionChoice;
  /** Scene item selected for editing (shared by the sources list and the preview editor). */
  selectedItemId: number | null;
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
