import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import { loadPage, preloadPath } from './pages';

export type FacecamDependencies = {
  log: (line: string) => void;
  // Called when the camera cannot be shown (no access, busy, or unplugged).
  onError: () => void;
};

// Where the camera was left during recording, so the editor starts there.
export type FacecamHint = {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  size: number;
  x: number;
  y: number;
};

const DEFAULT_SIZE = 220;
const MIN_SIZE = 120;
const MAX_SIZE = 420;
const MARGIN = 28;

// The live camera bubble shown while recording. It belongs to this app, so the
// screen recorder leaves it out of the video; the camera itself is recorded
// separately and placed where the bubble was when editing.
export class FacecamWindow {
  private window: BrowserWindow | null = null;
  private camera: string | null = null;

  constructor(private readonly deps: FacecamDependencies) {}

  // Shows the bubble. An open bubble for the same camera stays where the user put it.
  open(camera: string, area: Rectangle): void {
    const current = this.window;
    if (current !== null && !current.isDestroyed()) {
      const bounds = current.getBounds();
      if (this.camera === camera) return;
      // Another camera: show it in the same spot and size.
      this.close();
      this.create(camera, bounds);
      return;
    }
    this.close();
    const size = Math.round(Math.min(DEFAULT_SIZE, Math.max(MIN_SIZE, Math.min(area.width, area.height) * 0.28)));
    this.create(camera, {
      x: Math.round(area.x + area.width - size - MARGIN),
      y: Math.round(area.y + area.height - size - MARGIN),
      width: size,
      height: size
    });
  }

  private create(camera: string, bounds: Rectangle): void {
    const window = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: true,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: preloadPath('facecam'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    // Keep recording controls and capture overlays above the camera.
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.once('ready-to-show', () => window.showInactive());
    window.on('closed', () => {
      if (this.window === window) this.window = null;
    });
    this.window = window;
    this.camera = camera;
    void loadPage(window, 'facecam');
  }

  // Exact screen placement, including positions beyond the capture boundary.
  hint(area: Rectangle): FacecamHint | null {
    const window = this.window;
    if (window === null || window.isDestroyed() || area.width <= 0 || area.height <= 0) return null;
    const bounds = window.getBounds();
    const centerX = bounds.x + bounds.width / 2 - area.x;
    const centerY = bounds.y + bounds.height / 2 - area.y;
    const horizontal = centerX < area.width / 2 ? 'left' : 'right';
    const vertical = centerY < area.height / 2 ? 'top' : 'bottom';
    return {
      position: `${vertical}-${horizontal}` as FacecamHint['position'],
      size: bounds.width / Math.min(area.width, area.height),
      x: (bounds.x - area.x) / area.width,
      y: (bounds.y - area.y) / area.height
    };
  }

  close(area?: Rectangle): FacecamHint | null {
    const hint = area === undefined ? null : this.hint(area);
    const window = this.window;
    this.window = null;
    this.camera = null;
    if (window !== null && !window.isDestroyed()) window.destroy();
    return hint;
  }

  private isSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.webContents === event.sender;
  }

  registerIpc(): void {
    ipcMain.handle('facecam:init', (event) => (this.isSender(event) ? { camera: this.camera } : null));

    // Scrolling over the bubble makes it bigger or smaller around its center.
    ipcMain.on('facecam:resize', (event, delta: unknown) => {
      const window = this.window;
      if (window === null || !this.isSender(event) || typeof delta !== 'number' || !Number.isFinite(delta)) return;
      const bounds = window.getBounds();
      const size = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, bounds.width + delta)));
      if (size === bounds.width) return;
      const shift = (size - bounds.width) / 2;
      window.setBounds({ x: Math.round(bounds.x - shift), y: Math.round(bounds.y - shift), width: size, height: size });
    });

    ipcMain.on('facecam:error', (event, message: unknown) => {
      if (!this.isSender(event)) return;
      this.deps.log(`Camera preview unavailable: ${typeof message === 'string' ? message : 'unknown reason'}`);
      this.close();
      this.deps.onError();
    });
  }
}
