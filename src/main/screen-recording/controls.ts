import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import { loadPage, preloadPath } from './pages';

export type ControlsState = {
  // When recording began, moved forward by the time spent paused.
  startedAt: number;
  pausedAt: number | null;
};

export type ControlsDependencies = {
  togglePause: () => void;
  stop: () => void;
};

const WIDTH = 216;
const HEIGHT = 52;
const MARGIN = 12;

// The small floating bar shown while a screen recording runs: elapsed time,
// pause and stop. It is kept out of the recording itself.
export class ControlsWindow {
  private window: BrowserWindow | null = null;
  private state: ControlsState | null = null;

  constructor(private readonly deps: ControlsDependencies) {}

  show(area: Rectangle, state: ControlsState): void {
    this.state = state;
    if (this.window !== null && !this.window.isDestroyed()) {
      this.push();
      return;
    }
    const display = screen.getDisplayMatching(area);
    const { workArea } = display;
    const window = new BrowserWindow({
      x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      y: Math.round(workArea.y + MARGIN),
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: preloadPath('controls'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    // Screen capture APIs that honor it leave the bar out of the video.
    window.setContentProtection(true);
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.once('ready-to-show', () => window.showInactive());
    window.on('closed', () => {
      if (this.window === window) this.window = null;
    });
    this.window = window;
    void loadPage(window, 'controls');
  }

  update(state: ControlsState): void {
    this.state = state;
    this.push();
  }

  hide(): void {
    const window = this.window;
    this.window = null;
    this.state = null;
    if (window !== null && !window.isDestroyed()) window.destroy();
  }

  private push(): void {
    if (this.window !== null && !this.window.isDestroyed() && this.state !== null) this.window.webContents.send('controls:state', this.state);
  }

  private isSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.webContents === event.sender;
  }

  registerIpc(): void {
    ipcMain.handle('controls:init', (event) => (this.isSender(event) ? this.state : null));
    ipcMain.on('controls:toggle-pause', (event) => {
      if (this.isSender(event)) this.deps.togglePause();
    });
    ipcMain.on('controls:stop', (event) => {
      if (this.isSender(event)) this.deps.stop();
    });
  }
}
