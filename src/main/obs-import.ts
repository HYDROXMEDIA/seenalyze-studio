// Import of scene collections from OBS Studio and Streamlabs Desktop. Both use
// libobs, so source types, settings and filters carry over as they are; this
// maps them to our collection format (scenes, sources, transforms, video
// effects, audio filters and properties, global audio, transition). Sources
// whose type this app does not have are kept and shown as missing rather than
// dropped. Stream keys and service credentials are never read: they live in
// other files (service.json), and settings that look like credentials are
// left out. Nothing here logs file contents. No Electron imports.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { AUDIO_FILTER_KINDS, AUDIO_FILTER_SPECS, MONITORING_MODES, NO_SIDECHAIN, sanitizeFilterSettings, SYNC_OFFSET_RANGE_MS, type AudioFilterKind, type AudioFilterState, type AudioProcessing } from "../shared/audio";
import { sanitizeSourceTracks } from "../shared/formats";
import { DEFAULT_TRANSITION, sanitizeTransition, TRANSITION_PRESETS, type TransitionChoice } from "../shared/transitions";
import type { SourceKind } from "../shared/types";
import { effectKindOf, type EffectSnapshot } from "../shared/video-effects";
import type { ImportApp, ImportCandidate } from "../shared/workspace";
import { rescaleCollection, type CanvasSize } from "./collections";
import type { SceneCollection } from "./engine/scenes";
import { INPUT_IDS } from "./engine/source-types";

type SavedSource = SceneCollection["sources"][number];
type SavedItem = SceneCollection["scenes"][string][number];

export interface ConvertedCollection {
  name: string;
  collection: SceneCollection;
  transition: TransitionChoice | null;
  stats: { scenes: number; sources: number; unavailableSources: number; skippedFilters: number };
}

export interface ConvertOptions {
  /** Platform the collection will run on ("darwin", "win32"). */
  platform: string;
  /** Canvas the collection was made for, and ours; positions are scaled between them. */
  canvas?: { from: CanvasSize; to: CanvasSize };
}

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const ALIGN_TOP_LEFT = 5;
/** libobs ESourceFlags.ForceMono */
const FLAG_FORCE_MONO = 1 << 1;
const AUDIO_FILTER_PREFIX = "seenalyze-audio-";
/** Setting names that hold secrets in some plugins; never imported. */
const CREDENTIAL_SETTING = /(^|[_\-.])(key|token|secret|password|passwd|auth|cookie|credentials?)s?($|[_\-.])/iu;
/** Transition settings that tell presets of one engine type apart. */
const TRANSITION_IDENTITY = ["direction", "luma_image", "color"] as const;
/** OBS saves global audio devices under these keys; the number after them is the output channel. */
const OBS_GLOBAL_AUDIO: readonly [string, number][] = [
  ["DesktopAudioDevice1", 1],
  ["DesktopAudioDevice2", 2],
  ["AuxAudioDevice1", 3],
  ["AuxAudioDevice2", 4],
  ["AuxAudioDevice3", 5],
  ["AuxAudioDevice4", 6],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

function vec(value: unknown, fallback: { x: number; y: number }): { x: number; y: number } {
  return isRecord(value) ? { x: num(value.x, fallback.x), y: num(value.y, fallback.y) } : { ...fallback };
}

/** A deep copy of plain settings without credential-like entries. */
export function cleanSettings(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (CREDENTIAL_SETTING.test(key)) continue;
    result[key] = isRecord(entry) ? cleanSettings(entry) : Array.isArray(entry) ? structuredClone(entry) : entry;
  }
  return result;
}

/**
 * Fader position for a linear volume multiplier, using libobs' IEC fader
 * curve (the one our mixer uses). Gains above 0 dB are capped at the top.
 */
