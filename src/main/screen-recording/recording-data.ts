import { app } from 'electron';
import { createHash } from 'node:crypto';
import { mkdirSync, promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Data kept for each screen recording (pointer path, editor changes) lives in
// the app's own folder, never next to the video, so the user's folders only hold
// the videos themselves. Each recording gets a folder named after its path.

const SOURCE_FILE = 'source.json';
const INTERACTIONS_FILE = 'interactions.json';
const PROJECT_FILE = 'edits.json';

function rootDirectory(): string {
  return join(app.getPath('userData'), 'recording-data');
}

function normalize(videoPath: string): string {
  const absolute = resolve(videoPath);
  // macOS and Windows treat file names case-insensitively by default.
  return process.platform === 'linux' ? absolute : absolute.toLowerCase();
}

export function recordingDataDirectory(videoPath: string): string {
  return join(rootDirectory(), createHash('sha256').update(normalize(videoPath)).digest('hex').slice(0, 32));
}

export function interactionLogPath(videoPath: string): string {
  return join(recordingDataDirectory(videoPath), INTERACTIONS_FILE);
}

export function editorProjectPath(videoPath: string): string {
  return join(recordingDataDirectory(videoPath), PROJECT_FILE);
}

// Creates the recording's folder and remembers which video it belongs to.
export async function prepareRecordingData(videoPath: string): Promise<void> {
  const directory = recordingDataDirectory(videoPath);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(join(directory, SOURCE_FILE), JSON.stringify({ video: resolve(videoPath) }));
}

export function ensureRecordingDataSync(videoPath: string): void {
  mkdirSync(recordingDataDirectory(videoPath), { recursive: true });
}

export async function removeRecordingData(videoPath: string): Promise<void> {
  await fs.rm(recordingDataDirectory(videoPath), { recursive: true, force: true });
}

// Every saved edit, for finding which background images are still used.
export async function editorProjectPaths(): Promise<string[]> {
  const names = await fs.readdir(rootDirectory()).catch(() => [] as string[]);
  return names.map((name) => join(rootDirectory(), name, PROJECT_FILE));
}

// Removes the data of recordings whose video no longer exists. Returns how many were removed.
export async function pruneRecordingData(): Promise<number> {
  const names = await fs.readdir(rootDirectory()).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    const directory = join(rootDirectory(), name);
    let video: unknown;
    try {
      video = (JSON.parse(await fs.readFile(join(directory, SOURCE_FILE), 'utf8')) as { video?: unknown }).video;
    } catch {
      video = null;
    }
    if (typeof video !== 'string') continue;
    // Only a video gone from a folder that is still there counts as deleted;
    // a disconnected drive keeps its recordings' data.
    const [videoStat, folderStat] = await Promise.all([fs.stat(video).catch(() => null), fs.stat(dirname(video)).catch(() => null)]);
    if (videoStat === null && folderStat !== null) {
      await fs.rm(directory, { recursive: true, force: true }).then(() => { removed += 1; }, () => undefined);
    }
  }
  return removed;
}
