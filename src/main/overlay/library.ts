// The user's overlay library: one JSON file per overlay in the app data folder.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  coerceValue,
  OVERLAY_KINDS,
  type OverlayDefinition,
  type OverlayKind,
  type OverlayPatch,
  type OverlaySummary,
  type OverlayValue,
} from "../../shared/overlays";
import type { ValidDesign } from "./design";
import { findPreset } from "./presets";

const ID = /^[a-f0-9-]{36}$/u;
const MIN_SIZE = 40;
const MAX_SIZE = 3840;

export function summarize(overlay: OverlayDefinition): OverlaySummary {
  const { id, name, kind, origin, width, height, updatedAt } = overlay;
  return { id, name, kind, origin, width, height, updatedAt };
}

function clampSize(value: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, n)) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A stored overlay as the library can use it, or null. Files are edited by hand or left over from older
 * versions, so missing settings or sizes get safe defaults, and the id must match the file name so
 * deleting an overlay always removes its own file.
 */
export function loadedOverlay(raw: unknown, file: string): OverlayDefinition | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !ID.test(raw.id) || file !== `${raw.id}.json`) return null;
  if (typeof raw.html !== "string" || !Array.isArray(raw.fields) || !raw.fields.every((field) => isRecord(field) && typeof field.key === "string")) return null;
  const overlay = raw as unknown as OverlayDefinition;
  const updatedAt = Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0;
  return {
    ...overlay,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.slice(0, 60) : "Overlay",
    kind: OVERLAY_KINDS.includes(raw.kind as OverlayKind) ? overlay.kind : "custom",
    values: isRecord(raw.values) ? overlay.values : {},
    width: clampSize(Number(raw.width), 800),
    height: clampSize(Number(raw.height), 600),
    createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : updatedAt,
    updatedAt,
  };
}

export class OverlayLibrary {
  private readonly cache = new Map<string, OverlayDefinition>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const overlay = loadedOverlay(JSON.parse(readFileSync(path.join(dir, file), "utf8")), file);
        if (overlay) this.cache.set(overlay.id, overlay);
        else console.error(`[overlays] ${file} is not a valid overlay; it was skipped`);
      } catch (error) {
        console.error(`[overlays] could not read ${file}; it was skipped`, error);
      }
    }
  }

  list(): OverlaySummary[] {
    return [...this.cache.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(summarize);
  }

  get(id: string): OverlayDefinition | undefined {
    return ID.test(id) ? this.cache.get(id) : undefined;
  }

  require(id: string): OverlayDefinition {
    const overlay = this.get(id);
    if (!overlay) throw new Error("overlay-not-found");
    return overlay;
  }

  createFromPreset(presetId: string): OverlayDefinition {
    const preset = findPreset(presetId);
    if (!preset) throw new Error("overlay-not-found");
    const now = Date.now();
    return this.save({
      id: randomUUID(),
      name: preset.name,
      kind: preset.kind,
      html: preset.html,
      fields: preset.fields,
      values: {},
      width: preset.width,
      height: preset.height,
      origin: "preset",
      presetId: preset.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  createFromDesign(design: ValidDesign, kind: OverlayKind, size: { width: number; height: number }): OverlayDefinition {
    const now = Date.now();
    return this.save({
      id: randomUUID(),
      name: design.name,
      kind: OVERLAY_KINDS.includes(kind) ? kind : "custom",
      html: design.html,
      fields: design.fields,
      values: {},
      width: clampSize(size.width, 800),
      height: clampSize(size.height, 600),
      origin: "ai",
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Replaces the design of an existing overlay, keeping values for fields that still exist. */
  replaceDesign(id: string, design: ValidDesign): OverlayDefinition {
    const overlay = this.require(id);
    const keys = new Set(design.fields.map((field) => field.key));
    const values = Object.fromEntries(Object.entries(overlay.values).filter(([key]) => keys.has(key)));
    return this.save({ ...overlay, name: design.name, html: design.html, fields: design.fields, values, origin: "ai", updatedAt: Date.now() });
  }

  update(id: string, patch: OverlayPatch): OverlayDefinition {
    const overlay = this.require(id);
    const next = { ...overlay, updatedAt: Date.now() };
    if (typeof patch.name === "string" && patch.name.trim()) next.name = patch.name.trim().slice(0, 60);
    if (patch.width !== undefined) next.width = clampSize(patch.width, overlay.width);
    if (patch.height !== undefined) next.height = clampSize(patch.height, overlay.height);
    if (patch.values) {
      const values: Record<string, OverlayValue> = { ...overlay.values };
      for (const field of overlay.fields) {
        if (field.key in patch.values) values[field.key] = coerceValue(field, patch.values[field.key]);
      }
      next.values = values;
    }
    return this.save(next);
  }

  /** Restores every setting to the design's defaults. */
  reset(id: string): OverlayDefinition {
    return this.save({ ...this.require(id), values: {}, updatedAt: Date.now() });
  }

  duplicate(id: string): OverlayDefinition {
    const overlay = this.require(id);
    const now = Date.now();
    return this.save({ ...overlay, id: randomUUID(), name: `${overlay.name} copy`.slice(0, 60), createdAt: now, updatedAt: now });
  }

  remove(id: string): void {
    this.require(id);
    this.cache.delete(id);
    rmSync(path.join(this.dir, `${id}.json`), { force: true });
  }

  private save(overlay: OverlayDefinition): OverlayDefinition {
    const file = path.join(this.dir, `${overlay.id}.json`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(overlay), { mode: 0o600 });
    renameSync(tmp, file);
    this.cache.set(overlay.id, overlay);
    return overlay;
  }

  has(id: string): boolean {
    return this.cache.has(id) && existsSync(path.join(this.dir, `${id}.json`));
  }
}
