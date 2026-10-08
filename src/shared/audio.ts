// Audio processing per source: filters (noise suppression, gate, compressor…),
// monitoring, sync offset and mono. Pure data and rules shared by the engine,
// the main process (validation) and the renderer (controls). No engine objects.

import { ALL_TRACKS, sanitizeSourceTracks } from "./formats";

export const AUDIO_FILTER_KINDS = [
  "noiseSuppression",
  "noiseGate",
  "gain",
  "compressor",
  "limiter",
  "expander",
  "invertPolarity",
] as const;
export type AudioFilterKind = (typeof AUDIO_FILTER_KINDS)[number];

export const MONITORING_MODES = ["off", "monitor", "monitorAndOutput"] as const;
export type MonitoringMode = (typeof MONITORING_MODES)[number];

export type AudioFilterValue = number | string;

export type AudioFilterParam =
  | { key: string; type: "number"; min: number; max: number; step: number; unit: "dB" | "ms" | "ratio" }
  | { key: string; type: "choice"; options: readonly string[] }
  /** Name of another audio source, or "none". */
  | { key: string; type: "source" };

export interface AudioFilterSpec {
  /** Engine filter ids, best first; the first installed one is used. */
  engineIds: readonly string[];
  params: readonly AudioFilterParam[];
  defaults: Readonly<Record<string, AudioFilterValue>>;
}

export const NO_SIDECHAIN = "none";

export const AUDIO_FILTER_SPECS: Record<AudioFilterKind, AudioFilterSpec> = {
  noiseSuppression: {
    engineIds: ["noise_suppress_filter_v2", "noise_suppress_filter"],
    params: [
      { key: "method", type: "choice", options: ["rnnoise", "speex"] },
      { key: "suppress_level", type: "number", min: -60, max: 0, step: 1, unit: "dB" },
    ],
    defaults: { method: "rnnoise", suppress_level: -30 },
  },
  noiseGate: {
    engineIds: ["noise_gate_filter"],
    params: [
      { key: "open_threshold", type: "number", min: -96, max: 0, step: 1, unit: "dB" },
      { key: "close_threshold", type: "number", min: -96, max: 0, step: 1, unit: "dB" },
      { key: "attack_time", type: "number", min: 0, max: 10000, step: 1, unit: "ms" },
      { key: "hold_time", type: "number", min: 0, max: 10000, step: 1, unit: "ms" },
      { key: "release_time", type: "number", min: 0, max: 10000, step: 1, unit: "ms" },
    ],
    defaults: { open_threshold: -26, close_threshold: -32, attack_time: 25, hold_time: 200, release_time: 150 },
  },
  gain: {
    engineIds: ["gain_filter"],
    params: [{ key: "db", type: "number", min: -30, max: 30, step: 0.1, unit: "dB" }],
    defaults: { db: 0 },
  },
  compressor: {
    engineIds: ["compressor_filter"],
    params: [
      { key: "ratio", type: "number", min: 1, max: 32, step: 0.5, unit: "ratio" },
      { key: "threshold", type: "number", min: -60, max: 0, step: 1, unit: "dB" },
      { key: "attack_time", type: "number", min: 1, max: 100, step: 1, unit: "ms" },
      { key: "release_time", type: "number", min: 1, max: 1000, step: 1, unit: "ms" },
      { key: "output_gain", type: "number", min: -32, max: 32, step: 0.5, unit: "dB" },
      { key: "sidechain_source", type: "source" },
    ],
    defaults: { ratio: 10, threshold: -18, attack_time: 6, release_time: 60, output_gain: 0, sidechain_source: NO_SIDECHAIN },
  },
  limiter: {
    engineIds: ["limiter_filter"],
    params: [
      { key: "threshold", type: "number", min: -60, max: 0, step: 0.5, unit: "dB" },
      { key: "release_time", type: "number", min: 1, max: 1000, step: 1, unit: "ms" },
    ],
    defaults: { threshold: -6, release_time: 60 },
  },
  expander: {
    engineIds: ["expander_filter"],
    params: [
      { key: "ratio", type: "number", min: 1, max: 20, step: 0.1, unit: "ratio" },
      { key: "threshold", type: "number", min: -60, max: 0, step: 1, unit: "dB" },
      { key: "attack_time", type: "number", min: 1, max: 100, step: 1, unit: "ms" },
      { key: "release_time", type: "number", min: 1, max: 1000, step: 1, unit: "ms" },
      { key: "output_gain", type: "number", min: -32, max: 32, step: 0.5, unit: "dB" },
      { key: "detector", type: "choice", options: ["RMS", "peak"] },
    ],
    defaults: { presets: "expander", ratio: 2, threshold: -40, attack_time: 10, release_time: 50, output_gain: 0, detector: "RMS", knee_width: 10 },
  },
  invertPolarity: {
    engineIds: ["invert_polarity_filter"],
    params: [],
    defaults: {},
  },
};

