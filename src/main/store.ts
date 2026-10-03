// Atomic JSON persistence in the user data folder. Credentials never go here;
// they live in secrets.ts.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

export function dataDir(...segments: string[]): string {
  const dir = path.join(app.getPath("userData"), ...segments);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T>(file: string, fallback: T): T {
  const full = path.join(dataDir(), file);
  if (!existsSync(full)) return fallback;
  try {
    return JSON.parse(readFileSync(full, "utf8")) as T;
  } catch (error) {
    // Keep the unreadable file for recovery instead of overwriting it silently.
    const backup = `${full}.corrupt-${Date.now()}`;
    renameSync(full, backup);
    console.error(`[store] ${file} was unreadable and was moved aside`, error);
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  const full = path.join(dataDir(), file);
  const tmp = `${full}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, full);
}

/** Coalesces frequent saves into one write per tick window. */
export function debounced(fn: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}
