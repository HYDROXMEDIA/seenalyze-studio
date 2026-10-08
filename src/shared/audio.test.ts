import { describe, expect, test } from "bun:test";
import {
  AUDIO_FILTER_KINDS,
  AUDIO_FILTER_SPECS,
  CLEANUP_CHAIN,
  DEFAULT_AUDIO_PROCESSING,
  MAX_AUDIO_FILTERS,
  applyAudioChange,
  isCleanupOn,
  sanitizeAudioChange,
  sanitizeAudioProcessing,
  sanitizeFilterSettings,
  type AudioFilterKind,
  type AudioProcessing,
} from "./audio";

const ALL = new Set<AudioFilterKind>(AUDIO_FILTER_KINDS);
function ids() {
  let next = 0;
  return (kind: AudioFilterKind, cleanup: boolean) => `${cleanup ? "c" : "a"}-${kind}-${++next}`;
}
const empty = (): AudioProcessing => ({ ...DEFAULT_AUDIO_PROCESSING, filters: [] });

describe("filter catalog", () => {
  test("every parameter has a valid default", () => {
    for (const kind of AUDIO_FILTER_KINDS) {
      const spec = AUDIO_FILTER_SPECS[kind];
      expect(spec.engineIds.length).toBeGreaterThan(0);
      for (const param of spec.params) {
        const value = spec.defaults[param.key];
        if (param.type === "number") {
          expect(typeof value).toBe("number");
          expect(value as number).toBeGreaterThanOrEqual(param.min);
          expect(value as number).toBeLessThanOrEqual(param.max);
        } else if (param.type === "choice") {
          expect(param.options).toContain(value as string);
        } else {
          expect(typeof value).toBe("string");
        }
      }
    }
  });

  test("cleanup settings are within range", () => {
    for (const step of CLEANUP_CHAIN) expect(sanitizeFilterSettings(step.kind, step.settings)).toEqual({ ...AUDIO_FILTER_SPECS[step.kind].defaults, ...step.settings });
  });
});

describe("sanitizeFilterSettings", () => {
  test("clamps, rounds to the step and ignores unknown or invalid values", () => {
    const result = sanitizeFilterSettings("compressor", { ratio: 99, threshold: -18.4, attack_time: "fast", evil: 1, sidechain_source: "Desktop audio" });
    expect(result.ratio).toBe(32);
    expect(result.threshold).toBe(-18);
    expect(result.attack_time).toBe(6);
    expect(result.sidechain_source).toBe("Desktop audio");
    expect(result).not.toHaveProperty("evil");
  });

  test("keeps current values not in the patch", () => {
    const current = sanitizeFilterSettings("noiseGate", { open_threshold: -20 });
    expect(sanitizeFilterSettings("noiseGate", { hold_time: 500 }, current)).toMatchObject({ open_threshold: -20, hold_time: 500 });
  });

  test("rejects unknown choices", () => {
    expect(sanitizeFilterSettings("noiseSuppression", { method: "magic" }).method).toBe("rnnoise");
  });
});

