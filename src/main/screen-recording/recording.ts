import { app, BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { constants as fsConstants, createWriteStream, promises as fs, type WriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { InteractionRecorder } from './interactions';
import { NativeCapture } from './native-recording';
import type { FacecamHint } from './facecam';
import { recordingMicrophone } from './audio-input';
import { loadPage, preloadPath } from './pages';

export type RecordingFormat = 'mp4' | 'webm';
export type RecordingResolution = 'native' | '2160' | '1440' | '1080' | '720';

export type RecordingRequest = {
  mode: 'area' | 'window' | 'screen';
  // Global rectangle in points. For windows it is the window frame.
  rect: { x: number; y: number; width: number; height: number };
  windowId: number | null;
  format: RecordingFormat;
  resolution: RecordingResolution;
  fps: number;
  // Microphone device id ('default' for the system choice), or null for none.
  micId: string | null;
  // Name of the chosen microphone, used by the native recorder; null for the default.
  micLabel: string | null;
  // Camera to record next to the screen: 'default', a camera name, or null for none.
  camera: string | null;
  systemAudio?: boolean;
  systemAudioPid?: number | null;
};

// The camera track of a recording, kept next to the video.
export function cameraPath(videoPath: string): string {
  return videoPath.replace(/\.[^./]+$/, '') + '.camera.mp4';
}

export type RecordingDependencies = {
  log: (line: string) => void;
  onSaved: (filePath: string) => Promise<void>;
  onStateChange: (recording: boolean) => void;
  onPauseChange: (paused: boolean) => void;
  // Folder new recordings are saved in.
  outputDirectory: () => string;
  // Native recorder that leaves the pointer out of the video; null when unavailable.
  nativeRecorderPath: () => string | null;
  // The live camera bubble shown while recording with a camera.
  facecam: {
    hint: (area: { x: number; y: number; width: number; height: number }) => FacecamHint | null;
    open: (camera: string, area: { x: number; y: number; width: number; height: number }) => void;
    close: (area?: { x: number; y: number; width: number; height: number }) => FacecamHint | null;
  };
};

type NativeSession = {
  capture: NativeCapture;
  filePath: string;
  interactions: InteractionRecorder;
  // Recorded area in global points.
  area: { x: number; y: number; width: number; height: number };
  // Set when the camera video could not be written; it is then removed.
  cameraFailed: boolean;
  started: boolean;
  paused: boolean;
  stopping: boolean;
  ended: boolean;
  completion: Promise<void>;
  complete: () => void;
  finishStart: () => void;
};

const RESOLUTION_HEIGHT: Record<RecordingResolution, number> = { native: Infinity, 2160: 2160, 1440: 1440, 1080: 1080, 720: 720 };
// How long the native recorder may take to deliver its first frame.
const NATIVE_START_TIMEOUT_MS = 10000;
const SHUTDOWN_TIMEOUT_MS = 8000;

function completion(): { completion: Promise<void>; complete: () => void } {
  let complete!: () => void;
  return { completion: new Promise<void>((resolve) => { complete = resolve; }), complete };
}

// Largest even pixel size for the chosen resolution, keeping the aspect ratio.
function pixelSize(width: number, height: number, scaleFactor: number, resolution: RecordingResolution): { width: number; height: number } {
  const scale = Math.min(scaleFactor, RESOLUTION_HEIGHT[resolution] / height);
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

type RecordingSession = {
  request: RecordingRequest;
  sourceId: string;
  displayBounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  window: BrowserWindow;
  filePath: string | null;
  stream: WriteStream | null;
  writing: Promise<void>;
  finished: boolean;
  ended: boolean;
  paused: boolean;
  interactions: InteractionRecorder;
  completion: Promise<void>;
  complete: () => void;
};

const CONTROL_WIDTH = 320;
const CONTROL_HEIGHT = 200;

function fileStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' at ').replace(/:/g, '.');
}

// Records a screen, window, or area to a video file. A hidden window runs the
// capture; pause and stop come from the floating recording controls.
export class RecordingController {
  private session: RecordingSession | null = null;
  private native: NativeSession | null = null;
  private starting: Promise<boolean> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private startVersion = 0;

  constructor(private readonly deps: RecordingDependencies) {}

  isRecording(): boolean {
    return this.session !== null || this.native !== null;
  }

  async start(request: RecordingRequest): Promise<boolean> {
    if (this.shuttingDown || this.isRecording() || this.starting !== null) {
      // The bubble shown while setting up belongs to this recording only.
      if (!this.isRecording() && this.starting === null) this.deps.facecam.close();
      return false;
    }
    const starting = this.startCapture(request);
    this.starting = starting;
    try {
      return await starting;
    } finally {
      if (this.starting === starting) this.starting = null;
    }
  }

  private async startCapture(request: RecordingRequest): Promise<boolean> {
    const version = this.startVersion;
    const helperPath = request.format === 'mp4' ? this.deps.nativeRecorderPath() : null;
    // Only the native recorder records the camera; otherwise the bubble goes away.
    if (request.camera === null || helperPath === null) this.deps.facecam.close();
    if (helperPath !== null) {
      if (await this.startNative(request, helperPath)) return true;
      if (this.shuttingDown || version !== this.startVersion) return false;
      this.deps.log('Native screen recorder unavailable; using the built-in recorder');
    }
    return this.startBrowser(request);
  }

  // Let the final video chunks and interaction data finish before app quit.
  // A broken renderer or helper must never leave quit waiting indefinitely.
  shutdown(): Promise<void> {
    if (this.shutdownPromise !== null) return this.shutdownPromise;
    this.shuttingDown = true;
    this.shutdownPromise = this.finishShutdown();
    return this.shutdownPromise;
  }

  private async finishShutdown(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const drain = (async () => {
      this.stop();
      await this.starting?.catch(() => undefined);
      this.stop();
      await Promise.all([this.session?.completion, this.native?.completion]);
      return true;
    })();
    try {
      const drained = await Promise.race([
        drain,
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), SHUTDOWN_TIMEOUT_MS); })
      ]);
      if (!drained) this.deps.log('Screen recording shutdown timed out; closing the recorder');
    } finally {
      clearTimeout(timer);
      const native = this.native;
      if (native !== null) {
        native.capture.kill();
        this.endNativeSession(native);
      }
      const session = this.session;
      if (session !== null) {
        session.finished = true;
        void session.writing.catch(() => undefined);
        session.stream?.destroy();
        session.interactions.stop();
        this.end(session);
      }
    }
  }

  private async outputPath(extension: string): Promise<string> {
    let directory = this.deps.outputDirectory();
    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.access(directory, fsConstants.W_OK);
    } catch {
      this.deps.log('Recording folder unavailable; saving to Movies');
      directory = app.getPath('videos');
      await fs.mkdir(directory, { recursive: true });
    }
    return join(directory, `Screen Recording ${fileStamp()} ${randomUUID().slice(0, 8)}.${extension}`);
  }

  // Records with ScreenCaptureKit so the pointer can be redrawn in the editor.
  private async startNative(request: RecordingRequest, helperPath: string): Promise<boolean> {
    const version = this.startVersion;
    const center = { x: request.rect.x + request.rect.width / 2, y: request.rect.y + request.rect.height / 2 };
    const display = screen.getDisplayNearestPoint(center);
    const size = pixelSize(request.rect.width, request.rect.height, display.scaleFactor, request.resolution);
    const filePath = await this.outputPath('mp4');
    if (this.shuttingDown) return false;
    let camera = request.camera ?? null;
    if (camera !== null && !(await systemPreferences.askForMediaAccess('camera').catch(() => false))) {
      this.deps.log('Camera access is off; recording without the camera');
      this.deps.facecam.close();
      camera = null;
    }
    if (this.shuttingDown) return false;
    const mic = await recordingMicrophone(request.micId === null ? null : request.micLabel || 'default');
    if (this.shuttingDown) return false;
    if (version !== this.startVersion) return false;
    const interactions = new InteractionRecorder(request.rect, this.deps.log, () => this.deps.facecam.hint(request.rect));
    interactions.setCursorHidden(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const capture = new NativeCapture({
        onStarted: () => {
          if (session.ended) return;
          session.started = true;
          interactions.begin(true);
          this.native = session;
          this.deps.onStateChange(true);
          this.deps.log(`Screen recording started without pointer (${request.mode}, ${size.width}x${size.height}, ${request.fps} fps)`);
          settle(true);
          if (this.shuttingDown) this.stop();
        },
        onCursor: (time, id, image) => interactions.addCursor(time, id, image),
        onInput: (input) => {
          if (input.kind === 'move') interactions.addMove(input.t, input.x, input.y);
          else if (input.kind === 'button') interactions.addButton(input.down, input.t, input.x, input.y, input.button);
          else if (input.kind === 'scroll') interactions.addScroll(input.t, input.x, input.y, input.dx, input.dy);
          else if (input.kind === 'typing') interactions.addTyping(input.t);
          else interactions.addShortcut(input.t, input.keys);
        },
        onCameraReady: (ok) => {
          if (!ok) {
            this.deps.log('Camera unavailable; recording without it');
            session.cameraFailed = true;
            // A late message must not close the bubble of a newer recording.
            if (this.native === session && !session.ended) this.deps.facecam.close();
          } else if (camera !== null && !session.ended) this.deps.facecam.open(camera, request.rect);
        },
        onInputAccess: (clicks) => {
          if (!clicks) this.deps.log('Clicks and keys are not visible to the recorder; only pointer movement is saved');
        },
        onEnded: (error) => void this.endNative(session, error, () => settle(false))
      });
      const session: NativeSession = {
        capture, filePath, interactions, area: request.rect, cameraFailed: false, started: false, paused: false, stopping: false, ended: false,
        ...completion(), finishStart: () => settle(false)
      };
      this.native = session;
      const timer = setTimeout(() => {
        if (!session.started) capture.kill();
      }, NATIVE_START_TIMEOUT_MS);
      const crop = request.mode === 'area'
        ? { x: request.rect.x - display.bounds.x, y: request.rect.y - display.bounds.y, width: request.rect.width, height: request.rect.height }
        : null;
      capture.start({
        helperPath,
        outputPath: filePath,
        fps: request.fps,
        width: size.width,
        height: size.height,
        rect: request.rect,
        displayId: request.mode === 'window' ? null : display.id,
        crop,
        windowId: request.mode === 'window' ? request.windowId : null,
        mic,
        camera: camera === null ? null : { name: camera, outputPath: cameraPath(filePath) },
        systemAudio: request.systemAudio === true, systemAudioPid: request.systemAudioPid ?? null,
        excludePid: process.pid
      });
    });
  }

  private async endNative(session: NativeSession, error: string | null, notStarted: () => void): Promise<void> {
    if (session.ended) return;
    session.stopping = true;
    session.interactions.stop();
    if (!session.started) {
      this.deps.log(`Native screen recorder could not start: ${error ?? 'unknown reason'}`);
      await fs.rm(session.filePath, { force: true }).catch(() => undefined);
      await fs.rm(cameraPath(session.filePath), { force: true }).catch(() => undefined);
      notStarted();
      this.endNativeSession(session);
      return;
    }
    session.interactions.setCameraHint(this.deps.facecam.close(session.area));
    if (error !== null) {
      // Only a failed recording is removed; nothing after a finished one deletes it.
      this.deps.log(`Screen recording failed: ${error}`);
      await fs.rm(session.filePath, { force: true }).catch(() => undefined);
      await fs.rm(cameraPath(session.filePath), { force: true }).catch(() => undefined);
      this.endNativeSession(session);
      return;
    }
    if (session.cameraFailed) await fs.rm(cameraPath(session.filePath), { force: true }).catch(() => undefined);
    await session.interactions.save(session.filePath).catch((saveError: unknown) => {
      this.deps.log(`Cursor path could not be saved: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
    });
    if (session.ended) return;
    this.deps.log('Screen recording saved');
    await this.deps.onSaved(session.filePath).catch((saveError: unknown) => {
      this.deps.log(`Saved recording could not be opened: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
    });
    this.endNativeSession(session);
  }

  private endNativeSession(session: NativeSession): void {
    if (session.ended) return;
    session.ended = true;
    this.deps.facecam.close();
    session.finishStart();
    session.interactions.stop();
    if (this.native === session) this.native = null;
    try {
      // An attempt that never started never reported that recording began.
      if (session.started) this.deps.onStateChange(false);
    } finally {
      session.complete();
    }
  }

  private async startBrowser(request: RecordingRequest): Promise<boolean> {
    const center = { x: request.rect.x + request.rect.width / 2, y: request.rect.y + request.rect.height / 2 };
    const display = screen.getDisplayNearestPoint(center);

    let sourceId: string;
    if (request.mode === 'window' && request.windowId !== null) {
      sourceId = `window:${request.windowId}:0`;
    } else {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0];
      if (source === undefined) {
        this.deps.log('Screen recording source unavailable');
        return false;
      }
      sourceId = source.id;
    }
    if (this.shuttingDown) return false;

    // A hidden window runs the capture; the recording controls show the time.
    const window = new BrowserWindow({
      width: CONTROL_WIDTH,
      height: CONTROL_HEIGHT,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: preloadPath('recorder'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });

    const session: RecordingSession = {
      request,
      sourceId,
      displayBounds: display.bounds,
      scaleFactor: display.scaleFactor,
      window,
      filePath: null,
      stream: null,
      writing: Promise.resolve(),
      finished: false,
      ended: false,
      paused: false,
      interactions: new InteractionRecorder(request.rect, this.deps.log, () => this.deps.facecam.hint(request.rect)),
      ...completion()
    };
    this.session = session;
    window.on('closed', () => {
      if (this.session === session && !session.finished) void this.fail(session, 'Recording window closed');
    });
    void loadPage(window, 'recorder');
    this.deps.onStateChange(true);
    this.deps.log(`Screen recording started (${request.mode}, ${request.format}, ${request.resolution}, ${request.fps} fps)`);
    return true;
  }

  isPaused(): boolean {
    return this.native?.paused ?? this.session?.paused ?? false;
  }

  togglePause(): void {
    const native = this.native;
    if (native !== null) {
      // Pausing only makes sense once recording has begun.
      if (native.stopping || !native.started) return;
      native.paused = !native.paused;
      native.interactions.setPaused(native.paused);
      native.capture.send(native.paused ? 'pause' : 'resume');
      this.deps.onPauseChange(native.paused);
      return;
    }
    const session = this.session;
    if (session === null || session.finished || session.window.isDestroyed()) return;
    session.paused = !session.paused;
    session.interactions.setPaused(session.paused);
    session.window.webContents.send(session.paused ? 'recorder:pause' : 'recorder:resume');
    this.deps.onPauseChange(session.paused);
  }

  stop(): void {
    this.startVersion += 1;
    const native = this.native;
    if (native !== null) {
      if (native.stopping) return;
      native.stopping = true;
      native.capture.send('stop');
      return;
    }
    const session = this.session;
    if (session === null || session.finished || session.window.isDestroyed()) return;
    session.window.webContents.send('recorder:request-stop');
  }

  private sessionFor(event: IpcMainEvent | IpcMainInvokeEvent): RecordingSession | null {
    const session = this.session;
    if (session === null || session.window.isDestroyed() || session.window.webContents !== event.sender) return null;
    return session;
  }

  private async fail(session: RecordingSession, reason: string): Promise<void> {
    if (session.finished) return;
    session.finished = true;
    session.interactions.stop();
    this.deps.log(`Screen recording failed: ${reason}`);
    session.stream?.destroy();
    await session.writing.catch(() => undefined);
    if (session.filePath !== null) await fs.rm(session.filePath, { force: true }).catch(() => undefined);
    this.end(session);
  }

  private end(session: RecordingSession): void {
    if (session.ended) return;
    session.ended = true;
    if (this.session === session) this.session = null;
    if (!session.window.isDestroyed()) session.window.destroy();
    try {
      this.deps.onStateChange(false);
    } finally {
      session.complete();
    }
  }

  registerIpc(): void {
    // A safe microphone for the recorder window (never a headset in call mode).
    ipcMain.handle('audio:recording-microphone', (event, name: unknown) => {
      if (this.sessionFor(event) === null || (name !== null && (typeof name !== 'string' || name.length > 512))) return null;
      return recordingMicrophone(name as string | null);
    });

    // What the recorder window captures, in the display's pixels.
    ipcMain.handle('recorder:init', (event) => {
      const session = this.sessionFor(event);
      if (session === null) return null;
      const { request, displayBounds, scaleFactor } = session;
      const crop = request.mode === 'area'
        ? {
            x: Math.round((request.rect.x - displayBounds.x) * scaleFactor),
            y: Math.round((request.rect.y - displayBounds.y) * scaleFactor),
            width: Math.round(request.rect.width * scaleFactor),
            height: Math.round(request.rect.height * scaleFactor)
          }
        : null;
      const source = request.mode === 'window' ? request.rect : displayBounds;
      return {
        sourceId: session.sourceId,
        crop,
        sourceSize: { width: Math.round(source.width * scaleFactor), height: Math.round(source.height * scaleFactor) },
        format: request.format,
        resolution: request.resolution,
        fps: request.fps,
        micId: request.micId,
        micLabel: request.micLabel,
        systemAudio: request.systemAudio === true
      };
    });

    ipcMain.handle('recorder:begin', async (event, extension: unknown) => {
      const session = this.sessionFor(event);
      if (session === null || session.finished || session.stream !== null || (extension !== 'mp4' && extension !== 'webm')) return false;
      const filePath = await this.outputPath(extension);
      if (session.finished || session.ended) return false;
      session.filePath = filePath;
      session.stream = createWriteStream(session.filePath);
      session.stream.on('error', (error) => void this.fail(session, error.message));
      return true;
    });

    ipcMain.on('recorder:chunk', (event, data: unknown) => {
      const session = this.sessionFor(event);
      const stream = session?.stream;
      if (session === null || session.finished || stream === null || stream === undefined || !(data instanceof Uint8Array)) return;
      const chunk = Buffer.from(data);
      session.writing = session.writing.then(() => new Promise<void>((resolve, reject) => {
        stream.write(chunk, (error) => (error ? reject(error) : resolve()));
      }));
      void session.writing.catch((error: unknown) => {
        void this.fail(session, error instanceof Error ? error.message : String(error));
      });
    });

    ipcMain.on('recorder:done', (event) => {
      const session = this.sessionFor(event);
      if (session === null || session.finished) return;
      session.finished = true;
      void (async () => {
        try {
          await session.writing;
          if (session.ended) return;
          await new Promise<void>((resolve) => session.stream?.end(resolve) ?? resolve());
          if (session.ended) return;
          if (session.filePath !== null) {
            // The video is still usable when the cursor path cannot be written.
            await session.interactions.save(session.filePath).catch((error: unknown) => {
              this.deps.log(`Cursor path could not be saved: ${error instanceof Error ? error.message : String(error)}`);
            });
            if (session.ended) return;
            this.deps.log('Screen recording saved');
            await this.deps.onSaved(session.filePath);
          }
        } catch (error) {
          this.deps.log(`Screen recording could not be saved: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          session.interactions.stop();
          this.end(session);
        }
      })();
    });

    ipcMain.on('recorder:started', (event) => {
      const session = this.sessionFor(event);
      if (session === null || session.finished) return;
      session.interactions.begin();
      if (this.shuttingDown) this.stop();
    });

    ipcMain.on('recorder:stop-clicked', (event) => {
      if (this.sessionFor(event) !== null) this.stop();
    });

    ipcMain.on('recorder:error', (event, message: unknown) => {
      const session = this.sessionFor(event);
      if (session !== null) void this.fail(session, typeof message === 'string' ? message : 'Unknown error');
    });
  }
}