export function volumeToDeflection(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  const db = 20 * Math.log10(multiplier);
  if (db >= 0) return 1;
  let def: number;
  if (db >= -9) def = ((db + 9) / 9) * 0.25 + 0.75;
  else if (db >= -20) def = ((db + 20) / 11) * 0.25 + 0.5;
  else if (db >= -30) def = ((db + 30) / 10) * 0.2 + 0.3;
  else if (db >= -40) def = ((db + 40) / 10) * 0.15 + 0.15;
  else if (db >= -50) def = ((db + 50) / 10) * 0.075 + 0.075;
  else if (db >= -60) def = ((db + 60) / 10) * 0.05 + 0.025;
  else if (db >= -114) def = ((db + 150) / 90) * 0.025;
  else def = 0;
  return Math.min(1, Math.max(0, Math.round(def * 10000) / 10000));
}

/** Our source kind for a libobs input id (screen capture types are told apart by their settings). */
export function kindForInput(inputId: string, settings: Record<string, unknown>): SourceKind | "other" {
  if (inputId === "screen_capture" || inputId === "mac_screen_capture") {
    const type = Number(settings.type ?? 0);
    return type === 1 ? "window" : type === 2 ? "application" : "display";
  }
  if (inputId === "sck_audio_capture") return Number(settings.type ?? 0) === 1 ? "applicationAudio" : "desktopAudio";
  if (inputId === "browser_source") return "browser";
  // Kinds that share an input id with another kind are reached above or are aliases (capture card = camera).
  const skip = new Set<string>(["application", "captureCard", "chatOverlay", "overlay"]);
  for (const [kind, ids] of Object.entries(INPUT_IDS)) {
    if (skip.has(kind)) continue;
    if (ids.darwin.includes(inputId) || ids.win32.includes(inputId)) return kind as SourceKind;
  }
  return "other";
}

/** Whether this app offers the input type on the platform (the engine checks again when loading). */
function availableOn(inputId: string, kind: SourceKind | "other", platform: string): boolean {
  if (kind === "other" || kind === "scene") return false;
  const ids = INPUT_IDS[kind];
  return (platform === "win32" ? ids.win32 : platform === "darwin" ? ids.darwin : []).includes(inputId);
}

function audioFilterKindOf(engineId: string): AudioFilterKind | undefined {
  return AUDIO_FILTER_KINDS.find((kind) => AUDIO_FILTER_SPECS[kind].engineIds.includes(engineId));
}

