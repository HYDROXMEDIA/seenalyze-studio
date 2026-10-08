// Per-source audio processing in the engine: audio filters, monitoring, sync
// offset and mono, plus device pickers and the headphone (monitoring) device.
// The wanted state is plain data (shared/audio.ts); `reconcile` makes a
// source's engine filters match it, so load, edits and undo share one path.

import { randomUUID } from "node:crypto";
import type { IFilter } from "../../../vendor/obs-studio-node/module";
import {
  AUDIO_FILTER_KINDS,
  AUDIO_FILTER_SPECS,
  DEFAULT_AUDIO_PROCESSING,
  MONITORING_MODES,
  applyAudioChange,
  isCleanupOn,
  sanitizeAudioProcessing,
  sanitizeFilterSettings,
  type AudioChange,
  type AudioDeviceChoice,
  type AudioFilterKind,
  type AudioProcessing,
  type AudioSourceDetails,
  type MonitoringDevices,
} from "../../shared/audio";
import { ALL_TRACKS, sanitizeSourceTracks } from "../../shared/formats";
import type { IInput, OSN } from "./osn";
import type { SceneGraph } from "./scenes";

const OUTPUT_FLAG_AUDIO = 2;
/** ESourceFlags.ForceMono */
const FLAG_FORCE_MONO = 1 << 1;
/** EOrderMovement.Bottom */
const ORDER_BOTTOM = 3;
const AUDIO_PREFIX = "seenalyze-audio-";
const CLEANUP_PREFIX = "seenalyze-cleanup-";
const DEFAULT_DEVICE = "default";

/** Result of a device lookup for a muted microphone whose device is closed. */
export interface ClosedDevice {
  closed: true;
  current: string;
}

export class AudioProcessor {
  /** Wanted state per engine input, so saving does not query every filter. */
  private readonly known = new WeakMap<IInput, AudioProcessing>();
  private installed: Map<AudioFilterKind, string> | null = null;

  constructor(
    private readonly osn: OSN,
    private readonly scenes: SceneGraph,
  ) {}

  /** Hooks the scene graph calls when it creates, closes or saves an input. */
  readonly hooks = {
    capture: (input: IInput): AudioProcessing | undefined => {
      if ((input.outputFlags & OUTPUT_FLAG_AUDIO) === 0) return undefined;
      const state = this.stateOf(input);
      return isDefault(state) ? undefined : state;
    },
    apply: (input: IInput, saved: unknown): void => {
      if (saved === undefined || (input.outputFlags & OUTPUT_FLAG_AUDIO) === 0) return;
      try {
        this.reconcile(input, sanitizeAudioProcessing(saved));
      } catch (error) {
        // A filter that cannot be restored must not keep the source from opening.
        console.warn("[audio-processing] could not restore audio settings", error);
      }
    },
  };

  details(name: string): AudioSourceDetails {
    const state = this.read(name);
    const sidechainSources = [...this.scenes.audioInputs().map((entry) => entry.name), ...this.scenes.dormantAudio()].filter((entry) => entry !== name);
    return {
      ...state,
      name,
      availableFilters: [...this.filterTypes().keys()],
      sidechainSources,
      cleanup: isCleanupOn(state),
    };
  }

  change(name: string, change: AudioChange): AudioSourceDetails {
    const next = applyAudioChange(this.read(name), change, newFilterId, new Set(this.filterTypes().keys()));
    const input = this.liveInput(name);
    if (input) this.reconcile(input, next);
    else this.requireDormant(name).audio = next;
    return this.details(name);
  }

  /**
   * Devices the source can capture from. A muted microphone keeps its device
   * closed (see SceneGraph.dormant); listing its devices through the engine
   * would open it, so that is only done when `allowOpen` is set.
   */
  devices(name: string, allowOpen: boolean): AudioDeviceChoice | ClosedDevice | null {
    const dormant = this.scenes.dormantRecord(name);
    if (dormant && !allowOpen) return { closed: true, current: deviceOf(dormant.settings) };
    const property = this.scenes.getProperties(name).find((entry) => entry.name === "device_id" && entry.kind === "list");
    if (!property) return null;
    const current = this.scenes.redirectedDefault(name) ? DEFAULT_DEVICE : String(property.value ?? DEFAULT_DEVICE) || DEFAULT_DEVICE;
    return { current, options: (property.options ?? []).map((option) => ({ value: String(option.value), label: option.label })) };
  }