/**
 * "Clean up my mic": filters in processing order with voice-oriented settings.
 * Suppression removes steady noise, the gate closes between phrases, the
 * compressor evens out loud and quiet speech, and the limiter stops clipping.
 */
export const CLEANUP_CHAIN: readonly { kind: AudioFilterKind; settings: Record<string, AudioFilterValue> }[] = [
  { kind: "noiseSuppression", settings: { method: "rnnoise", suppress_level: -30 } },
  { kind: "noiseGate", settings: { open_threshold: -32, close_threshold: -40, attack_time: 25, hold_time: 200, release_time: 150 } },
  { kind: "compressor", settings: { ratio: 4, threshold: -20, attack_time: 6, release_time: 60, output_gain: 3, sidechain_source: NO_SIDECHAIN } },
  { kind: "limiter", settings: { threshold: -3, release_time: 60 } },
];

/** Cleanup filters that run after any filters the user added themselves. */
const CLEANUP_TAIL: ReadonlySet<AudioFilterKind> = new Set(["limiter"]);

export const SYNC_OFFSET_RANGE_MS = { min: -950, max: 20000 } as const;
export const MAX_AUDIO_FILTERS = 16;

export interface AudioFilterState {
  /** Engine filter name, unique per app run; used to address the filter. */
  id: string;
  kind: AudioFilterKind;
  enabled: boolean;
  /** Added by the "Clean up my mic" switch (removed again when it is turned off). */
  cleanup: boolean;
  settings: Record<string, AudioFilterValue>;
}

/** What is persisted per audio source in the scene collection. */
export interface AudioProcessing {
  /** Audio filters in processing order. */
  filters: AudioFilterState[];
  monitoring: MonitoringMode;
  syncOffsetMs: number;
  mono: boolean;
  /** Audio tracks (bitmask, bit 0 = track 1) the source plays into; absent = all six. */
  tracks?: number;
}

export const DEFAULT_AUDIO_PROCESSING: AudioProcessing = { filters: [], monitoring: "off", syncOffsetMs: 0, mono: false };

export interface AudioSourceDetails extends AudioProcessing {
  name: string;
  /** Filter kinds the installed engine provides. */
  availableFilters: AudioFilterKind[];
  /** Other audio sources a compressor can duck under. */
  sidechainSources: string[];
  cleanup: boolean;
}

export type AudioChange =
  | { type: "cleanup"; enabled: boolean }
  | { type: "addFilter"; kind: AudioFilterKind }
  | { type: "removeFilter"; id: string }
  | { type: "moveFilter"; id: string; direction: "up" | "down" }
  | { type: "updateFilter"; id: string; enabled?: boolean; settings?: Record<string, AudioFilterValue> }
  | { type: "properties"; monitoring?: MonitoringMode; syncOffsetMs?: number; mono?: boolean; tracks?: number };

export interface AudioDeviceChoice {
  /** Current device id ("default" follows the system). */
  current: string;
  options: { value: string; label: string }[];
}

export interface MonitoringDevices {
  current: string;
  devices: { id: string; name: string }[];
}

// ----- rules -------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAudioFilterKind(value: unknown): value is AudioFilterKind {
  return typeof value === "string" && (AUDIO_FILTER_KINDS as readonly string[]).includes(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, step: number): number {
  const rounded = Math.round(value / step) * step;
  return Number(rounded.toFixed(4));
}

/**
 * Keeps only known parameters with valid values. Unknown or invalid values
 * fall back to the current (or default) ones, so a bad patch never breaks a filter.
 */