interface RawFilter {
  id: string;
  name: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

interface RawSource {
  name: string;
  inputId: string;
  settings: Record<string, unknown>;
  /** Linear multiplier. */
  volume: number;
  muted: boolean;
  monitoring: number;
  syncOffsetMs: number;
  mono: boolean;
  mixers: number | undefined;
  filters: RawFilter[];
}

/**
 * Builds a saved source. Video filters become effects, audio filters become
 * audio processing; filters without an equivalent are counted as skipped.
 */
function toSavedSource(raw: RawSource, sourceNames: ReadonlySet<string>, counter: { filters: number; skipped: number }): SavedSource {
  const kind = kindForInput(raw.inputId, raw.settings);
  const effects: EffectSnapshot[] = [];
  const audioFilters: AudioFilterState[] = [];
  for (const filter of raw.filters) {
    const effect = effectKindOf(filter.id);
    if (effect) {
      effects.push({ kind: effect, enabled: filter.enabled, settings: cleanSettings(filter.settings) });
      continue;
    }
    const audioKind = audioFilterKindOf(filter.id);
    if (audioKind) {
      const settings: Record<string, unknown> = { ...filter.settings };
      // The first noise suppression version defaulted to Speex when no method was saved.
      if (audioKind === "noiseSuppression" && filter.id === "noise_suppress_filter" && settings.method === undefined) settings.method = "speex";
      if (audioKind === "compressor" && (typeof settings.sidechain_source !== "string" || !sourceNames.has(settings.sidechain_source))) settings.sidechain_source = NO_SIDECHAIN;
      counter.filters += 1;
      audioFilters.push({
        id: `${AUDIO_FILTER_PREFIX}${audioKind}-import-${counter.filters}`,
        kind: audioKind,
        enabled: filter.enabled,
        cleanup: false,
        settings: sanitizeFilterSettings(audioKind, settings),
      });
      continue;
    }
    counter.skipped += 1;
  }
  const tracks = sanitizeSourceTracks(raw.mixers);
  const audio: AudioProcessing = {
    filters: audioFilters,
    monitoring: MONITORING_MODES[raw.monitoring] ?? "off",
    syncOffsetMs: Math.min(SYNC_OFFSET_RANGE_MS.max, Math.max(SYNC_OFFSET_RANGE_MS.min, Math.round(raw.syncOffsetMs))),
    mono: raw.mono,
    ...(tracks === undefined ? {} : { tracks }),
  };
  const defaultAudio = audio.filters.length === 0 && audio.monitoring === "off" && audio.syncOffsetMs === 0 && !audio.mono && audio.tracks === undefined;
  return {
    name: raw.name,
    kind,
    inputId: raw.inputId,
    settings: cleanSettings(raw.settings),
    volume: volumeToDeflection(raw.volume),
    muted: raw.muted,
    ...(effects.length > 0 ? { effects } : {}),
    ...(defaultAudio ? {} : { audio }),
  };
}

function finish(
  name: string,
  scenes: Map<string, SavedItem[]>,
  sceneOrder: string[],
  activeScene: string | null,
  sources: SavedSource[],
  globalAudio: { channel: number; source: string }[],
  transition: TransitionChoice | null,
  skippedFilters: number,
  options: ConvertOptions,
): ConvertedCollection {
  if (sceneOrder.length === 0) throw new Error("import-invalid");
  let collection: SceneCollection = {
    activeScene: activeScene && scenes.has(activeScene) ? activeScene : sceneOrder[0],
    sceneOrder,
    scenes: Object.fromEntries(sceneOrder.map((scene) => [scene, scenes.get(scene) ?? []])),
    sources,
    globalAudio,
  };
  if (options.canvas) collection = rescaleCollection(collection, options.canvas.from, options.canvas.to);
  return {
    name,
    collection,
    transition,
    stats: {
      scenes: sceneOrder.length,
      sources: sources.length,
      unavailableSources: sources.filter((source) => !availableOn(source.inputId, source.kind, options.platform)).length,
      skippedFilters,
    },
  };
}

// ----- OBS Studio -------------------------------------------------------------------

function obsFilters(source: Record<string, unknown>): RawFilter[] {
  return records(source.filters).flatMap((filter) => {
    const id = text(filter.versioned_id) ?? text(filter.id);
    return id ? [{ id, name: text(filter.name) ?? id, enabled: filter.enabled !== false, settings: isRecord(filter.settings) ? filter.settings : {} }] : [];
  });
}

function obsRawSource(source: Record<string, unknown>, name: string): RawSource | null {
  const inputId = text(source.versioned_id) ?? text(source.id);
  if (!inputId) return null;
  return {
    name,
    inputId,
    settings: isRecord(source.settings) ? source.settings : {},
    volume: num(source.volume, 1),
    muted: source.muted === true,
    monitoring: num(source.monitoring_type, 0),
    // OBS saves the sync offset in nanoseconds.
    syncOffsetMs: num(source.sync, 0) / 1e6,
    mono: (num(source.flags, 0) & FLAG_FORCE_MONO) !== 0,
    mixers: typeof source.mixers === "number" ? source.mixers : undefined,
    filters: obsFilters(source),
  };
}

function obsItem(item: Record<string, unknown>, canvas: CanvasSize): SavedItem | null {
  const source = text(item.name);
  if (!source) return null;
  // Newer OBS versions also save positions relative to the canvas centre
  // (height = 2 units); they are only used when the absolute ones are missing.
  let position = vec(item.pos, { x: 0, y: 0 });
  if (!isRecord(item.pos) && isRecord(item.pos_rel)) {
    const half = canvas.height / 2;
    position = { x: num(item.pos_rel.x, 0) * half + canvas.width / 2, y: num(item.pos_rel.y, 0) * half + half };
  }
  return {
    source,
    visible: item.visible !== false,
    locked: item.locked === true,
    position,
    scale: vec(item.scale, { x: 1, y: 1 }),
    rotation: num(item.rot, 0),
    alignment: num(item.align, ALIGN_TOP_LEFT),
    boundsType: num(item.bounds_type, 0),
    boundsAlignment: num(item.bounds_align, 0),
    bounds: vec(item.bounds, { x: 0, y: 0 }),
    crop: {
      left: Math.max(0, num(item.crop_left, 0)),
      top: Math.max(0, num(item.crop_top, 0)),
      right: Math.max(0, num(item.crop_right, 0)),
      bottom: Math.max(0, num(item.crop_bottom, 0)),
    },
  };
}

/** Our transition for OBS's current transition; transitions we do not have fall back to a fade. */
export function obsTransition(json: Record<string, unknown>): TransitionChoice {
  const duration = num(json.transition_duration, DEFAULT_TRANSITION.durationMs);
  const current = text(json.current_transition);
  const saved = records(json.transitions).find((entry) => text(entry.name) === current);
  const id = text(saved?.id) ?? (current && /cut/iu.test(current) ? "cut_transition" : "fade_transition");
  const settings = isRecord(saved?.settings) ? saved.settings : {};
  // Presets of one engine type differ by what the transition shows, not by fine-tuning values.
  const sameSettings = (preset: (typeof TRANSITION_PRESETS)[number]) =>
    TRANSITION_IDENTITY.every((key) => preset.settings[key] === undefined || settings[key] === undefined || settings[key] === preset.settings[key]);
  const candidates = TRANSITION_PRESETS.filter((preset) => preset.engineId === id);
  const preset = candidates.find(sameSettings) ?? candidates[0];
  return sanitizeTransition({ id: preset?.id ?? DEFAULT_TRANSITION.id, durationMs: duration });
}

/** Converts an OBS Studio scene collection file (basic/scenes/*.json). */
export function convertObsCollection(json: unknown, fallbackName: string, options: ConvertOptions): ConvertedCollection {
  if (!isRecord(json) || !Array.isArray(json.sources)) throw new Error("import-invalid");
  const canvas = options.canvas?.from ?? options.canvas?.to ?? { width: 1920, height: 1080 };
  const scenes = new Map<string, SavedItem[]>();
  const sceneOrder: string[] = [];
  const groups: string[] = [];
  const inputs: { raw: Record<string, unknown>; name: string }[] = [];
  for (const source of [...records(json.sources), ...records(json.groups)]) {
    const name = text(source.name);
    if (!name) continue;
    const id = text(source.id);
    if (id === "scene" || id === "group") {
      if (scenes.has(name)) continue;
      const items = records(isRecord(source.settings) ? source.settings.items : undefined).flatMap((item) => obsItem(item, canvas) ?? []);
      scenes.set(name, items);
      (id === "group" ? groups : sceneOrder).push(name);
    } else {
      inputs.push({ raw: source, name });
    }
  }
  // Scene order as listed in OBS, then scenes it does not list, then groups (as nested scenes).
  const listed = records(json.scene_order).flatMap((entry) => (text(entry.name) && scenes.has(text(entry.name) as string) ? [text(entry.name) as string] : []));
  const order = [...new Set([...listed, ...sceneOrder, ...groups])];

  const globalAudio: { channel: number; source: string }[] = [];
  for (const [key, channel] of OBS_GLOBAL_AUDIO) {
    const device = json[key];
    const name = isRecord(device) ? text(device.name) : undefined;
    if (!isRecord(device) || !name || scenes.has(name) || inputs.some((entry) => entry.name === name)) continue;
    inputs.push({ raw: device, name });
    globalAudio.push({ channel, source: name });
  }

  const names = new Set(inputs.map((entry) => entry.name));
  const counter = { filters: 0, skipped: 0 };
  const sources: SavedSource[] = [];
  for (const { raw, name } of inputs) {
    const parsed = obsRawSource(raw, name);
    if (parsed) sources.push(toSavedSource(parsed, names, counter));
  }
  // Filters on scenes and groups have no equivalent here.
  for (const source of [...records(json.sources), ...records(json.groups)]) {
    if (text(source.id) === "scene" || text(source.id) === "group") counter.skipped += obsFilters(source).length;
  }
  const known = new Set([...order, ...sources.map((source) => source.name)]);
  for (const [scene, items] of scenes) scenes.set(scene, items.filter((item) => known.has(item.source)));

  const name = text(json.name) ?? fallbackName;
  const active = text(json.current_program_scene) ?? text(json.current_scene) ?? null;
  return finish(name, scenes, order, active, sources, globalAudio, obsTransition(json), counter.skipped, options);
}

// ----- Streamlabs Desktop -------------------------------------------------------------

/** Streamlabs wraps every part of a collection as { nodeType, data }. */
function node(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return isRecord(value.data) && typeof value.nodeType === "string" ? value.data : value;
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let index = 2; taken.has(name); index += 1) name = `${base} ${index}`;
  taken.add(name);
  return name;
}

