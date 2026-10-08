// Video effects (libobs video filters) offered per source: the catalog, the
// engine filter types behind each effect, their starting settings, and the
// validation of effect lists that cross IPC or come back from disk.

export const EFFECT_KINDS = [
  "chromaKey",
  "colorCorrection",
  "crop",
  "lut",
  "colorKey",
  "lumaKey",
  "sharpen",
  "mask",
  "scale",
  "scroll",
  "renderDelay",
] as const;

export type EffectKind = (typeof EFFECT_KINDS)[number];

interface EffectSpec {
  /** Engine filter types, newest first; the first installed one is used. */
  engineIds: readonly string[];
  /** Settings a new effect starts with, so it does something useful at once. */
  defaults: Record<string, unknown>;
}

export const EFFECT_SPECS: Record<EffectKind, EffectSpec> = {
  chromaKey: { engineIds: ["chroma_key_filter_v2", "chroma_key_filter"], defaults: { key_color_type: "green" } },
  colorCorrection: { engineIds: ["color_filter_v2", "color_filter"], defaults: {} },
  crop: { engineIds: ["crop_filter"], defaults: {} },
  lut: { engineIds: ["clut_filter"], defaults: {} },
  colorKey: { engineIds: ["color_key_filter_v2", "color_key_filter"], defaults: { key_color_type: "green" } },
  lumaKey: { engineIds: ["luma_key_filter_v2", "luma_key_filter"], defaults: {} },
  sharpen: { engineIds: ["sharpness_filter_v2", "sharpness_filter"], defaults: {} },
  mask: { engineIds: ["mask_filter_v2", "mask_filter"], defaults: {} },
  scale: { engineIds: ["scale_filter"], defaults: {} },
  scroll: { engineIds: ["scroll_filter"], defaults: {} },
  renderDelay: { engineIds: ["gpu_delay"], defaults: {} },
};

/** One effect applied to a source, in the order the engine draws them. */
export interface EffectDTO {
  /** Engine filter name, unique within the source. */
  name: string;
  kind: EffectKind;
  enabled: boolean;
}

export interface EffectList {
  /** Effects this computer's engine can apply, in catalog order. */
  available: EffectKind[];
  effects: EffectDTO[];
}

/** An effect with its settings: saved with the scene collection and used for copy/paste. */
export interface EffectSnapshot {
  kind: EffectKind;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export function isEffectKind(value: unknown): value is EffectKind {
  return typeof value === "string" && (EFFECT_KINDS as readonly string[]).includes(value);
}

/** The engine filter type to create for an effect, or null when none is installed. */
export function resolveEffectType(kind: EffectKind, installed: Iterable<string>): string | null {
  const types = new Set(installed);
  return EFFECT_SPECS[kind].engineIds.find((id) => types.has(id)) ?? null;
}

export function availableEffectKinds(installed: Iterable<string>): EffectKind[] {
  const types = [...installed];
  return EFFECT_KINDS.filter((kind) => resolveEffectType(kind, types) !== null);
}

/** The effect an engine filter type belongs to; null for filters that are not video effects. */
export function effectKindOf(engineId: string): EffectKind | null {
  return EFFECT_KINDS.find((kind) => EFFECT_SPECS[kind].engineIds.includes(engineId)) ?? null;
}

/** A filter name not used by any of `taken`, based on the effect kind. */
export function effectName(kind: EffectKind, taken: Iterable<string>): string {
  const used = new Set(taken);
  let index = 1;
  while (used.has(`${kind} ${index}`)) index += 1;
  return `${kind} ${index}`;
}

const MAX_EFFECTS = 32;
const MAX_SETTINGS_JSON = 64 * 1024;

/** Keeps only well-formed effect snapshots (renderer clipboard or saved collection). */
export function sanitizeEffectSnapshots(value: unknown): EffectSnapshot[] {
  if (!Array.isArray(value)) return [];
  const result: EffectSnapshot[] = [];
  for (const entry of value.slice(0, MAX_EFFECTS)) {
    if (!entry || typeof entry !== "object") continue;
    const { kind, enabled, settings } = entry as Record<string, unknown>;
    if (!isEffectKind(kind)) continue;
    const plain = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
    let copy: Record<string, unknown>;
    try {
      const json = JSON.stringify(plain);
      if (json.length > MAX_SETTINGS_JSON) continue;
      copy = JSON.parse(json) as Record<string, unknown>;
    } catch {
      continue;
    }
    result.push({ kind, enabled: enabled !== false, settings: copy });
  }
  return result;
}
