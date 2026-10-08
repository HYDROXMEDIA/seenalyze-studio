// Scene transition presets. Each maps to a libobs transition type with fixed
// settings; the renderer shows them in a picker and the engine applies them.

export type TransitionPresetId =
  | "cut"
  | "fade"
  | "fadeBlack"
  | "fadeWhite"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "swipeLeft"
  | "swipeRight"
  | "swipeUp"
  | "swipeDown"
  | "wipeLinear"
  | "wipeClock"
  | "wipeIris"
  | "wipeBarnDoor"
  | "wipeBlinds"
  | "wipeCheckerboard"
  | "shuffle"
  | "stinger";

export interface TransitionPreset {
  id: TransitionPresetId;
  /** libobs transition type id. */
  engineId: string;
  settings: Record<string, unknown>;
  defaultDurationMs: number;
  /** A cut has no duration. */
  instant?: boolean;
  /** Plays a video file the user picks (settings come from TransitionChoice.stinger). */
  file?: boolean;
}

export type StingerMatte = "none" | "sideBySide" | "stacked" | "mask";
/** Who hears the stinger's own sound. */
export type StingerAudio = "stream" | "monitor" | "both";
/** How scene audio changes: fade out then in at the transition point, or crossfade. */
export type StingerAudioFade = "fadeOutIn" | "crossfade";

export interface StingerOptions {
  /** Absolute path of the video file. */
  path: string;
  /** Length of the video when it was picked; 0 when unknown. */
  videoMs: number;
  /** Where the scenes switch: milliseconds from the start, or percent of the video. */
  point: { unit: "ms" | "percent"; value: number };
  matte: StingerMatte;
  invertMatte: boolean;
  audio: StingerAudio;
  audioFade: StingerAudioFade;
}

export interface TransitionChoice {
  id: TransitionPresetId;
  durationMs: number;
  /** Present only for the stinger transition. */
  stinger?: StingerOptions;
}

export const TRANSITION_MIN_MS = 50;
export const TRANSITION_MAX_MS = 5000;

const slide = (id: TransitionPresetId, direction: string): TransitionPreset => ({
  id,
  engineId: "slide_transition",
  settings: { direction },
  defaultDurationMs: 500,
});
const swipe = (id: TransitionPresetId, direction: string): TransitionPreset => ({
  id,
  engineId: "swipe_transition",
  settings: { direction, swipe_in: true },
  defaultDurationMs: 500,
});
const wipe = (id: TransitionPresetId, image: string): TransitionPreset => ({
  id,
  engineId: "wipe_transition",
  settings: { luma_image: image, luma_softness: 0.03, luma_invert: false },
  defaultDurationMs: 700,
});

export const TRANSITION_PRESETS: readonly TransitionPreset[] = [
  {
    id: "fade",
    engineId: "fade_transition",
    settings: {},
    defaultDurationMs: 300,
  },
  {
    id: "cut",
    engineId: "cut_transition",
    settings: {},
    defaultDurationMs: 0,
    instant: true,
  },
  {
    id: "fadeBlack",
    engineId: "fade_to_color_transition",
    settings: { color: 0xff000000, switch_point: 50 },
    defaultDurationMs: 600,
  },
  {
    id: "fadeWhite",
    engineId: "fade_to_color_transition",
    settings: { color: 0xffffffff, switch_point: 50 },
    defaultDurationMs: 600,
  },
  slide("slideLeft", "left"),
  slide("slideRight", "right"),
  slide("slideUp", "up"),
  slide("slideDown", "down"),
  swipe("swipeLeft", "left"),
  swipe("swipeRight", "right"),
  swipe("swipeUp", "up"),
  swipe("swipeDown", "down"),
  wipe("wipeLinear", "linear-h.png"),
  wipe("wipeClock", "clock.png"),
  wipe("wipeIris", "iris.png"),
  wipe("wipeBarnDoor", "barndoor-h.png"),
  wipe("wipeBlinds", "blinds-h.png"),
  wipe("wipeCheckerboard", "checkerboard-small.png"),
  {
    id: "shuffle",
    engineId: "shuffle_transition",
    settings: {},
    defaultDurationMs: 700,
  },
  {
    id: "stinger",
    engineId: "obs_stinger_transition",
    settings: {},
    defaultDurationMs: 1000,
    file: true,
  },
];