function slobsSyncMs(value: unknown): number {
  if (isRecord(value)) return num(value.sec, 0) * 1000 + num(value.nsec, 0) / 1e6;
  return num(value, 0);
}

/** Converts a Streamlabs Desktop scene collection file (SceneCollections/<id>.json). */
export function convertStreamlabsCollection(json: unknown, name: string, options: ConvertOptions): ConvertedCollection {
  const root = node(json);
  const sourceNodes = records(node(root.sources).items);
  const sceneNodes = records(node(root.scenes).items);
  if (sceneNodes.length === 0) throw new Error("import-invalid");
  // Names must be unique across scenes and sources here; Streamlabs uses ids.
  const taken = new Set<string>();
  const nameById = new Map<string, string>();
  const sceneOrder: string[] = [];
  for (const scene of sceneNodes) {
    const id = text(scene.id);
    if (!id || nameById.has(id)) continue;
    const unique = uniqueName(text(scene.name) ?? id, taken);
    nameById.set(id, unique);
    sceneOrder.push(unique);
  }
  const rawSources: { id: string; raw: RawSource; channel?: number }[] = [];
  for (const source of sourceNodes) {
    const id = text(source.id);
    const inputId = text(source.type);
    if (!id || !inputId || nameById.has(id) || inputId === "scene") continue;
    const unique = uniqueName(text(source.name) ?? id, taken);
    nameById.set(id, unique);
    const filters = records(node(source.filters).items).flatMap((filter) => {
      const filterId = text(filter.type);
      return filterId ? [{ id: filterId, name: text(filter.name) ?? filterId, enabled: filter.visible !== false && filter.enabled !== false, settings: isRecord(filter.settings) ? filter.settings : {} }] : [];
    });
    const channel = num(source.channel, 0);
    rawSources.push({
      id,
      channel: channel >= 1 && channel <= 6 ? channel : undefined,
      raw: {
        name: unique,
        inputId,
        settings: isRecord(source.settings) ? source.settings : {},
        volume: num(source.volume, 1),
        muted: source.muted === true,
        monitoring: num(source.monitoringType, 0),
        syncOffsetMs: slobsSyncMs(source.syncOffset),
        mono: source.forceMono === true,
        mixers: typeof source.audioMixers === "number" ? source.audioMixers : undefined,
        filters,
      },
    });
  }
  const names = new Set(rawSources.map((entry) => entry.raw.name));
  const counter = { filters: 0, skipped: 0 };
  const sources = rawSources.map((entry) => toSavedSource(entry.raw, names, counter));
  const globalAudio = rawSources.flatMap((entry) => (entry.channel ? [{ channel: entry.channel, source: entry.raw.name }] : []));

  const scenes = new Map<string, SavedItem[]>();
  for (const scene of sceneNodes) {
    const sceneName = nameById.get(text(scene.id) ?? "");
    if (!sceneName || scenes.has(sceneName)) continue;
    const items = records(node(scene.sceneItems).items).flatMap((item): SavedItem[] => {
      // Folders only group rows in the Streamlabs list; their items are listed on their own.
      if (item.type === "folder") return [];
      const source = nameById.get(text(item.sourceId) ?? "");
      if (!source) return [];
      const crop = isRecord(item.crop) ? item.crop : {};
      return [
        {
          source,
          visible: item.visible !== false,
          locked: item.locked === true,
          position: { x: num(item.x, 0), y: num(item.y, 0) },
          scale: { x: num(item.scaleX, 1), y: num(item.scaleY, 1) },
          rotation: num(item.rotation, 0),
          alignment: ALIGN_TOP_LEFT,
          boundsType: 0,
          boundsAlignment: 0,
          bounds: { x: 0, y: 0 },
          crop: { left: Math.max(0, num(crop.left, 0)), top: Math.max(0, num(crop.top, 0)), right: Math.max(0, num(crop.right, 0)), bottom: Math.max(0, num(crop.bottom, 0)) },
        },
      ];
    });
    // Streamlabs lists the top item first; libobs order is bottom to top.
    scenes.set(sceneName, items.reverse());
  }
  const active = nameById.get(text(node(root.scenes).activeId) ?? "") ?? null;
  return finish(name, scenes, sceneOrder, active, sources, globalAudio, null, counter.skipped, options);
}

