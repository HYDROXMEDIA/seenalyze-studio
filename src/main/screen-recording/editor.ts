import { writeAtomic, writeAtomicSync, readRecoverableJson } from './atomic-file';
import { t } from './i18n';
import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureRecordingDataSync, interactionLogPath, prepareRecordingData, removeRecordingData, editorProjectPath, editorProjectPaths } from './recording-data';
import { cameraPath } from './recording';
import { JsMuxer, type ExportAudioCodec } from './js-muxer';
import { forgetMedia, mediaUrl } from './media-protocol';
import { loadPage, preloadPath } from './pages';

export type EditorDependencies = {
  log: (line: string) => void;
  theme: () => 'light' | 'dark';
  openAfterRecording: () => boolean;
  setOpenAfterRecording: (value: boolean) => void;
  onExported: () => void;
  transcribe: (path: string, id: string, progress: (value: number) => void) => Promise<unknown>;
  cancelTranscription: (id: string) => void;
  // Native helper that writes exported videos; null where the built-in writer is used instead.
  muxerPath: () => string | null;
};

type ExportJob = {
  // The video is written to a temporary file next to `target` and only moved
  // there once it is complete, so a failed export never replaces anything.
  filePath: string;
  target: string;
  // Set while the window finishes the export, so a failure is reported once.
  finishing: boolean;
  // Exactly one writer: the macOS helper process, or the built-in writer.
  child: ChildProcess | null;
  js: JsMuxer | null;
  // Resolves with true once the helper reports a complete file.
  finished: Promise<boolean>;
  failed: boolean;
};

type EditorEntry = {
  videoPath: string;
  window: BrowserWindow;
  job: ExportJob | null;
  // True while the save dialog for a new export is open.
  beginning: boolean;
  // Counts saves, so an older save that finishes late never replaces a newer one.
  saves: number;
  lastExport: string | null;
  discarding: boolean;
  pendingSave: Promise<unknown>;
  transcriptionId?: string;
};

// Largest project file accepted from the editor window.
const MAX_PROJECT_BYTES = 1024 * 1024;
// Largest single read of the recording, and largest single export message.
const MAX_READ_BYTES = 64 * 1024 * 1024;
const MAX_EXPORT_MESSAGE = 64 * 1024 * 1024;
const MAX_EXPORT_SIDE = 4096;
const MAX_BACKGROUND_BYTES = 25 * 1024 * 1024;
const BACKGROUND_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const PRUNE_GRACE_MS = 10 * 60 * 1000;
const BACKGROUND_ID = /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/;

// Background images are copied here so edits keep working if the original moves.
function backgroundDirectory(): string {
  return join(app.getPath('userData'), 'recording-backgrounds');
}

function backgroundUrl(id: unknown): string | null {
  if (typeof id !== 'string' || !BACKGROUND_ID.test(id)) return null;
  return mediaUrl(join(backgroundDirectory(), id));
}

function projectImageId(project: unknown): string | null {
  const saved = project as { look?: { backgroundImage?: unknown }; settings?: { backgroundImage?: unknown } } | null;
  const id = saved?.look?.backgroundImage ?? saved?.settings?.backgroundImage;
  return typeof id === 'string' && BACKGROUND_ID.test(id) ? id : null;
}

function toBytes(value: unknown): Buffer | null {
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return null;
}

// One message to the export helper: type, length, then the payload.
function frame(type: 'C' | 'V' | 'A' | 'E', payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0, 'latin1');
  header.writeUInt32LE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

async function removeBackground(id: string): Promise<void> {
  const presets = await readJson(join(app.getPath('userData'), 'recording-presets.json'));
  if (Array.isArray(presets) && presets.some(preset => projectImageId(preset) === id)) return;
  await fs.rm(join(backgroundDirectory(), id), { force: true });
}

async function readJson(path: string): Promise<unknown> {
  try {
    return (await readRecoverableJson(path)).value;
  } catch {
    return null;
  }
}

// Editor windows for editing finished screen recordings, one per video. The
// original video is never changed: edits are kept in a small project file next
// to it and applied when exporting a new video.
export class EditorWindows {
  private readonly entries = new Map<string, EditorEntry>();
  private readonly opening = new Map<string, Promise<boolean>>();

  constructor(private readonly deps: EditorDependencies) {}

