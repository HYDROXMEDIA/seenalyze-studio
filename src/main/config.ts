// Public app configuration (OAuth client identifiers). The file is
// maintainer-filled and gitignored; see config/studio.config.example.json.
// Values are read in the main process only and never sent to the renderer.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

export interface StudioConfig {
  twitchClientId?: string;
  youtubeClientId?: string;
  /** Google "Desktop app" clients issue a non-confidential secret that the token endpoint still expects. */
  youtubeClientSecret?: string;
  /** SEENALYZE dashboard address for account sign-in and the overlay designer. */
  seenalyzeOrigin?: string;
}

let cached: StudioConfig | null = null;

export function studioConfig(): StudioConfig {
  if (cached) return cached;
  const candidates = [
    path.join(app.getPath("userData"), "studio.config.json"),
    path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "config", "studio.config.json"),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  cached = file ? (JSON.parse(readFileSync(file, "utf8")) as StudioConfig) : {};
  return cached;
}
