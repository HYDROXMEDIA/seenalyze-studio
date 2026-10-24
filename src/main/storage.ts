// Sizes and cleanup of the app's own data, and the "erase local data" reset.
// Pure file-system helpers: every folder is passed in (no Electron imports), so
// they are tested against a temporary folder. Recordings are never touched here.

import { promises as fs } from "node:fs";
import path from "node:path";
import { STORAGE_CATEGORIES, type StorageCategoryId } from "../shared/types";

const RECORDING_EXTENSIONS = new Set([".mkv", ".mp4", ".mov", ".webm"]);

/** Folders (inside the user data folder) each cleanable category lives in. Logs are handled by log.ts. */
export function categoryFolders(userData: string): Record<Exclude<StorageCategoryId, "logs">, string[]> {
  return {
    // Pointer paths and edit settings kept for each screen recording.
    editorData: [path.join(userData, "recording-data")],
    // Caption recognizer, its model and the folder it is built in.
    captionModels: [path.join(userData, "models"), path.join(userData, "tools"), path.join(userData, "bootstrap")],
  };
}

export function isStorageCategory(value: unknown): value is StorageCategoryId {
  return typeof value === "string" && (STORAGE_CATEGORIES as readonly string[]).includes(value);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/** Total size of files under the given paths. Missing paths count as empty; any other read error is thrown. Symlinks are not followed. */
export async function pathsSize(paths: string[]): Promise<number> {
  let total = 0;
  const visit = async (target: string): Promise<void> => {
    let stat;
    try {
      stat = await fs.lstat(target);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    if (stat.isDirectory()) {
      let names: string[];
      try {
        names = await fs.readdir(target);
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
      for (const name of names) await visit(path.join(target, name));
    } else if (stat.isFile()) {
      total += stat.size;
    }
  };
  for (const target of paths) await visit(target);
  return total;
}

/** Size of the video files directly inside the recordings folder (subfolders are not scanned: the folder may be the user's whole Movies folder). */
export async function recordingsSize(folder: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !RECORDING_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      total += (await fs.stat(path.join(folder, entry.name))).size;
    } catch (error) {
      // A file removed while counting no longer takes space.
      if (!isMissing(error)) throw error;
    }
  }
  return total;
}

/** Total and free bytes of the drive holding `target`. */
export async function diskSpace(target: string): Promise<{ totalBytes: number; freeBytes: number }> {
  const stats = await fs.statfs(target);
  return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
}

/** Deletes the given folders and files. Already missing ones are fine; any other failure is thrown after all were tried. */
export async function removePaths(paths: string[]): Promise<void> {
  const failures: unknown[] = [];
  for (const target of paths) {
    try {
      await fs.rm(target, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
      console.error(`[storage] could not remove ${path.basename(target)}`, error);
    }
  }
  if (failures.length > 0) throw new Error("storage-clean-failed", { cause: failures[0] });
}

// ----- erase local data ------------------------------------------------------

const ERASE_MARKER = "erase-local-data.pending";

/** App-owned files and folders in the user data folder. studio.config.json (app configuration) and the web view's own storage stay. */
const ERASE_FOLDERS = ["overlays", "scene-collections", "engine", "recording-data", "recording-backgrounds", "models", "tools", "bootstrap"];
const ERASE_FILES = ["studio.json", "secrets.json", "recording-presets.json", "screen-recording.json"];

/** Asks the next start to reset local data. Done at start because settings are still being saved while the app runs. */
export async function requestErase(userData: string): Promise<void> {
  await fs.writeFile(path.join(userData, ERASE_MARKER), new Date().toISOString(), { mode: 0o600 });
}

export interface EraseResult {
  erased: boolean;
  /** Names that could not be removed; the request stays pending so the next start tries again. */
  failed: string[];
}

/** Carries out a pending erase request. Call before anything reads saved data. */
export async function applyPendingErase(userData: string): Promise<EraseResult> {
  const marker = path.join(userData, ERASE_MARKER);
  try {
    await fs.access(marker);
  } catch (error) {
    if (isMissing(error)) return { erased: false, failed: [] };
    throw error;
  }
  const names = new Set([...ERASE_FOLDERS, ...ERASE_FILES]);
  // Backups and leftovers next to the settings file ("studio.json.before-…", ".corrupt-…", ".tmp").
  for (const name of await fs.readdir(userData)) {
    if (ERASE_FILES.some((file) => name.startsWith(`${file}.`))) names.add(name);
  }
  const failed: string[] = [];
  for (const name of names) {
    try {
      await fs.rm(path.join(userData, name), { recursive: true, force: true });
    } catch (error) {
      failed.push(name);
      console.error(`[storage] erase could not remove ${name}`, error);
    }
  }
  if (failed.length > 0) return { erased: false, failed };
  await fs.rm(marker, { force: true });
  return { erased: true, failed: [] };
}
