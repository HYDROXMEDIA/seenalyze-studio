// Recording-side statistics the engine does not report: free disk space in the
// recording folder and the measured recording bitrate (from the growth of the
// file being written). Sampling is asynchronous and never overlaps, so a slow
// disk can only make the numbers stale, never delay the engine statistics.

import { readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { RECORDING_FORMATS, type RecordingStatus } from "../shared/types";

const DISK_INTERVAL_MS = 5000;
/** Files written slightly before the reported start still belong to this recording. */
const START_SLACK_MS = 3000;

export interface OutputStatsSample {
  diskFreeMb?: number;
  recordingKbps?: number;
}

export class OutputStatsProbe {
  private values: OutputStatsSample = {};
  private busy = false;
  private diskFolder = "";
  private diskCheckedAt = 0;
  private file: { path: string; startedAt: number; bytes: number; at: number } | null = null;
  private searchedAt = 0;

  latest(): OutputStatsSample {
    return { ...this.values };
  }

  /** Starts a background sample unless one is still running. */
  refresh(folder: string, recording: RecordingStatus): void {
    if (this.busy) return;
    this.busy = true;
    this.sample(folder, recording)
      .catch((error: unknown) => console.warn("[stats] could not sample recording statistics", error))
      .finally(() => {
        this.busy = false;
      });
  }

  private async sample(folder: string, recording: RecordingStatus): Promise<void> {
    const now = Date.now();
    if (folder !== this.diskFolder || now - this.diskCheckedAt >= DISK_INTERVAL_MS) {
      this.diskFolder = folder;
      this.diskCheckedAt = now;
      try {
        const info = await statfs(folder);
        this.values.diskFreeMb = Math.round((Number(info.bavail) * Number(info.bsize)) / (1024 * 1024));
      } catch {
        // A missing or unmounted folder has no free space to report.
        this.values.diskFreeMb = undefined;
      }
    }

    if (!recording.active || !recording.startedAt) {
      this.file = null;
      this.searchedAt = 0;
      this.values.recordingKbps = undefined;
      return;
    }
    if (!this.file || this.file.startedAt !== recording.startedAt) {
      // Looking for the file lists the folder; do it at most every few seconds.
      if (now - this.searchedAt < DISK_INTERVAL_MS) return;
      this.searchedAt = now;
      const found = await newestRecording(folder, recording.startedAt - START_SLACK_MS);
      this.file = found ? { path: found, startedAt: recording.startedAt, bytes: 0, at: recording.startedAt } : null;
      if (!this.file) return;
    }
    let size: number;
    try {
      size = (await stat(this.file.path)).size;
    } catch {
      this.file = null;
      return;
    }
    const at = Date.now();
    const seconds = (at - this.file.at) / 1000;
    if (seconds > 0 && size >= this.file.bytes) this.values.recordingKbps = Math.round(((size - this.file.bytes) * 8) / 1000 / seconds);
    this.file.bytes = size;
    this.file.at = at;
  }
}

async function newestRecording(folder: string, since: number): Promise<string | null> {
  const extensions = new Set<string>(RECORDING_FORMATS.map((format) => `.${format}`));
  let best: { file: string; time: number } | null = null;
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
    const file = path.join(folder, entry.name);
    const time = (await stat(file)).mtimeMs;
    if (time >= since && (!best || time > best.time)) best = { file, time };
  }
  return best?.file ?? null;
}