  setDevice(name: string, deviceId: string): void {
    const dormant = this.scenes.dormantRecord(name);
    if (dormant) {
      dormant.settings = { ...dormant.settings, device_id: deviceId };
      return;
    }
    this.scenes.updateSettings(name, { device_id: deviceId });
  }

  monitoringDevices(): MonitoringDevices {
    const audio = this.osn.AudioFactory;
    const devices = audio.monitoringDevices.map(({ id, name }) => ({ id: String(id), name: String(name) }));
    return { current: String(audio.monitoringDevice?.id ?? DEFAULT_DEVICE) || DEFAULT_DEVICE, devices };
  }

  /** Selects the headphones that monitored sources play on; unknown ids use the system default. */
  setMonitoringDevice(id: string): void {
    const audio = this.osn.AudioFactory;
    const device = audio.monitoringDevices.find((entry) => entry.id === id) ?? audio.monitoringDevices.find((entry) => entry.id === DEFAULT_DEVICE);
    audio.monitoringDevice = device ?? { id: DEFAULT_DEVICE, name: "Default" };
  }

  /**
   * Push-to-talk / push-to-mute: only flips the mute flag. Unlike a regular
   * mute it keeps a microphone's device open, so repeated presses stay instant.
   */
  setTalkMuted(name: string, muted: boolean): void {
    if (this.scenes.dormantRecord(name)) {
      if (!muted) this.scenes.setMuted(name, false);
      return;
    }
    const input = this.liveInput(name);
    if (!input) throw new Error("source-not-found");
    if (input.muted !== muted) input.muted = muted;
  }

  // ----- internals ----------------------------------------------------------

  private read(name: string): AudioProcessing {
    const input = this.liveInput(name);
    if (input) return this.stateOf(input);
    const dormant = this.requireDormant(name);
    return sanitizeAudioProcessing(dormant.audio);
  }

  private liveInput(name: string): IInput | undefined {
    return this.scenes.audioInputs().find((entry) => entry.name === name)?.input;
  }

  private requireDormant(name: string): { audio?: AudioProcessing } {
    const dormant = this.scenes.dormantRecord(name);
    if (!dormant) throw new Error("source-not-found");
    return dormant;
  }

  /** Installed engine filter id per kind; kinds without one are hidden. */
  private filterTypes(): Map<AudioFilterKind, string> {
    if (!this.installed) {
      const types = new Set(this.osn.FilterFactory.types());
      this.installed = new Map();
      for (const kind of AUDIO_FILTER_KINDS) {
        const id = AUDIO_FILTER_SPECS[kind].engineIds.find((candidate) => types.has(candidate));
        if (id) this.installed.set(kind, id);
      }
    }
    return this.installed;
  }

  private kindOf(engineId: string): AudioFilterKind | undefined {
    return AUDIO_FILTER_KINDS.find((kind) => AUDIO_FILTER_SPECS[kind].engineIds.includes(engineId));
  }

  private audioFilters(input: IInput): IFilter[] {
    return (input.filters ?? []).filter((filter) => this.kindOf(filter.id) !== undefined);
  }

  /** The source's state, read from the engine only the first time. */
  private stateOf(input: IInput): AudioProcessing {
    const cached = this.known.get(input);
    if (cached) return cached;
    const filters = this.audioFilters(input).map((filter) => {
      const kind = this.kindOf(filter.id) as AudioFilterKind;
      return {
        id: filter.name,
        kind,
        enabled: filter.enabled,
        cleanup: filter.name.startsWith(CLEANUP_PREFIX),
        settings: sanitizeFilterSettings(kind, filter.settings),
      };
    });
    const offset = input.syncOffset ?? { sec: 0, nsec: 0 };
    const state: AudioProcessing = {
      filters,
      monitoring: MONITORING_MODES[Number(input.monitoringType)] ?? "off",
      syncOffsetMs: Math.round(Number(offset.sec) * 1000 + Number(offset.nsec) / 1e6) || 0,
      mono: (Number(input.flags) & FLAG_FORCE_MONO) !== 0,
    };
    const tracks = sanitizeSourceTracks(Number(input.audioMixers));
    if (tracks !== undefined) state.tracks = tracks;
    this.known.set(input, state);
    return state;
  }

