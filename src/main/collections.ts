// Scene collection storage. The active collection stays in studio.json (as it
// always has); every other collection is one JSON file in the
// `scene-collections` folder, with the canvas size it was saved at so it can
// be rescaled when the canvas changed in the meantime. No Electron imports, so
// it is testable with a temporary folder.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sanitizeTransition, type TransitionChoice } from "../shared/transitions";
import { sanitizeAudioFormat, sanitizeRecordingTracks, type AudioFormat } from "../shared/formats";
import { sanitizeNamedList, type NamedList, type ProfileData } from "../shared/workspace";
import type { SceneCollection } from "./engine/scenes";

export interface CanvasSize {
  width: number;
  height: number;
}

export interface StoredCollection {
  canvas: CanvasSize;
  /** Transition used with this collection. */
  transition?: TransitionChoice;
  /** null: a new collection the engine fills with its default scene. */
  collection: SceneCollection | null;
}

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u;
/** Collections of several hundred scenes stay far below this. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const BOUNDS_NONE = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shape check for collection data read from disk; null when it is not one. */
export function sanitizeCollection(value: unknown): SceneCollection | null {
  if (!isRecord(value)) return null;
  const { sceneOrder, scenes, sources, globalAudio, activeScene } = value;
  if (!Array.isArray(sceneOrder) || !sceneOrder.every((name) => typeof name === "string")) return null;
  if (!isRecord(scenes) || !Object.values(scenes).every(Array.isArray)) return null;
  if (!Array.isArray(sources) || !sources.every((source) => isRecord(source) && typeof source.name === "string" && typeof source.inputId === "string")) return null;
  if (!Array.isArray(globalAudio)) return null;
  return {
    ...(value as unknown as SceneCollection),
    activeScene: typeof activeScene === "string" ? activeScene : null,
  };
}

function sanitizeCanvas(value: unknown): CanvasSize | null {
  if (!isRecord(value)) return null;
  const width = Number(value.width);
  const height = Number(value.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

export function sanitizeStoredCollection(value: unknown): StoredCollection | null {
  if (!isRecord(value)) return null;
  const canvas = sanitizeCanvas(value.canvas);
  if (!canvas) return null;
  const collection = value.collection === null ? null : sanitizeCollection(value.collection);
  if (value.collection !== null && !collection) return null;
  return { canvas, transition: value.transition === undefined ? undefined : sanitizeTransition(value.transition), collection };
}

/**
 * Keeps every item's layout proportional to a new canvas size (same rule as
 * SceneGraph.rescale, applied to saved data).
 */
export function rescaleCollection(collection: SceneCollection, from: CanvasSize, to: CanvasSize): SceneCollection {
  const rx = to.width / from.width;
  const ry = to.height / from.height;
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 0 || ry <= 0 || (rx === 1 && ry === 1)) return collection;
  const scenes: SceneCollection["scenes"] = {};
  for (const [name, items] of Object.entries(collection.scenes)) {
    scenes[name] = items.map((item) => ({
      ...item,
      position: { x: item.position.x * rx, y: item.position.y * ry },
      scale: item.boundsType === BOUNDS_NONE ? { x: item.scale.x * rx, y: item.scale.y * ry } : item.scale,
      bounds: item.boundsType === BOUNDS_NONE ? item.bounds : { x: item.bounds.x * rx, y: item.bounds.y * ry },
    }));
  }
  return { ...collection, scenes };
}

/** Collection files other than the active one. */
export class CollectionFiles {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error("invalid-request");
    return path.join(this.dir, `${id}.json`);
  }

  has(id: string): boolean {
    return existsSync(this.file(id));
  }

  /** Throws "collection-unreadable" when the file is missing or damaged. */
  read(id: string): StoredCollection {
    const file = this.file(id);
    try {
      if (statSync(file).size > MAX_FILE_BYTES) throw new Error("too large");
      const stored = sanitizeStoredCollection(JSON.parse(readFileSync(file, "utf8")));
      if (stored) return stored;
    } catch (error) {
      // The message is left out: it can contain the user's folder path.
      console.error("[collections] a scene collection could not be read", error instanceof Error ? error.name : "");
    }
    throw new Error("collection-unreadable");
  }

  /** Atomic: a crash mid-write never leaves a half-written collection. */
  write(id: string, stored: StoredCollection): void {
    const file = this.file(id);
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(stored), { mode: 0o600 });
    renameSync(tmp, file);
  }

  copy(from: string, to: string): void {
    const target = this.file(to);
    mkdirSync(this.dir, { recursive: true });
    copyFileSync(this.file(from), `${target}.tmp`);
    renameSync(`${target}.tmp`, target);
  }

  remove(id: string): void {
    rmSync(this.file(id), { force: true });
  }
}

// ----- persisted workspace state -------------------------------------------------

/** Workspace fields of studio.json (see Studio's PersistedState). */
export interface WorkspaceFields {
  collections: NamedList;
  profiles: NamedList;
  /** Settings of every profile except the active one (whose settings are the live state). */
  profileData: Record<string, ProfileData>;
  /** Chosen audio format; null keeps the engine default. */
  audioFormat: AudioFormat | null;
  recordingTracks: number;
}

/**
 * Reads the workspace fields of a saved studio.json. Files from before
 * collections and profiles existed get one collection (the one already in the
 * file, which stays where it is) and one profile (the settings already in the
 * file), so nothing is moved or lost.
 */
export function migrateWorkspace(saved: Record<string, unknown>, newId: () => string): WorkspaceFields {
  const collections = sanitizeNamedList(saved.collections, newId());
  const profiles = sanitizeNamedList(saved.profiles, newId());
  const profileData: Record<string, ProfileData> = {};
  if (isRecord(saved.profileData)) {
    for (const entry of profiles.items) {
      const data = saved.profileData[entry.id];
      if (entry.id !== profiles.activeId && isRecord(data) && isRecord(data.video)) profileData[entry.id] = data as unknown as ProfileData;
    }
  }
  return {
    collections,
    profiles,
    profileData,
    audioFormat: sanitizeAudioFormat(saved.audioFormat),
    recordingTracks: sanitizeRecordingTracks(saved.recordingTracks),
  };
}