export const DEFAULT_TRANSITION: TransitionChoice = {
  id: "fade",
  durationMs: 300,
};

export function transitionPreset(id: string): TransitionPreset | undefined {
  return TRANSITION_PRESETS.find((preset) => preset.id === id);
}

/** Presets the installed engine can create. */
export function availablePresets(engineTypes: readonly string[]): TransitionPreset[] {
  return TRANSITION_PRESETS.filter((preset) => engineTypes.includes(preset.engineId));
}

// ----- stinger --------------------------------------------------------------

/** Video formats a stinger can play (webm and mov keep transparency). */
export const STINGER_EXTENSIONS = ["webm", "mov", "mp4", "mkv"] as const;
const MAX_PATH_LENGTH = 4096;
const DEFAULT_STINGER_POINT_MS = 500;
const MAX_STINGER_MS = 60_000;
const STINGER_MATTES: readonly StingerMatte[] = ["none", "sideBySide", "stacked", "mask"];
const STINGER_AUDIO: readonly StingerAudio[] = ["stream", "monitor", "both"];
const STINGER_FADES: readonly StingerAudioFade[] = ["fadeOutIn", "crossfade"];

function fileExtension(path: string): string {
  const name = path.split(/[\\/]/u).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** True for an absolute path (macOS or Windows) to a supported video file. */
export function isStingerPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_LENGTH || value.includes("\0")) return false;
  const absolute = value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\");
  return absolute && (STINGER_EXTENSIONS as readonly string[]).includes(fileExtension(value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Valid stinger options, or null when the file path is unusable. */
export function sanitizeStinger(value: unknown): StingerOptions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<Record<keyof StingerOptions, unknown>>;
  if (!isStingerPath(raw.path)) return null;
  const videoMs = Math.min(MAX_STINGER_MS, Math.max(0, Math.round(finite(raw.videoMs, 0))));
  const rawPoint = (raw.point && typeof raw.point === "object" ? raw.point : {}) as { unit?: unknown; value?: unknown };
  // A percentage needs the video's length; without it the point is in milliseconds.
  const unit = rawPoint.unit === "percent" && videoMs > 0 ? "percent" : "ms";
  const limit = unit === "percent" ? 100 : videoMs > 0 ? videoMs : MAX_STINGER_MS;
  const fallback = unit === "percent" ? 50 : Math.min(DEFAULT_STINGER_POINT_MS, limit);
  // A percentage that had to become milliseconds says nothing about the time.
  const given = rawPoint.unit === unit || (rawPoint.unit === undefined && unit === "ms") ? rawPoint.value : undefined;
  const pointValue = Math.min(limit, Math.max(0, Math.round(finite(given, fallback))));
  return {
    path: raw.path,
    videoMs,
    point: { unit, value: pointValue },
    matte: pick(raw.matte, STINGER_MATTES, "none"),
    invertMatte: raw.invertMatte === true,
    audio: pick(raw.audio, STINGER_AUDIO, "stream"),
    audioFade: pick(raw.audioFade, STINGER_FADES, "fadeOutIn"),
  };
}

/** Starting options for a freshly picked file: switch halfway through when the length is known. */
export function defaultStinger(path: string, videoMs: number): StingerOptions | null {
  return sanitizeStinger({ path, videoMs, point: { unit: "percent", value: 50 } });
}

/** Transition point in milliseconds from the start of the video. */
export function stingerPointMs(options: StingerOptions): number {
  if (options.point.unit === "percent") return Math.round((options.videoMs * options.point.value) / 100);
  return options.point.value;
}

const MATTE_LAYOUT: Record<Exclude<StingerMatte, "none">, number> = { sideBySide: 0, stacked: 1, mask: 3 };
const MONITORING: Record<StingerAudio, number> = { stream: 0, monitor: 1, both: 2 };

/** Engine settings for the stinger transition (obs_stinger_transition). */
export function stingerSettings(options: StingerOptions): Record<string, unknown> {
  return {
    path: options.path,
    // 0: time in milliseconds (1 would be a frame number).
    tp_type: 0,
    transition_point: stingerPointMs(options),
    track_matte_enabled: options.matte !== "none",
    track_matte_layout: options.matte === "none" ? 0 : MATTE_LAYOUT[options.matte],
    invert_matte: options.invertMatte,
    audio_monitoring: MONITORING[options.audio],
    audio_fade_style: options.audioFade === "crossfade" ? 1 : 0,
    hw_decode: true,
  };
}

/** Engine settings for a choice: fixed preset settings, or the stinger's file options. */
export function transitionSettings(choice: TransitionChoice): Record<string, unknown> {
  const preset = transitionPreset(choice.id);
  if (!preset) return {};
  return preset.file && choice.stinger ? stingerSettings(choice.stinger) : preset.settings;
}

/**
 * Engine objects are reused per type; a stinger is kept per file so switching
 * between stingers does not reload a video right before it plays.
 */
export function transitionKey(choice: TransitionChoice): string {
  const preset = transitionPreset(choice.id);
  if (!preset) return choice.id;
  return preset.file && choice.stinger ? `${preset.engineId}\u0000${choice.stinger.path}` : preset.engineId;
}

// ----- sanitizing -------------------------------------------------------------

/** A valid choice, or null for unknown presets and stingers without a usable file. */
export function parseTransition(value: unknown): TransitionChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<TransitionChoice>;
  const preset = typeof raw.id === "string" ? transitionPreset(raw.id) : undefined;
  if (!preset) return null;
  if (preset.instant) return { id: preset.id, durationMs: 0 };
  if (preset.file) {
    const stinger = sanitizeStinger(raw.stinger);
    if (!stinger) return null;
    // The engine plays the whole video; the duration only has to be non-zero.
    const durationMs = stinger.videoMs > 0 ? stinger.videoMs : preset.defaultDurationMs;
    return { id: preset.id, durationMs: Math.min(MAX_STINGER_MS, Math.max(TRANSITION_MIN_MS, durationMs)), stinger };
  }
  const duration = typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) ? Math.round(raw.durationMs) : preset.defaultDurationMs;
  return {
    id: preset.id,
    durationMs: Math.min(TRANSITION_MAX_MS, Math.max(TRANSITION_MIN_MS, duration)),
  };
}