// ----- discovery ------------------------------------------------------------------------

export interface ImportRoots {
  /** OBS Studio's configuration folder. */
  obs: string | null;
  /** Streamlabs Desktop's configuration folder. */
  streamlabs: string | null;
}

/** Where the apps keep their configuration on this platform. */
export function importRoots(platform: string, home: string, appData?: string): ImportRoots {
  if (platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    return { obs: path.join(support, "obs-studio"), streamlabs: path.join(support, "slobs-client") };
  }
  if (platform === "win32") {
    const roaming = appData ?? path.join(home, "AppData", "Roaming");
    return { obs: path.join(roaming, "obs-studio"), streamlabs: path.join(roaming, "slobs-client") };
  }
  return { obs: path.join(home, ".config", "obs-studio"), streamlabs: null };
}

function readJsonFile(file: string): unknown {
  if (statSync(file).size > MAX_FILE_BYTES) throw new Error("import-too-large");
  return JSON.parse(readFileSync(file, "utf8"));
}

function listJson(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json") && entry.name !== "manifest.json")
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Reads `key` from an INI section (OBS profile and user settings). */
export function iniValue(source: string, section: string, key: string): string | undefined {
  let current = "";
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const header = /^\[(.+)\]$/u.exec(trimmed);
    if (header) {
      current = header[1];
      continue;
    }
    if (current !== section) continue;
    const at = trimmed.indexOf("=");
    if (at > 0 && trimmed.slice(0, at).trim() === key) return trimmed.slice(at + 1).trim();
  }
  return undefined;
}