export function sanitizeFilterSettings(
  kind: AudioFilterKind,
  patch: unknown,
  current: Record<string, AudioFilterValue> = AUDIO_FILTER_SPECS[kind].defaults,
): Record<string, AudioFilterValue> {
  const spec = AUDIO_FILTER_SPECS[kind];
  const result: Record<string, AudioFilterValue> = { ...spec.defaults };
  for (const key of Object.keys(spec.defaults)) {
    if (Object.hasOwn(current, key)) result[key] = current[key];
  }
  const input = isRecord(patch) ? patch : {};
  for (const param of spec.params) {
    if (!Object.hasOwn(input, param.key)) continue;
    const value = input[param.key];
    if (param.type === "number") {
      const number = typeof value === "number" ? value : Number.NaN;
      if (Number.isFinite(number)) result[param.key] = roundToStep(clamp(number, param.min, param.max), param.step);
    } else if (param.type === "choice") {
      if (typeof value === "string" && param.options.includes(value)) result[param.key] = value;
    } else if (typeof value === "string" && value.length > 0 && value.length <= 256) {
      result[param.key] = value;
    }
  }
  return result;
}

export function sanitizeSyncOffset(value: unknown): number {
  const number = typeof value === "number" ? Math.round(value) : Number.NaN;
  return Number.isFinite(number) ? clamp(number, SYNC_OFFSET_RANGE_MS.min, SYNC_OFFSET_RANGE_MS.max) : 0;
}

/** Restores persisted processing; anything unreadable falls back to defaults. */
export function sanitizeAudioProcessing(value: unknown): AudioProcessing {
  if (!isRecord(value)) return { ...DEFAULT_AUDIO_PROCESSING, filters: [] };
  const seen = new Set<string>();
  const filters: AudioFilterState[] = [];
  for (const entry of Array.isArray(value.filters) ? value.filters : []) {
    if (!isRecord(entry) || !isAudioFilterKind(entry.kind) || typeof entry.id !== "string" || !entry.id || seen.has(entry.id)) continue;
    if (filters.length >= MAX_AUDIO_FILTERS) break;
    seen.add(entry.id);
    filters.push({
      id: entry.id,
      kind: entry.kind,
      enabled: entry.enabled !== false,
      cleanup: entry.cleanup === true,
      settings: sanitizeFilterSettings(entry.kind, entry.settings),
    });
  }
  return {
    filters,
    monitoring: (MONITORING_MODES as readonly unknown[]).includes(value.monitoring) ? (value.monitoring as MonitoringMode) : "off",
    syncOffsetMs: sanitizeSyncOffset(value.syncOffsetMs),
    mono: value.mono === true,
    ...withTracks(sanitizeSourceTracks(value.tracks)),
  };
}

/** Adds `tracks` only when the source skips some tracks (absent = all). */
function withTracks(tracks: number | undefined): { tracks?: number } {
  return tracks === undefined ? {} : { tracks };
}

/** Validates a change sent from the renderer; null when it is malformed. */
export function sanitizeAudioChange(value: unknown): AudioChange | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128 ? value.id : null;
  switch (value.type) {
    case "cleanup":
      return typeof value.enabled === "boolean" ? { type: "cleanup", enabled: value.enabled } : null;
    case "addFilter":
      return isAudioFilterKind(value.kind) ? { type: "addFilter", kind: value.kind } : null;
    case "removeFilter":
      return id ? { type: "removeFilter", id } : null;
    case "moveFilter":
      return id && (value.direction === "up" || value.direction === "down") ? { type: "moveFilter", id, direction: value.direction } : null;
    case "updateFilter": {
      if (!id) return null;
      const change: AudioChange = { type: "updateFilter", id };
      if (typeof value.enabled === "boolean") change.enabled = value.enabled;
      if (isRecord(value.settings)) {
        const settings: Record<string, AudioFilterValue> = {};
        for (const [key, entry] of Object.entries(value.settings)) {
          if (typeof entry === "number" || typeof entry === "string") settings[key] = entry;
        }
        change.settings = settings;
      }
      return change;
    }
    case "properties": {
      const change: AudioChange = { type: "properties" };
      if ((MONITORING_MODES as readonly unknown[]).includes(value.monitoring)) change.monitoring = value.monitoring as MonitoringMode;
      if (typeof value.syncOffsetMs === "number" && Number.isFinite(value.syncOffsetMs)) change.syncOffsetMs = sanitizeSyncOffset(value.syncOffsetMs);
      if (typeof value.mono === "boolean") change.mono = value.mono;
      if (typeof value.tracks === "number" && Number.isInteger(value.tracks) && value.tracks >= 0) change.tracks = value.tracks & ALL_TRACKS;
      return change;
    }
    default:
      return null;
  }
}

