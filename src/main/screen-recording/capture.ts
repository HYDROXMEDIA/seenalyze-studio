import { BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import { execFile } from 'node:child_process';
import type { RecordingFormat, RecordingRequest, RecordingResolution } from './recording';
import { helperPath, loadPage, preloadPath, scriptPath } from './pages';
import { t } from './i18n';

export type CaptureMode = 'area' | 'window' | 'screen';

type Rect = { x: number; y: number; width: number; height: number };

export type OnScreenWindow = { id: number; pid: number; app: string; title: string } & Rect;

type CaptureRequest = {
  mode: CaptureMode;
  rect: Rect;
  windowId?: number;
  format?: RecordingFormat;
  resolution?: RecordingResolution;
  fps?: number;
  micId?: string;
  micLabel?: string;
  camera?: string;
  systemAudio?: boolean;
  systemAudioPid?: number;
};

const RECORDING_FORMATS: RecordingFormat[] = ['mp4', 'webm'];
const RECORDING_RESOLUTIONS: RecordingResolution[] = ['native', '2160', '1440', '1080', '720'];
const RECORDING_FPS = [24, 30, 60];

export type RecordingDevices = { microphone: string; camera: string };

export type CaptureDependencies = {
  log: (line: string) => void;
  // Screen access is checked (and requested) before the picker opens.
  ensureScreenAccess: () => Promise<boolean>;
  startRecording: (request: RecordingRequest) => Promise<boolean>;
  // Shows the camera bubble on a display while a recording is set up, or hides it.
  facecamPreview: (camera: string | null, area: Rectangle | null) => void;
  // Microphone and camera for recordings: '' for none, 'default', or a device name.
  recordingDevices: () => RecordingDevices;
  setRecordingDevices: (devices: RecordingDevices) => void;
  recordingFolderName: () => string;
  chooseRecordingFolder: (parent: BrowserWindow) => Promise<string | null>;
};

type CaptureSession = {
  windows: Map<number, BrowserWindow>;
  onScreenWindows: OnScreenWindow[];
  cursorDisplayId: number;
  selectionDisplayId: number | null;
  busy: boolean;
  safetyTimer: NodeJS.Timeout | null;
  thumbnailsStarted: boolean;
};

const THUMBNAIL_WIDTH = 560;
const MAX_PICKER_WINDOWS = 30;
const SESSION_TIMEOUT_MS = 3 * 60 * 1000;

function isFiniteRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Partial<Rect>;
  return [rect.x, rect.y, rect.width, rect.height].every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

// True when almost no pixel of the image is visible.
function isTransparent(image: Electron.NativeImage): boolean {
  const bitmap = image.toBitmap();
  const pixels = bitmap.length / 4;
  if (pixels === 0) return true;
  const step = Math.max(1, Math.floor(pixels / 4000));
  let visible = 0;
  let sampled = 0;
  for (let pixel = 0; pixel < pixels; pixel += step) {
    sampled += 1;
    if (bitmap[pixel * 4 + 3] > 16) visible += 1;
  }
  return visible / sampled < 0.02;
}

// On-screen app windows, front to back, from the platform helper.
function listWindows(): Promise<OnScreenWindow[]> {
  const [command, args] = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('windows_window_list.ps1'), String(process.pid)]]
    : [helperPath('window-list'), [String(process.pid)]];
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      try {
        const reply = JSON.parse(stdout) as { windows?: unknown };
        const windows = Array.isArray(reply.windows) ? reply.windows : [];
        resolve(windows.filter((entry): entry is OnScreenWindow => isFiniteRect(entry) && typeof (entry as Partial<OnScreenWindow>).id === 'number')
          .map((entry) => ({
            ...entry,
            // Windows reports physical pixels; the picker works in display points.
            ...(process.platform === 'win32' ? screen.screenToDipRect(null, entry) : {}),
            pid: typeof entry.pid === 'number' ? entry.pid : 0,
            app: typeof entry.app === 'string' ? entry.app : '',
            title: typeof entry.title === 'string' ? entry.title : ''
          })));
      } catch {
        resolve([]);
      }
    });
  });
}

// Runs the recording picker: one transparent panel per display where the
// user picks a window, an area, or a whole display to record.
export class CaptureController {
  private session: CaptureSession | null = null;
  private starting = false;
  private startVersion = 0;