/**
 * Canvas size of OBS's current profile. Only [Video] BaseCX/BaseCY are read
 * from the profile; its stream settings live in another file that is never opened.
 */
export function obsCanvas(root: string): CanvasSize | null {
  try {
    let profileDir: string | undefined;
    for (const file of ["user.ini", "global.ini"]) {
      const full = path.join(root, file);
      if (!existsSync(full)) continue;
      profileDir = iniValue(readFileSync(full, "utf8"), "Basic", "ProfileDir");
      if (profileDir) break;
    }
    if (!profileDir || profileDir.includes("..") || /[\\/]/u.test(profileDir)) return null;
    const basic = path.join(root, "basic", "profiles", profileDir, "basic.ini");
    if (!existsSync(basic)) return null;
    const content = readFileSync(basic, "utf8");
    const width = Number(iniValue(content, "Video", "BaseCX"));
    const height = Number(iniValue(content, "Video", "BaseCY"));
    return Number.isInteger(width) && Number.isInteger(height) && width >= 16 && height >= 16 ? { width, height } : null;
  } catch {
    return null;
  }
}

function obsScenesDir(roots: ImportRoots): string | null {
  return roots.obs ? path.join(roots.obs, "basic", "scenes") : null;
}

function streamlabsDir(roots: ImportRoots): string | null {
  return roots.streamlabs ? path.join(roots.streamlabs, "SceneCollections") : null;
}