/** Returns a valid choice: unknown presets fall back to Fade, durations are clamped. */
export function sanitizeTransition(value: unknown): TransitionChoice {
  return parseTransition(value) ?? { ...DEFAULT_TRANSITION };
}

// ----- per-scene overrides ----------------------------------------------------

const MAX_OVERRIDES = 500;
const MAX_SCENE_NAME = 256;

/** Scene name → transition used when switching into that scene. Invalid entries are dropped. */
export function sanitizeTransitionOverrides(value: unknown): Record<string, TransitionChoice> {
  const clean: Record<string, TransitionChoice> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return clean;
  for (const [scene, choice] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(clean).length >= MAX_OVERRIDES) break;
    if (!scene || scene.length > MAX_SCENE_NAME) continue;
    const parsed = parseTransition(choice);
    if (parsed) clean[scene] = parsed;
  }
  return clean;
}

/**
 * The transition for switching into `scene`: its override, else the default.
 * A stinger whose file is gone falls back to the next choice, then to Fade.
 */
export function resolveSceneTransition(
  fallback: TransitionChoice,
  override: TransitionChoice | undefined,
  fileExists: (path: string) => boolean,
): TransitionChoice {
  const usable = (choice: TransitionChoice | undefined): choice is TransitionChoice => Boolean(choice && (!choice.stinger || fileExists(choice.stinger.path)));
  if (usable(override)) return override;
  if (usable(fallback)) return fallback;
  return { ...DEFAULT_TRANSITION };
}