export function isCleanupOn(state: AudioProcessing): boolean {
  return state.filters.some((filter) => filter.cleanup);
}

/**
 * Applies a change and returns the new state. `newId` names new filters;
 * `available` is the set of filter kinds the engine provides.
 */
export function applyAudioChange(
  state: AudioProcessing,
  change: AudioChange,
  newId: (kind: AudioFilterKind, cleanup: boolean) => string,
  available: ReadonlySet<AudioFilterKind>,
): AudioProcessing {
  const filters = state.filters.map((filter) => ({ ...filter, settings: { ...filter.settings } }));
  const indexOf = (id: string) => {
    const index = filters.findIndex((filter) => filter.id === id);
    if (index < 0) throw new Error("audio-filter-not-found");
    return index;
  };
  switch (change.type) {
    case "cleanup": {
      if (!change.enabled) return { ...state, filters: filters.filter((filter) => !filter.cleanup) };
      const head: AudioFilterState[] = [];
      const tail: AudioFilterState[] = [];
      for (const step of CLEANUP_CHAIN) {
        if (!available.has(step.kind)) continue;
        const existing = filters.find((filter) => filter.cleanup && filter.kind === step.kind);
        const entry = existing
          ? { ...existing, enabled: true }
          : { id: newId(step.kind, true), kind: step.kind, enabled: true, cleanup: true, settings: sanitizeFilterSettings(step.kind, step.settings) };
        (CLEANUP_TAIL.has(step.kind) ? tail : head).push(entry);
      }
      if (head.length + tail.length === 0) throw new Error("audio-filter-unavailable");
      const own = filters.filter((filter) => !filter.cleanup);
      const extra = filters.filter((filter) => filter.cleanup && !head.concat(tail).some((entry) => entry.id === filter.id));
      return { ...state, filters: [...head, ...own, ...extra, ...tail].slice(0, MAX_AUDIO_FILTERS) };
    }
    case "addFilter": {
      if (!available.has(change.kind)) throw new Error("audio-filter-unavailable");
      if (filters.length >= MAX_AUDIO_FILTERS) throw new Error("audio-filter-limit");
      const entry = { id: newId(change.kind, false), kind: change.kind, enabled: true, cleanup: false, settings: sanitizeFilterSettings(change.kind, undefined) };
      // A new filter goes before a trailing limiter so it never undoes clipping protection.
      const last = filters.at(-1);
      const at = last && last.kind === "limiter" ? filters.length - 1 : filters.length;
      filters.splice(at, 0, entry);
      return { ...state, filters };
    }
    case "removeFilter":
      filters.splice(indexOf(change.id), 1);
      return { ...state, filters };
    case "moveFilter": {
      const index = indexOf(change.id);
      const target = change.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= filters.length) return { ...state, filters };
      [filters[index], filters[target]] = [filters[target], filters[index]];
      return { ...state, filters };
    }
    case "updateFilter": {
      const filter = filters[indexOf(change.id)];
      if (change.enabled !== undefined) filter.enabled = change.enabled;
      if (change.settings) filter.settings = sanitizeFilterSettings(filter.kind, change.settings, filter.settings);
      return { ...state, filters };
    }
    case "properties": {
      const rest: AudioProcessing = { ...state };
      delete rest.tracks;
      return {
        ...rest,
        filters,
        monitoring: change.monitoring ?? state.monitoring,
        syncOffsetMs: change.syncOffsetMs === undefined ? state.syncOffsetMs : sanitizeSyncOffset(change.syncOffsetMs),
        mono: change.mono ?? state.mono,
        ...withTracks(change.tracks === undefined ? state.tracks : sanitizeSourceTracks(change.tracks)),
      };
    }
  }
}