/** Streamlabs collection names and ids from its manifest (deleted ones left out). */
function streamlabsManifest(dir: string): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const manifest = node(readJsonFile(path.join(dir, "manifest.json")));
    for (const entry of records(manifest.collections)) {
      const id = text(entry.id);
      if (id && entry.deleted !== true) names.set(id, text(entry.name) ?? id);
    }
  } catch {
    // Without a manifest the file names are used.
  }
  return names;
}

const CANDIDATE_ID = /^(obs|streamlabs):([^/\\]+\.json)$/iu;

/** Scene collections of OBS Studio and Streamlabs Desktop found on this computer. */
export function findImportCandidates(roots: ImportRoots, platform: string): ImportCandidate[] {
  const result: ImportCandidate[] = [];
  const obsDir = obsScenesDir(roots);
  for (const file of obsDir ? listJson(obsDir) : []) {
    try {
      const converted = convertObsCollection(readJsonFile(path.join(obsDir as string, file)), file.replace(/\.json$/iu, ""), { platform });
      result.push(candidate("obs", file, converted));
    } catch {
      // Not a scene collection (or unreadable): not offered.
    }
  }
  const slobsDir = streamlabsDir(roots);
  if (slobsDir && existsSync(slobsDir)) {
    const manifest = streamlabsManifest(slobsDir);
    for (const file of listJson(slobsDir)) {
      const id = file.replace(/\.json$/iu, "");
      if (manifest.size > 0 && !manifest.has(id)) continue;
      try {
        const converted = convertStreamlabsCollection(readJsonFile(path.join(slobsDir, file)), manifest.get(id) ?? id, { platform });
        result.push(candidate("streamlabs", file, converted));
      } catch {
        // Not a scene collection (or unreadable): not offered.
      }
    }
  }
  return result;
}

function candidate(app: ImportApp, file: string, converted: ConvertedCollection): ImportCandidate {
  return { id: `${app}:${file}`, app, name: converted.name, scenes: converted.stats.scenes, sources: converted.stats.sources };
}

/** Converts a found collection for our canvas; the id must name a file in the app's folder. */
export function readImportCandidate(id: string, roots: ImportRoots, platform: string, canvas: CanvasSize): ConvertedCollection {
  const match = CANDIDATE_ID.exec(String(id));
  if (!match) throw new Error("invalid-request");
  const app = match[1].toLowerCase() as ImportApp;
  const file = match[2];
  const dir = app === "obs" ? obsScenesDir(roots) : streamlabsDir(roots);
  if (!dir || !listJson(dir).includes(file)) throw new Error("import-not-found");
  const json = readJsonFile(path.join(dir, file));
  const base = file.replace(/\.json$/iu, "");
  if (app === "obs") {
    const from = (roots.obs && obsCanvas(roots.obs)) || canvas;
    return convertObsCollection(json, base, { platform, canvas: { from, to: canvas } });
  }
  const manifest = streamlabsManifest(dir);
  // Streamlabs uses a 1920×1080 canvas unless set otherwise; its video settings are not read.
  return convertStreamlabsCollection(json, manifest.get(base) ?? base, { platform, canvas: { from: { width: 1920, height: 1080 }, to: canvas } });
}

/** Converts a collection file the user picked (an OBS export or a Streamlabs collection). */
export function readImportFile(file: string, platform: string, canvas: CanvasSize): ConvertedCollection {
  const json = readJsonFile(file);
  const base = path.basename(file).replace(/\.json$/iu, "");
  if (isRecord(json) && Array.isArray(json.sources)) return convertObsCollection(json, base, { platform, canvas: { from: canvas, to: canvas } });
  return convertStreamlabsCollection(json, base, { platform, canvas: { from: { width: 1920, height: 1080 }, to: canvas } });
}
