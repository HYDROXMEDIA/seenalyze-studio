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
  | "wipeCheckerboard";

export interface TransitionPreset {
  id: TransitionPresetId;
  /** libobs transition type id. */
  engineId: string;
  settings: Record<string, unknown>;
  defaultDurationMs: number;
  /** A cut has no duration. */
  instant?: boolean;
}

export interface TransitionChoice {
  id: TransitionPresetId;
  durationMs: number;
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
];

export const DEFAULT_TRANSITION: TransitionChoice = {
  id: "fade",
  durationMs: 300,
};

export function transitionPreset(id: string): TransitionPreset | undefined {
  return TRANSITION_PRESETS.find((preset) => preset.id === id);
}

/** Returns a valid choice: unknown presets fall back to Fade, durations are clamped. */
export function sanitizeTransition(value: unknown): TransitionChoice {
  const raw = (value ?? {}) as Partial<TransitionChoice>;
  const preset = typeof raw.id === "string" ? transitionPreset(raw.id) : undefined;
  if (!preset) return { ...DEFAULT_TRANSITION };
  if (preset.instant) return { id: preset.id, durationMs: 0 };
  const duration = typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) ? Math.round(raw.durationMs) : preset.defaultDurationMs;
  return {
    id: preset.id,
    durationMs: Math.min(TRANSITION_MAX_MS, Math.max(TRANSITION_MIN_MS, duration)),
  };
}