  // Opens (or brings forward) the editor for a recording. Two quick opens of
  // the same file share one window.
  async open(requestedPath: string): Promise<boolean> {
    const videoPath = await fs.realpath(requestedPath).catch(() => null);
    if (videoPath === null) return false;
    const existing = this.entries.get(videoPath);
    if (existing !== undefined && !existing.window.isDestroyed()) {
      this.present(existing.window);
      return true;
    }
    const pending = this.opening.get(videoPath);
    if (pending !== undefined) return pending;
    const opened = this.create(videoPath).finally(() => this.opening.delete(videoPath));
    this.opening.set(videoPath, opened);
    return opened;
  }

  private async create(videoPath: string): Promise<boolean> {
    const stat = await fs.stat(videoPath).catch(() => null);
    if (stat === null || !stat.isFile()) return false;
    await prepareRecordingData(videoPath).catch((error: unknown) => {
      this.deps.log(`Recording data could not be prepared: ${error instanceof Error ? error.message : String(error)}`);
    });

    const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(1440, Math.max(900, Math.round(workArea.width * 0.8)));
    const height = Math.min(960, Math.max(620, Math.round(workArea.height * 0.84)));
    const window = new BrowserWindow({
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
      width,
      height,
      minWidth: 820,
      minHeight: 560,
      show: false,
      title: t('dialogs.editRecording'),
      // macOS keeps its inset traffic lights; Windows draws its caption buttons over the toolbar.
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 17 } }
        : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: this.deps.theme() === 'dark' ? '#000000' : '#ffffff',
            symbolColor: this.deps.theme() === 'dark' ? '#ffffff' : '#000000',
            height: 52
          }
        }),
      backgroundColor: this.deps.theme() === 'dark' ? '#000000' : '#ffffff',
      webPreferences: {
        preload: preloadPath('editor'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Exports keep running while the window is in the background.
        backgroundThrottling: false
      }
    });

    const entry: EditorEntry = { videoPath, window, job: null, beginning: false, saves: 0, lastExport: null, discarding: false, pendingSave: Promise.resolve() };
    this.entries.set(videoPath, entry);
    window.on('closed', () => {
      void this.cancelJob(entry);
      if (entry.transcriptionId) this.deps.cancelTranscription(entry.transcriptionId);
      if (this.entries.get(videoPath) === entry) this.entries.delete(videoPath);
    });
    window.once('ready-to-show', () => this.present(window));
    void loadPage(window, 'editor');
    this.deps.log('Recording editor opened');
    return true;
  }

  // Deletes stored background images that no saved edit uses anymore, for
  // example after its recording was deleted or a window closed before saving.
  async pruneBackgrounds(): Promise<void> {
    const stored = await fs.readdir(backgroundDirectory()).catch(() => [] as string[]);
    if (stored.length === 0) return;
    const used = new Set<string>();
    for (const path of await editorProjectPaths()) {
      const id = projectImageId(await readJson(path));
      if (id !== null) used.add(id);
    }
    let removed = 0;
    for (const name of stored) {
      if (!BACKGROUND_ID.test(name) || used.has(name)) continue;
      // Leave images added moments ago; their edit may not be saved yet.
      const stat = await fs.stat(join(backgroundDirectory(), name)).catch(() => null);
      if (stat === null || Date.now() - stat.mtimeMs < PRUNE_GRACE_MS) continue;
      await removeBackground(name).then(() => { removed += 1; }, () => undefined);
    }
    if (removed > 0) this.deps.log(`Removed ${removed} unused editor background image(s)`);
  }

  get hasOpenWindows(): boolean { return this.entries.size > 0; }

  closeAll(): void {
    for (const entry of this.entries.values()) {
      if (!entry.window.isDestroyed()) entry.window.close();
    }
  }

  // Stops running exports and removes their unfinished files before quitting.
  async shutdown(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => this.cancelJob(entry)));
  }

  // Files an export must never replace: the recording and everything kept
  // with it, and recordings open in other editor windows.
  private async isProtected(path: string): Promise<boolean> {
    // The file may not exist yet, so its folder is resolved instead.
    const folder = await fs.realpath(dirname(path)).catch(() => dirname(path));
    const real = join(folder, basename(path)).toLowerCase();
    const protectedPaths = [...this.entries.keys()].flatMap((video) => [video, cameraPath(video)]);
    return protectedPaths.some((entry) => entry.toLowerCase() === real);
  }

  private present(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore();
    window.show();
    app.focus({ steal: true });
    window.focus();
  }

  private entryFor(event: IpcMainEvent | IpcMainInvokeEvent): EditorEntry | null {
    for (const entry of this.entries.values()) {
      if (!entry.discarding && !entry.window.isDestroyed() && entry.window.webContents === event.sender) return entry;
    }
    return null;
  }

  private async cancelJob(entry: EditorEntry): Promise<void> {
    const job = entry.job;
    if (job === null) return;
    entry.job = null;
    job.child?.kill();
    job.js?.kill();
    await job.finished.catch(() => false);
    await fs.rm(job.filePath, { force: true }).catch(() => undefined);
  }

  private exportFailed(entry: EditorEntry, job: ExportJob, reason: string): void {
    if (job.finishing || entry.job !== job) return;
    // The helper stopped early: clean up and tell the window so it stops sending.
    entry.job = null;
    job.failed = true;
    this.deps.log(`Editor export failed: ${reason}`);
    void fs.rm(job.filePath, { force: true }).catch(() => undefined);
    if (!entry.window.isDestroyed()) entry.window.webContents.send('editor:export-failed');
  }

  // Writes one message to the export helper, waiting while its input is full.
  private async send(entry: EditorEntry | null, type: 'C' | 'V' | 'A' | 'E', payload: Buffer): Promise<boolean> {
    const job = entry?.job;
    if (job?.js) return job.failed ? false : this.sendToJs(job.js, type, payload);
    const input = job?.child?.stdin;
    if (job === null || job === undefined || input === null || input === undefined || job.failed || !input.writable) return false;
    return new Promise<boolean>((resolve) => {
      input.write(frame(type, payload), (error) => resolve(error === null || error === undefined));
    });
  }

  private sendToJs(muxer: JsMuxer, type: 'C' | 'V' | 'A' | 'E', payload: Buffer): boolean {
    if (type === 'C') return muxer.setVideoConfig(new Uint8Array(payload));
    if (type === 'V') {
      if (payload.length < 17) return false;
      const timestamp = Number(payload.readBigInt64LE(0));
      const duration = Number(payload.readBigInt64LE(8));
      return muxer.addVideo(new Uint8Array(payload.subarray(17)), payload[16] === 1, timestamp, duration);
    }
    // Raw samples are for the macOS helper only; the built-in writer takes encoded audio.
    if (type === 'A') return false;
    return true;
  }

  registerIpc(): void {
    ipcMain.handle('editor:init', async (event) => {
      const entry = this.entryFor(event);
      if (entry === null) return null;
      const stat = await fs.stat(entry.videoPath).catch(() => null);
      const cameraStat = await fs.stat(cameraPath(entry.videoPath)).catch(() => null);
      const saved = await readRecoverableJson(editorProjectPath(entry.videoPath));
      const presets = await readJson(join(app.getPath('userData'), 'recording-presets.json'));
      const defaultPreset = Array.isArray(presets) ? presets.find(x => x?.isDefault) : null;
      const project = saved.value ?? (defaultPreset ? { version: 2, look: defaultPreset.look } : null);
      const imageId = projectImageId(project);
      const imageExists = imageId !== null && (await fs.stat(join(backgroundDirectory(), imageId)).catch(() => null)) !== null;
      return {
        name: basename(entry.videoPath, extname(entry.videoPath)),
        videoUrl: mediaUrl(entry.videoPath, Math.round(stat?.mtimeMs ?? 0)),
        fileSize: stat?.size ?? 0,
        cameraUrl: cameraStat?.isFile() ? mediaUrl(cameraPath(entry.videoPath), Math.round(cameraStat.mtimeMs)) : null,
        cameraFileSize: cameraStat?.isFile() ? cameraStat.size : 0,
        interactions: await readJson(interactionLogPath(entry.videoPath)),
        project,
        projectRecovered: saved.recovered,
        exportChoice: defaultPreset?.exportChoice,
        backgroundUrl: imageExists ? backgroundUrl(imageId) : null,
        openAfterRecording: this.deps.openAfterRecording(),
        theme: this.deps.theme()
      };
    });

    const presetsPath = () => join(app.getPath('userData'), 'recording-presets.json');
    ipcMain.handle('editor:presets', async event => this.entryFor(event) ? (await readJson(presetsPath())) ?? [] : []);
    ipcMain.handle('editor:preset-save', async (event, preset: unknown) => {
      if (!this.entryFor(event) || !preset || typeof preset !== 'object') return false;
      const value = preset as { id?: unknown; name?: unknown; look?: unknown; exportChoice?: unknown; isDefault?: unknown };
      if (typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || JSON.stringify(value).length > MAX_PROJECT_BYTES) return false;
      const existing = await readJson(presetsPath()); const list = Array.isArray(existing) ? existing.slice(0, 99) : [];
      const next = list.filter(x => x.id !== value.id).map(x => ({ ...x, isDefault: value.isDefault === true ? false : x.isDefault }));
      next.push({ ...value, name: value.name.trim().slice(0, 120), isDefault: value.isDefault === true });
      await writeAtomic(presetsPath(), JSON.stringify(next), true); return true;
    });
    ipcMain.handle('editor:preset-delete', async (event, id) => {
      if (!this.entryFor(event) || typeof id !== 'string') return false;
      const existing = await readJson(presetsPath());
      await writeAtomic(presetsPath(), JSON.stringify(Array.isArray(existing) ? existing.filter(x => x.id !== id) : []), true); return true;
    });
    ipcMain.handle('editor:background-url', (event, id) => this.entryFor(event) && typeof id === 'string' && BACKGROUND_ID.test(id) ? backgroundUrl(id) : null);
    ipcMain.handle('editor:transcribe', async (event, id) => {
      const entry = this.entryFor(event); if (!entry || entry.transcriptionId || typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return null;
      entry.transcriptionId = id;
      try { return await this.deps.transcribe(entry.videoPath, id, progress => { if (!entry.window.isDestroyed()) entry.window.webContents.send('editor:transcription-progress', progress); }); }
      finally { entry.transcriptionId = undefined; }
    });
    ipcMain.handle('editor:transcription-cancel', (event, id) => { const entry = this.entryFor(event); if (entry?.transcriptionId === id) this.deps.cancelTranscription(id); });
    ipcMain.handle('editor:subtitles-export', async (event, text, format) => {
      const entry = this.entryFor(event); if (!entry || typeof text !== 'string' || text.length > 8_000_000 || !['srt', 'vtt'].includes(format)) return false;
      const result = await dialog.showSaveDialog(entry.window, { defaultPath: `${basename(entry.videoPath, extname(entry.videoPath))}.${format}`, filters: [{ name: 'Subtitles', extensions: [format] }] });
      if (result.canceled || !result.filePath) return false; await writeAtomic(result.filePath, text); return true;
    });
    ipcMain.handle('editor:discard' , async (event) => {
      const entry = this.entryFor(event);
      if (entry === null || entry.discarding || entry.job !== null || entry.beginning) return { ok: false };
      entry.discarding = true;
      try {
        const choice = await dialog.showMessageBox(entry.window, {
          type: 'warning',
          message: t('dialogs.discardRecording'),
          detail: t('dialogs.discardRecordingDetail'),
          buttons: [t('dialogs.discard'), t('dialogs.cancel')],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        });
        if (choice.response !== 0 || entry.window.isDestroyed()) return { ok: false, canceled: true };
        await entry.pendingSave;
        await shell.trashItem(entry.videoPath);
        if (await fs.stat(cameraPath(entry.videoPath)).catch(() => null)) await shell.trashItem(cameraPath(entry.videoPath));
        await removeRecordingData(entry.videoPath);
        forgetMedia(entry.videoPath);
        forgetMedia(cameraPath(entry.videoPath));
        // Destroy skips the renderer's save-on-close after deleting the project.
        entry.window.destroy();
        this.deps.onExported();
        void this.pruneBackgrounds();
        return { ok: true };
      } catch (error) {
        this.deps.log(`Recording could not be discarded: ${error instanceof Error ? error.message : String(error)}`);
        return { ok: false };
      } finally {
        entry.discarding = false;
      }
    });

    ipcMain.handle('editor:save-project', (event, data: unknown) => {
      const entry = this.entryFor(event);
      if (entry === null || entry.discarding || typeof data !== 'string' || data.length > MAX_PROJECT_BYTES) return false;
      const save = ++entry.saves;
      const operation = entry.pendingSave.then(async () => {
        try {
          const next = JSON.parse(data) as unknown;
          const before = projectImageId(await readJson(editorProjectPath(entry.videoPath)));
          if (save !== entry.saves) return true;
          await prepareRecordingData(entry.videoPath);
          await writeAtomic(editorProjectPath(entry.videoPath), data, true, () => save === entry.saves);
          if (before !== null && before !== projectImageId(next)) await removeBackground(before).catch(() => undefined);
          return true;
        } catch (error) {
          this.deps.log(`Recording edits could not be saved: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      });
      entry.pendingSave = operation;
      return operation;
    });

    ipcMain.on('editor:save-project-now', (event, data: unknown) => {
      const entry = this.entryFor(event);
      event.returnValue = false;
      if (entry === null || entry.discarding || typeof data !== 'string' || data.length > MAX_PROJECT_BYTES) return;
      try {
        entry.saves += 1;
        const next = JSON.parse(data) as unknown;
        const path = editorProjectPath(entry.videoPath);
        let before: string | null = null;
        try {
          before = projectImageId(JSON.parse(readFileSync(path, 'utf8')));
        } catch {
          before = null;
        }
        ensureRecordingDataSync(entry.videoPath);
        writeAtomicSync(path, data, true);
        event.returnValue = true;
        if (before !== null && before !== projectImageId(next)) void removeBackground(before).catch(() => undefined);
      } catch (error) {
        this.deps.log(`Recording edits could not be saved: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    ipcMain.handle('editor:pick-background', async (event) => {
      const entry = this.entryFor(event);
      if (entry === null) return { ok: false };
      const result = await dialog.showOpenDialog(entry.window, {
        title: t('dialogs.chooseBackground'),
        properties: ['openFile'],
        filters: [{ name: t('dialogs.image'), extensions: BACKGROUND_EXTENSIONS }]
      });
      const source = result.filePaths[0];
      if (result.canceled || source === undefined) return { ok: false, canceled: true };
      const extension = extname(source).slice(1).toLowerCase();
      const stat = await fs.stat(source).catch(() => null);
      // The name alone is not trusted: the file must also decode as an image.
      if (!BACKGROUND_EXTENSIONS.includes(extension) || stat === null || !stat.isFile() || stat.size > MAX_BACKGROUND_BYTES
        || nativeImage.createFromPath(source).isEmpty()) {
        return { ok: false, invalid: true };
      }
      try {
        const id = `${randomUUID()}.${extension}`;
        await fs.mkdir(backgroundDirectory(), { recursive: true });
        const target = join(backgroundDirectory(), id);
        await fs.copyFile(source, target);
        // Copies keep the original's date; mark when it was added instead.
        const now = new Date();
        await fs.utimes(target, now, now);
        // The image it replaces is removed once the edit without it is saved.
        return { ok: true, id, url: backgroundUrl(id) };
      } catch (error) {
        this.deps.log(`Background image could not be added: ${error instanceof Error ? error.message : String(error)}`);
        return { ok: false };
      }
    });

    ipcMain.handle('editor:remove-background', async (event, id: unknown) => {
      const entry = this.entryFor(event);
      if (entry === null || typeof id !== 'string' || !BACKGROUND_ID.test(id)) return false;
      const choice = await dialog.showMessageBox(entry.window, {
        type: 'warning',
        message: t('dialogs.removeBackground'),
        detail: t('dialogs.removeBackgroundDetail'),
        buttons: [t('dialogs.remove'), t('dialogs.cancel')],
        defaultId: 1,
        cancelId: 1
      });
      if (choice.response !== 0) return false;
      try {
        await removeBackground(id);
        return true;
      } catch (error) {
        this.deps.log(`Background image could not be removed: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    });

    ipcMain.on('editor:set-open-after-recording', (event, value: unknown) => {
      if (this.entryFor(event) === null || typeof value !== 'boolean') return;
      this.deps.setOpenAfterRecording(value);
      // Every open editor shows the same choice.
      for (const entry of this.entries.values()) {
        if (!entry.window.isDestroyed() && entry.window.webContents !== event.sender) entry.window.webContents.send('editor:open-after-recording', value);
      }
    });

    // Reads part of the recording being edited (or its camera track), for frame-exact exports.
    ipcMain.handle('editor:read-range', async (event, offset: unknown, length: unknown, source: unknown) => {
      const entry = this.entryFor(event);
      if (entry === null || (source !== 'video' && source !== 'camera') || typeof offset !== 'number' || typeof length !== 'number' || !Number.isSafeInteger(offset)
        || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > MAX_READ_BYTES) return null;
      const handle = await fs.open(source === 'camera' ? cameraPath(entry.videoPath) : entry.videoPath, 'r').catch(() => null);
      if (handle === null) return null;
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
      } finally {
        await handle.close();
      }
    });

    ipcMain.handle('editor:export-begin', async (event, options: unknown) => {
      const entry = this.entryFor(event);
      const muxer = this.deps.muxerPath();
      const builtIn = muxer === null && process.platform !== 'darwin';
      if (entry === null || entry.job !== null || entry.beginning || (muxer === null && !builtIn) || options === null || typeof options !== 'object') return { ok: false };
      const { width, height, fps, audio } = options as { width?: unknown; height?: unknown; fps?: unknown; audio?: unknown };
      const size = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= MAX_EXPORT_SIDE && value % 2 === 0;
      if (!size(width) || !size(height) || (fps !== 30 && fps !== 60)) return { ok: false };
      let sound: { sampleRate: number; channels: number; codec: ExportAudioCodec | null } | null = null;
      if (audio !== null && typeof audio === 'object') {
        const { sampleRate, channels, codec } = audio as { sampleRate?: unknown; channels?: unknown; codec?: unknown };
        if (typeof sampleRate !== 'number' || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000
          || (channels !== 1 && channels !== 2)) return { ok: false };
        sound = { sampleRate, channels, codec: codec === 'aac' || codec === 'opus' ? codec : null };
      }
      // The built-in writer needs audio the window can encode; without an encoder the video is silent.
      const jsAudio = builtIn && sound !== null && sound.codec !== null ? { sampleRate: sound.sampleRate, channels: sound.channels, codec: sound.codec } : null;

      const name = basename(entry.videoPath, extname(entry.videoPath)).replace(/ \(Edited\)$/, '');
      entry.beginning = true;
      let result: Electron.SaveDialogReturnValue;
      try {
        result = await dialog.showSaveDialog(entry.window, {
          title: t('dialogs.exportRecording'),
          defaultPath: join(dirname(entry.videoPath), `${name} (Edited).mp4`),
          filters: [{ name: t('dialogs.video'), extensions: ['mp4'] }]
        });
      } finally {
        entry.beginning = false;
      }
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      // The window may have closed while the dialog was open.
      if (entry.window.isDestroyed() || this.entries.get(entry.videoPath) !== entry || entry.job !== null) return { ok: false };
      if (await this.isProtected(result.filePath)) return { ok: false, protected: true };

      const target = result.filePath;
      const temporary = join(dirname(target), `.${basename(target, extname(target))}.${randomUUID().slice(0, 8)}.exporting.mp4`);
      if (builtIn) {
        let js: JsMuxer;
        try {
          js = new JsMuxer({ output: temporary, width: width as number, height: height as number, fps, audio: jsAudio });
        } catch (error) {
          this.deps.log(`Editor export could not start: ${error instanceof Error ? error.message : String(error)}`);
          return { ok: false };
        }
        const job: ExportJob = { filePath: temporary, target, finishing: false, child: null, js, failed: false, finished: js.finished };
        void job.finished.then((ok) => {
          if (!ok) this.exportFailed(entry, job, js.error || 'unknown reason');
        });
        entry.job = job;
        return { ok: true, audio: jsAudio === null ? 'none' : 'encoded' };
      }

      const args = ['--output', temporary, '--width', String(width), '--height', String(height), '--fps', String(fps)];
      if (sound !== null) args.push('--sample-rate', String(sound.sampleRate), '--channels', String(sound.channels));
      const child = spawn(muxer as string, args, { stdio: ['pipe', 'pipe', 'ignore'] });
      let output = '';
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        output = (output + chunk).slice(-4096);
      });
      child.stdin?.on('error', () => undefined);
      const job: ExportJob = {
        filePath: temporary,
        target,
        finishing: false,
        child,
        js: null,
        failed: false,
        finished: new Promise<boolean>((resolve) => {
          child.on('error', () => resolve(false));
          // 'close' comes after all output was read, so "finished" is never missed.
          child.on('close', (code) => resolve(code === 0 && output.includes('"finished"')));
        })
      };
      void job.finished.then((ok) => {
        if (!ok) this.exportFailed(entry, job, output.trim().split('\n').pop() ?? 'unknown reason');
      });
      entry.job = job;
      return { ok: true, audio: sound === null ? 'none' : 'pcm' };
    });

    // Encoded audio for the built-in writer: the decoder description first, then the packets.
    ipcMain.handle('editor:export-audio-config', (event, data: unknown) => {
      const job = this.entryFor(event)?.job;
      const js = job?.js;
      if (!js || job?.failed) return false;
      const bytes = data === null ? null : toBytes(data);
      if (data !== null && (bytes === null || bytes.length > 4096)) return false;
      return js.setAudioConfig(bytes === null ? null : new Uint8Array(bytes));
    });

    ipcMain.handle('editor:export-audio-chunk', (event, header: unknown, data: unknown) => {
      const job = this.entryFor(event)?.job;
      const bytes = toBytes(data);
      if (!job?.js || job.failed || bytes === null || bytes.length > MAX_EXPORT_MESSAGE || header === null || typeof header !== 'object') return false;
      const { timestamp, duration } = header as { timestamp?: unknown; duration?: unknown };
      if (typeof timestamp !== 'number' || typeof duration !== 'number' || !Number.isSafeInteger(timestamp) || !Number.isSafeInteger(duration)) return false;
      return job.js.addAudio(new Uint8Array(bytes), timestamp, duration);
    });

    ipcMain.handle('editor:export-config', (event, data: unknown) => {
      const bytes = toBytes(data);
      if (bytes === null || bytes.length > 4096) return false;
      return this.send(this.entryFor(event), 'C', bytes);
    });

    ipcMain.handle('editor:export-video', (event, header: unknown, data: unknown) => {
      const bytes = toBytes(data);
      if (bytes === null || bytes.length > MAX_EXPORT_MESSAGE || header === null || typeof header !== 'object') return false;
      const { timestamp, duration, key } = header as { timestamp?: unknown; duration?: unknown; key?: unknown };
      if (typeof timestamp !== 'number' || typeof duration !== 'number' || !Number.isSafeInteger(timestamp) || !Number.isSafeInteger(duration)) return false;
      const head = Buffer.alloc(17);
      head.writeBigInt64LE(BigInt(timestamp), 0);
      head.writeBigInt64LE(BigInt(duration), 8);
      head[16] = key === true ? 1 : 0;
      return this.send(this.entryFor(event), 'V', Buffer.concat([head, bytes]));
    });

    ipcMain.handle('editor:export-audio', (event, data: unknown) => {
      const bytes = toBytes(data);
      if (bytes === null || bytes.length > MAX_EXPORT_MESSAGE || bytes.length % 4 !== 0) return false;
      return this.send(this.entryFor(event), 'A', bytes);
    });

    ipcMain.handle('editor:export-done', async (event) => {
      const entry = this.entryFor(event);
      const job = entry?.job;
      if (entry === null || job === null || job === undefined) return { ok: false };
      job.finishing = true;
      await this.send(entry, 'E', Buffer.alloc(0));
      job.child?.stdin?.end();
      job.js?.finish();
      let ok = await job.finished;
      if (entry.job === job) entry.job = null;
      if (ok) {
        // Edits and pointer data of a video this replaces belong to that old video.
        await removeRecordingData(job.target).catch(() => undefined);
        await fs.rm(cameraPath(job.target), { force: true }).catch(() => undefined);
        ok = await fs.rename(job.filePath, job.target).then(() => true, (error: unknown) => {
          this.deps.log(`Exported video could not be moved into place: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        });
      }
      if (!ok) {
        this.deps.log('Editor export could not be finished');
        await fs.rm(job.filePath, { force: true }).catch(() => undefined);
        return { ok: false };
      }
      entry.lastExport = job.target;
      this.deps.log('Editor export saved');
      this.deps.onExported();
      return { ok: true };
    });

    ipcMain.handle('editor:export-cancel', async (event) => {
      const entry = this.entryFor(event);
      if (entry !== null) await this.cancelJob(entry);
    });

    // Shows the video this window exported last.
    ipcMain.handle('editor:reveal-export', (event) => {
      const path = this.entryFor(event)?.lastExport;
      if (!path) return false;
      shell.showItemInFolder(path);
      return true;
    });

    ipcMain.on('editor:close', (event) => {
      this.entryFor(event)?.window.close();
    });
  }
}
