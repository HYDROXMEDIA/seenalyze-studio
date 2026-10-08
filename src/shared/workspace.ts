// Scene collections and profiles: the named lists the user switches between,
// what a profile holds, and the import-from-another-app contract. Pure data
// and rules shared by the main process and the renderer.

import type { AudioFormat } from "./formats";
import type { AdvancedStreamSettings, DestinationProfile, StudioPreferences, VideoSettings } from "./types";

export interface NamedEntry {
  id: string;
  /** Empty for the entry created from an older install; the UI shows a default name. */
  name: string;
}

export interface NamedList {
  activeId: string;
  items: NamedEntry[];
}

export interface WorkspaceSnapshot {
  collections: NamedList;
  profiles: NamedList;
  /** A collection or profile switch (or an engine restart for audio) is running. */
  switching: boolean;
  /** Audio format in use. */
  audioFormat: AudioFormat;
  /** Bitmask of the audio tracks recordings keep. */
  recordingTracks: number;
}

/** Recording preferences that belong to a profile (app behaviour stays global). */
export const PROFILE_PREFERENCE_KEYS = [
  "recordingFormat",
  "recordingBitrateKbps",
  "recordingMatchStream",
  "replayBufferEnabled",
  "replayBufferSeconds",
] as const satisfies readonly (keyof StudioPreferences)[];

export type ProfilePreferences = Pick<StudioPreferences, (typeof PROFILE_PREFERENCE_KEYS)[number]>;

/** Everything a profile switches. Stream keys and accounts are never part of it. */
export interface ProfileData {
  video: VideoSettings;
  encoder: string | null;
  recordingFolder: string | null;
  preferences: ProfilePreferences;
  advanced: AdvancedStreamSettings;
  /** null keeps the engine default. */
  audioFormat: AudioFormat | null;
  recordingTracks: number;
  /** Video profile per destination id. */
  destinationProfiles: Record<string, DestinationProfile>;
}

export const MAX_ENTRY_NAME = 60;
export const MAX_ENTRIES = 100;

/** A trimmed, length-limited name; null when nothing is left. */
export function cleanEntryName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Control characters never belong in a name shown in menus.
  const clean = Array.from(value)
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, MAX_ENTRY_NAME)
    .trim();
  return clean || null;
}

/** Whether a name is already used by another entry (case-insensitive). */
export function entryNameTaken(list: NamedEntry[], name: string, exceptId?: string): boolean {
  const lower = name.toLocaleLowerCase();
  return list.some((entry) => entry.id !== exceptId && entry.name.toLocaleLowerCase() === lower);
}

/** `name`, or "name 2", "name 3"… when it is taken. */
export function uniqueEntryName(list: NamedEntry[], name: string): string {
  if (!entryNameTaken(list, name)) return name;
  const match = /^(.*\S)\s+(\d+)$/u.exec(name);
  const base = match ? match[1] : name;
  for (let index = match ? Number(match[2]) + 1 : 2; ; index += 1) {
    const candidate = `${base} ${index}`.slice(0, MAX_ENTRY_NAME);
    if (!entryNameTaken(list, candidate)) return candidate;
  }
}

/**
 * Restores a saved list. Unknown or duplicate entries are dropped and the
 * active entry always exists, so an older install gets one entry whose id is
 * `fallbackId` (its data stays where it was).
 */
export function sanitizeNamedList(value: unknown, fallbackId: string): NamedList {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const items: NamedEntry[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,64}$/u.test(id) || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, name: cleanEntryName(name) ?? "" });
    if (items.length >= MAX_ENTRIES) break;
  }
  const activeId = typeof raw.activeId === "string" && seen.has(raw.activeId) ? raw.activeId : (items[0]?.id ?? fallbackId);
  if (!seen.has(activeId)) items.unshift({ id: activeId, name: "" });
  return { activeId, items };
}

// ----- import from other apps --------------------------------------------------

export const IMPORT_APPS = ["obs", "streamlabs"] as const;
export type ImportApp = (typeof IMPORT_APPS)[number];

/** A scene collection found in another streaming app on this computer. */
export interface ImportCandidate {
  /** Opaque id the main process resolves again; never a path. */
  id: string;
  app: ImportApp;
  name: string;
  scenes: number;
  sources: number;
}

export interface ImportResult {
  collectionId: string;
  name: string;
  scenes: number;
  sources: number;
  /** Sources whose type this app does not have; kept, shown as missing. */
  unavailableSources: number;
  /** Filters with no equivalent here; not imported. */
  skippedFilters: number;
  /** The studio switched to the imported collection. */
  switched: boolean;
}