  constructor(private readonly deps: CaptureDependencies) {}

  isActive(): boolean {
    return this.session !== null || this.starting;
  }

  async start(): Promise<void> {
    if (this.starting) return;
    if (this.session !== null) {
      if (!this.session.busy) this.cancel('Opened again');
      return;
    }
    if (process.platform !== 'darwin' && process.platform !== 'win32') return;

    const version = ++this.startVersion;
    this.starting = true;
    try {
      if (!(await this.deps.ensureScreenAccess())) {
        this.deps.log('Screen recording needs screen access');
        return;
      }
      const onScreenWindows = await listWindows();
      if (version !== this.startVersion) return;

      const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const session: CaptureSession = {
        windows: new Map(),
        onScreenWindows,
        cursorDisplayId: cursorDisplay.id,
        selectionDisplayId: null,
        busy: false,
        safetyTimer: null,
        thumbnailsStarted: false
      };
      this.session = session;
      session.safetyTimer = setTimeout(() => {
        if (this.session === session) this.cancel('Picker timed out');
      }, SESSION_TIMEOUT_MS);

      for (const display of screen.getAllDisplays()) {
        const bounds = display.bounds;
        const window = new BrowserWindow({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          show: false,
          type: process.platform === 'darwin' ? 'panel' : undefined,
          frame: false,
          transparent: true,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          hasShadow: false,
          roundedCorners: false,
          enableLargerThanScreen: true,
          acceptFirstMouse: true,
          backgroundColor: '#00000000',
          webPreferences: {
            preload: preloadPath('capture'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false
          }
        });
        window.setAlwaysOnTop(true, 'screen-saver');
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        window.setBounds(bounds);
        session.windows.set(display.id, window);

        // Handle dismissal before a focused control (including a select) consumes it.
        window.webContents.on('before-input-event', (event, input) => {
          if (this.session !== session || input.type !== 'keyDown' || input.key !== 'Escape') return;
          event.preventDefault();
          this.cancel('Escape pressed');
        });
        window.on('closed', () => {
          if (this.session === session && session.windows.get(display.id) === window) {
            session.windows.delete(display.id);
            if (session.windows.size === 0) this.endSession(session);
          }
        });
        window.once('ready-to-show', () => {
          if (this.session !== session || window.isDestroyed()) return;
          window.showInactive();
          if (display.id === session.cursorDisplayId) {
            window.focus();
            window.webContents.focus();
          }
        });
        void loadPage(window, 'capture', { display: String(display.id) }).catch(() => {
          if (this.session === session) this.cancel('Picker could not be loaded');
        });
      }
      this.deps.log(`Recording picker opened on ${session.windows.size} display(s)`);
    } catch {
      if (version === this.startVersion) this.cancel('Picker unavailable');
    } finally {
      if (version === this.startVersion) this.starting = false;
    }
  }

  cancel(reason = 'Cancelled'): void {
    this.starting = false;
    this.startVersion++;
    const session = this.session;
    if (session === null) return;
    this.deps.log(`Recording picker closed: ${reason}`);
    this.endSession(session);
  }

  // Tells the picker that the chosen camera could not be shown.
  notifyCameraError(): void {
    this.broadcast('capture:camera-error', null);
  }

  // `keepFacecam` leaves the camera bubble up for a recording that uses it.
  private endSession(session: CaptureSession, keepFacecam = false): void {
    if (!keepFacecam) this.deps.facecamPreview(null, null);
    if (this.session === session) this.session = null;
    if (session.safetyTimer !== null) clearTimeout(session.safetyTimer);
    session.safetyTimer = null;
    const windows = Array.from(session.windows.values());
    session.windows.clear();
    for (const window of windows) {
      if (!window.isDestroyed()) window.destroy();
    }
  }

  private displayIdFor(event: IpcMainEvent | IpcMainInvokeEvent): number | null {
    const session = this.session;
    if (session === null) return null;
    for (const [displayId, window] of session.windows) {
      if (!window.isDestroyed() && window.webContents === event.sender) return displayId;
    }
    return null;
  }

  private broadcast(channel: string, payload: unknown, exceptDisplayId: number | null = null): void {
    const session = this.session;
    if (session === null) return;
    for (const [displayId, window] of session.windows) {
      if (displayId !== exceptDisplayId && !window.isDestroyed()) window.webContents.send(channel, payload);
    }
  }

  // Shows a device change made on another display on every open toolbar.
  devicesChanged(devices: RecordingDevices): void {
    this.broadcast('capture:devices', devices);
  }

  registerIpc(): void {
    ipcMain.handle('capture:init', (event) => {
      const session = this.session;
      const displayId = this.displayIdFor(event);
      if (session === null || displayId === null) return null;
      const display = screen.getAllDisplays().find((entry) => entry.id === displayId);
      if (display === undefined) return null;
      return {
        displayId,
        platform: process.platform,
        bounds: display.bounds,
        isCursorDisplay: displayId === session.cursorDisplayId,
        cursor: screen.getCursorScreenPoint(),
        windows: session.onScreenWindows,
        recordingFolder: this.deps.recordingFolderName(),
        devices: this.deps.recordingDevices()
      };
    });

    ipcMain.on('capture:set-mode', (event, mode: unknown) => {
      const displayId = this.displayIdFor(event);
      if (displayId === null || (mode !== 'area' && mode !== 'window' && mode !== 'screen')) return;
      this.broadcast('capture:mode', mode, displayId);
    });

    ipcMain.on('capture:selection', (event, hasSelection: unknown) => {
      const session = this.session;
      const displayId = this.displayIdFor(event);
      if (session === null || displayId === null) return;
      if (hasSelection === true) {
        if (session.selectionDisplayId !== displayId) {
          session.selectionDisplayId = displayId;
          this.broadcast('capture:clear-selection', null, displayId);
        }
      } else if (session.selectionDisplayId === displayId) {
        session.selectionDisplayId = null;
      }
    });

    ipcMain.on('capture:enter', (event, mode: unknown) => {
      const session = this.session;
      const senderDisplayId = this.displayIdFor(event);
      if (session === null || senderDisplayId === null || session.busy) return;
      const targetDisplayId = mode === 'area'
        ? session.selectionDisplayId ?? senderDisplayId
        : mode === 'window'
          ? session.cursorDisplayId
          : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
      const window = session.windows.get(targetDisplayId);
      if (window !== undefined && !window.isDestroyed()) window.webContents.send('capture:commit');
    });

    ipcMain.handle('capture:microphone-access', async (event) => {
      if (this.displayIdFor(event) === null) return false;
      return process.platform !== 'darwin' || await systemPreferences.askForMediaAccess('microphone').catch(() => false);
    });

    ipcMain.handle('capture:choose-folder', async (event) => {
      const session = this.session;
      const displayId = this.displayIdFor(event);
      if (session === null || displayId === null || session.busy) return null;
      const parent = session.windows.get(displayId);
      if (parent === undefined || parent.isDestroyed()) return null;
      // Drop the picker below the folder dialog while it is open.
      const windows = Array.from(session.windows.values()).filter((window) => !window.isDestroyed());
      for (const window of windows) window.setAlwaysOnTop(false);
      try {
        return await this.deps.chooseRecordingFolder(parent);
      } finally {
        for (const window of windows) {
          if (window.isDestroyed()) continue;
          window.setAlwaysOnTop(true, 'screen-saver');
          window.focus();
        }
      }
    });

    ipcMain.on('capture:window-thumbnails', (event) => {
      const session = this.session;
      const displayId = this.displayIdFor(event);
      if (session === null || displayId === null || session.thumbnailsStarted) return;
      session.thumbnailsStarted = true;
      void this.sendThumbnails(session, event.sender).catch(() => {
        if (this.session === session && !event.sender.isDestroyed()) event.sender.send('capture:thumbnails-done');
      });
    });

    ipcMain.on('capture:devices', (event, devices: unknown) => {
      if (this.displayIdFor(event) === null || typeof devices !== 'object' || devices === null) return;
      const { microphone, camera } = devices as Partial<RecordingDevices>;
      if (typeof microphone !== 'string' || typeof camera !== 'string' || microphone.length > 512 || camera.length > 512) return;
      this.deps.setRecordingDevices({ microphone, camera });
    });

    ipcMain.on('capture:facecam', (event, camera: unknown) => {
      const session = this.session;
      if (session === null || this.displayIdFor(event) === null) return;
      if (camera !== null && (typeof camera !== 'string' || camera.length === 0 || camera.length > 512)) return;
      const display = screen.getAllDisplays().find((entry) => entry.id === session.cursorDisplayId) ?? screen.getPrimaryDisplay();
      this.deps.facecamPreview(camera, display.workArea);
    });

    ipcMain.on('capture:cancel', (event) => {
      if (this.displayIdFor(event) !== null) this.cancel('Closed by user');
    });

    ipcMain.handle('capture:perform', async (event, request: unknown) => {
      if (this.displayIdFor(event) === null) return { ok: false, error: t('capture.noSession') };
      return this.perform(request);
    });
  }

  // Small previews of every window, so the picker can show them all,
  // including windows hidden behind others. Previews that come out fully
  // transparent belong to invisible helper windows and are dropped.
  private async sendThumbnails(session: CaptureSession, sender: Electron.WebContents): Promise<void> {
    const wanted = new Set(session.onScreenWindows.slice(0, MAX_PICKER_WINDOWS).map((entry) => entry.id));
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: THUMBNAIL_WIDTH, height: THUMBNAIL_WIDTH } });
    const byId = new Map<number, Electron.NativeImage>();
    for (const source of sources) {
      const id = Number(source.id.split(':')[1]);
      if (wanted.has(id)) byId.set(id, source.thumbnail);
    }
    for (const id of wanted) {
      if (this.session !== session || sender.isDestroyed()) return;
      const image = byId.get(id);
      const url = image === undefined || image.isEmpty() || isTransparent(image) ? null : image.toDataURL();
      sender.send('capture:thumbnail', { id, url });
    }
    if (this.session === session && !sender.isDestroyed()) sender.send('capture:thumbnails-done');
  }

  private async perform(request: unknown): Promise<{ ok: boolean; error?: string }> {
    const session = this.session;
    if (session === null) return { ok: false, error: t('capture.noSession') };
    if (session.busy) return { ok: false, error: t('capture.busy') };
    if (typeof request !== 'object' || request === null) return { ok: false, error: t('capture.invalid') };
    const options = request as Partial<CaptureRequest>;
    const mode = options.mode;
    if ((mode !== 'area' && mode !== 'window' && mode !== 'screen') || !isFiniteRect(options.rect)) return { ok: false, error: t('capture.invalid') };
    const rect: Rect = {
      x: Math.round(options.rect.x),
      y: Math.round(options.rect.y),
      width: Math.round(options.rect.width),
      height: Math.round(options.rect.height)
    };
    if (rect.width < 2 || rect.height < 2) return { ok: false, error: t('capture.tooSmall') };
    const windowId = mode === 'window' && Number.isInteger(options.windowId) ? Number(options.windowId) : null;
    if (mode === 'window' && (windowId === null || !session.onScreenWindows.some((entry) => entry.id === windowId))) {
      return { ok: false, error: t('capture.windowUnavailable') };
    }

    const format = RECORDING_FORMATS.find((entry) => entry === options.format);
    const resolution = RECORDING_RESOLUTIONS.find((entry) => entry === options.resolution);
    const fps = RECORDING_FPS.find((entry) => entry === options.fps);
    if (format === undefined || resolution === undefined || fps === undefined) return { ok: false, error: t('capture.invalid') };
    const micId = typeof options.micId === 'string' && options.micId.length > 0 && options.micId.length <= 512 ? options.micId : null;
    const micLabel = micId !== null && micId !== 'default' && typeof options.micLabel === 'string' && options.micLabel.length <= 512 ? options.micLabel : null;
    const camera = typeof options.camera === 'string' && options.camera.length > 0 && options.camera.length <= 512 ? options.camera : null;
    const systemAudioPid = Number.isInteger(options.systemAudioPid) && Number(options.systemAudioPid) > 0 ? Number(options.systemAudioPid) : null;
    session.busy = true;
    this.endSession(session, camera !== null);
    const started = await this.deps.startRecording({ mode, rect, windowId, format, resolution, fps, micId, micLabel, camera, systemAudio: options.systemAudio === true, systemAudioPid });
    return started ? { ok: true } : { ok: false, error: t('capture.recordFailed') };
  }
}