describe("sanitizeAudioProcessing", () => {
  test("falls back to defaults for unreadable data", () => {
    expect(sanitizeAudioProcessing(null)).toEqual(DEFAULT_AUDIO_PROCESSING);
    expect(sanitizeAudioProcessing({ monitoring: "loud", syncOffsetMs: 1e9, mono: "yes" })).toEqual({ filters: [], monitoring: "off", syncOffsetMs: 20000, mono: false });
  });

  test("drops malformed and duplicate filters", () => {
    const result = sanitizeAudioProcessing({
      filters: [
        { id: "a", kind: "gain", enabled: false, settings: { db: 6 } },
        { id: "a", kind: "limiter" },
        { id: "b", kind: "reverb" },
        { kind: "gain" },
        { id: "c", kind: "limiter", cleanup: true },
      ],
    });
    expect(result.filters.map((filter) => filter.id)).toEqual(["a", "c"]);
    expect(result.filters[0]).toMatchObject({ enabled: false, cleanup: false, settings: { db: 6 } });
    expect(result.filters[1].cleanup).toBe(true);
  });

  test("round-trips a saved state", () => {
    let state = applyAudioChange(empty(), { type: "cleanup", enabled: true }, ids(), ALL);
    state = applyAudioChange(state, { type: "properties", monitoring: "monitorAndOutput", syncOffsetMs: 120, mono: true }, ids(), ALL);
    expect(sanitizeAudioProcessing(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
});

describe("sanitizeAudioChange", () => {
  test("accepts valid changes and rejects malformed ones", () => {
    expect(sanitizeAudioChange({ type: "cleanup", enabled: true })).toEqual({ type: "cleanup", enabled: true });
    expect(sanitizeAudioChange({ type: "addFilter", kind: "reverb" })).toBeNull();
    expect(sanitizeAudioChange({ type: "moveFilter", id: "x", direction: "left" })).toBeNull();
    expect(sanitizeAudioChange({ type: "removeFilter", id: "" })).toBeNull();
    expect(sanitizeAudioChange({ type: "nope" })).toBeNull();
    expect(sanitizeAudioChange("cleanup")).toBeNull();
  });

  test("keeps only scalar settings and valid properties", () => {
    expect(sanitizeAudioChange({ type: "updateFilter", id: "x", settings: { db: 3, bad: { nested: true } } })).toEqual({ type: "updateFilter", id: "x", settings: { db: 3 } });
    expect(sanitizeAudioChange({ type: "properties", monitoring: "monitor", syncOffsetMs: -5000, mono: 1 })).toEqual({ type: "properties", monitoring: "monitor", syncOffsetMs: -950 });
  });
});

describe("applyAudioChange", () => {
  test("cleanup adds the chain in processing order and removes only its own filters", () => {
    const next = ids();
    let state = applyAudioChange(empty(), { type: "addFilter", kind: "gain" }, next, ALL);
    state = applyAudioChange(state, { type: "cleanup", enabled: true }, next, ALL);
    expect(state.filters.map((filter) => filter.kind)).toEqual(["noiseSuppression", "noiseGate", "compressor", "gain", "limiter"]);
    expect(isCleanupOn(state)).toBe(true);
    state = applyAudioChange(state, { type: "cleanup", enabled: false }, next, ALL);
    expect(state.filters.map((filter) => filter.kind)).toEqual(["gain"]);
    expect(isCleanupOn(state)).toBe(false);
  });

  test("turning cleanup on again keeps tuned filters and re-enables them", () => {
    const next = ids();
    let state = applyAudioChange(empty(), { type: "cleanup", enabled: true }, next, ALL);
    const gate = state.filters.find((filter) => filter.kind === "noiseGate");
    if (!gate) throw new Error("missing gate");
    state = applyAudioChange(state, { type: "updateFilter", id: gate.id, enabled: false, settings: { open_threshold: -20 } }, next, ALL);
    state = applyAudioChange(state, { type: "cleanup", enabled: true }, next, ALL);
    expect(state.filters).toHaveLength(4);
    expect(state.filters.find((filter) => filter.id === gate.id)).toMatchObject({ enabled: true, settings: { open_threshold: -20 } });
  });

  test("cleanup skips filters the engine does not provide", () => {
    const state = applyAudioChange(empty(), { type: "cleanup", enabled: true }, ids(), new Set<AudioFilterKind>(["compressor", "limiter"]));
    expect(state.filters.map((filter) => filter.kind)).toEqual(["compressor", "limiter"]);
    expect(() => applyAudioChange(empty(), { type: "cleanup", enabled: true }, ids(), new Set())).toThrow("audio-filter-unavailable");
  });

  test("new filters go before a trailing limiter", () => {
    const next = ids();
    let state = applyAudioChange(empty(), { type: "addFilter", kind: "limiter" }, next, ALL);
    state = applyAudioChange(state, { type: "addFilter", kind: "gain" }, next, ALL);
    expect(state.filters.map((filter) => filter.kind)).toEqual(["gain", "limiter"]);
  });

  test("moves, removes and limits filters", () => {
    const next = ids();
    let state = empty();
    for (const kind of ["gain", "expander", "invertPolarity"] as const) state = applyAudioChange(state, { type: "addFilter", kind }, next, ALL);
    const [first, second] = state.filters;
    state = applyAudioChange(state, { type: "moveFilter", id: second.id, direction: "up" }, next, ALL);
    expect(state.filters[0].id).toBe(second.id);
    state = applyAudioChange(state, { type: "moveFilter", id: second.id, direction: "up" }, next, ALL);
    expect(state.filters[0].id).toBe(second.id);
    state = applyAudioChange(state, { type: "removeFilter", id: first.id }, next, ALL);
    expect(state.filters.some((filter) => filter.id === first.id)).toBe(false);
    expect(() => applyAudioChange(state, { type: "removeFilter", id: "missing" }, next, ALL)).toThrow("audio-filter-not-found");
    expect(() => applyAudioChange(state, { type: "addFilter", kind: "gain" }, next, new Set())).toThrow("audio-filter-unavailable");
    while (state.filters.length < MAX_AUDIO_FILTERS) state = applyAudioChange(state, { type: "addFilter", kind: "gain" }, next, ALL);
    expect(() => applyAudioChange(state, { type: "addFilter", kind: "gain" }, next, ALL)).toThrow("audio-filter-limit");
  });

  test("does not mutate the previous state", () => {
    const before = applyAudioChange(empty(), { type: "addFilter", kind: "gain" }, ids(), ALL);
    const snapshot = JSON.stringify(before);
    applyAudioChange(before, { type: "updateFilter", id: before.filters[0].id, settings: { db: 12 } }, ids(), ALL);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