  /** Makes the input's audio filters and properties match `wanted`. */
  private reconcile(input: IInput, wanted: AudioProcessing): void {
    const types = this.filterTypes();
    const wantedIds = new Set(wanted.filters.map((filter) => filter.id));
    for (const filter of this.audioFilters(input)) {
      if (!wantedIds.has(filter.name)) input.removeFilter(filter);
    }
    const existing = new Map(this.audioFilters(input).map((filter) => [filter.name, filter]));
    const applied: AudioProcessing = { ...wanted, filters: [] };
    for (const entry of wanted.filters) {
      const filter = existing.get(entry.id);
      if (filter) {
        const current = sanitizeFilterSettings(entry.kind, filter.settings);
        if (JSON.stringify(current) !== JSON.stringify(entry.settings)) filter.update(entry.settings);
        if (filter.enabled !== entry.enabled) filter.enabled = entry.enabled;
      } else {
        const engineId = types.get(entry.kind);
        if (!engineId) continue;
        const created = this.osn.FilterFactory.create(engineId, entry.id, entry.settings);
        if (!created) continue;
        created.enabled = entry.enabled;
        input.addFilter(created);
        // The source holds its own reference, as in the binding's own loader.
        created.release();
      }
      applied.filters.push(entry);
    }
    const order = this.audioFilters(input).map((filter) => filter.name);
    const wantedOrder = applied.filters.map((filter) => filter.id);
    if (order.join("\u0000") !== wantedOrder.join("\u0000")) {
      // Moving each audio filter to the bottom in order sorts the audio chain;
      // video filters on the same source keep their relative order.
      for (const id of wantedOrder) {
        const filter = input.findFilter(id);
        if (filter) input.setFilterOrder(filter, ORDER_BOTTOM);
      }
    }
    const monitoring = MONITORING_MODES.indexOf(applied.monitoring);
    if (Number(input.monitoringType) !== monitoring) input.monitoringType = monitoring;
    const offset = input.syncOffset ?? { sec: 0, nsec: 0 };
    if (Math.round(Number(offset.sec) * 1000 + Number(offset.nsec) / 1e6) !== applied.syncOffsetMs) {
      const sec = Math.trunc(applied.syncOffsetMs / 1000);
      input.syncOffset = { sec, nsec: (applied.syncOffsetMs - sec * 1000) * 1e6 };
    }
    const flags = Number(input.flags) || 0;
    const nextFlags = applied.mono ? flags | FLAG_FORCE_MONO : flags & ~FLAG_FORCE_MONO;
    if (nextFlags !== flags) input.flags = nextFlags;
    // Only the six track bits are ours; other mixer bits stay as the engine set them.
    const mixers = Number(input.audioMixers) || 0;
    const nextMixers = (mixers & ~ALL_TRACKS) | (applied.tracks ?? ALL_TRACKS);
    if (nextMixers !== mixers) input.audioMixers = nextMixers;
    this.known.set(input, applied);
  }
}

function newFilterId(kind: AudioFilterKind, cleanup: boolean): string {
  return `${cleanup ? CLEANUP_PREFIX : AUDIO_PREFIX}${kind}-${randomUUID().slice(0, 8)}`;
}

function deviceOf(settings: Record<string, unknown>): string {
  const device = settings.device_id;
  return typeof device === "string" && device ? device : DEFAULT_DEVICE;
}

function isDefault(state: AudioProcessing): boolean {
  return (
    state.filters.length === 0 &&
    state.monitoring === DEFAULT_AUDIO_PROCESSING.monitoring &&
    state.syncOffsetMs === DEFAULT_AUDIO_PROCESSING.syncOffsetMs &&
    state.mono === DEFAULT_AUDIO_PROCESSING.mono &&
    state.tracks === undefined
  );
}
