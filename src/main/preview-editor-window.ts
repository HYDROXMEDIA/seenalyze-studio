// macOS only: the program preview is a native child window drawn above the web
// UI, so the editing layer (selection outline and handles) cannot live in the
// main window. It runs in a transparent child window placed exactly over the
// preview rect instead. It loads the same renderer with `#preview-editor`.

import { BrowserWindow } from "electron";
import type { Rect } from "../shared/types";

export const PREVIEW_EDITOR_HASH = "preview-editor";

/** Methods the editor window may call; everything else is rejected. */
export const PREVIEW_EDITOR_METHODS: ReadonlySet<string> = new Set(["getSnapshot", "patchItemTransform", "setSelectedItem"]);

export class PreviewEditorWindow {
  readonly window: BrowserWindow;
  /** Preview rect relative to the parent's content area (points), or null when hidden. */
  private rect: Rect | null = null;
  private loaded = false;

  constructor(
    private readonly parent: BrowserWindow,
    options: { preload: string; load: (window: BrowserWindow) => void },
  ) {
    this.window = new BrowserWindow({
      parent,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: true,
      roundedCorners: false,
      webPreferences: {
        preload: options.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });
    const contents = this.window.webContents;
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    // Keyboard focus belongs to the main window: hand it back once a click or
    // drag in the editor ends (Shift is read from the pointer event itself).
    contents.on("input-event", (_event, input) => {
      if (input.type === "mouseUp" && !parent.isDestroyed() && parent.isVisible()) parent.focus();
    });
    contents.once("did-finish-load", () => {
      this.loaded = true;
      this.sync();
    });
    options.load(this.window);

    const sync = () => this.sync();
    for (const event of ["move", "resize", "show", "hide", "minimize", "restore", "enter-full-screen", "leave-full-screen"] as const) {
      parent.on(event as "move", sync);
    }
    parent.once("closed", () => {
      if (!this.window.isDestroyed()) this.window.destroy();
    });
  }

  get webContents(): Electron.WebContents | null {
    return this.window.isDestroyed() ? null : this.window.webContents;
  }

  /** Places the editor over the preview (content-relative rect), or hides it. */
  setRect(rect: Rect | null): void {
    this.rect = rect && rect.width >= 2 && rect.height >= 2 ? rect : null;
    this.sync();
  }

  /**
   * The native preview window is re-added as a child whenever its surface is
   * recreated, which orders it above the editor; re-adding the editor puts it
   * back on top.
   */
  raise(): void {
    if (this.window.isDestroyed() || this.parent.isDestroyed() || !this.window.isVisible()) return;
    this.window.setParentWindow(null);
    this.window.setParentWindow(this.parent);
    this.window.showInactive();
  }

  private sync(): void {
    if (this.window.isDestroyed() || this.parent.isDestroyed()) return;
    const rect = this.rect;
    if (!rect || !this.loaded || !this.parent.isVisible() || this.parent.isMinimized()) {
      if (this.window.isVisible()) this.window.hide();
      return;
    }
    const content = this.parent.getContentBounds();
    const bounds = {
      x: Math.round(content.x + rect.x),
      y: Math.round(content.y + rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    const current = this.window.getBounds();
    if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
      this.window.setBounds(bounds);
    }
    // Never take focus when it appears; the main window keeps the keyboard.
    if (!this.window.isVisible()) this.window.showInactive();
  }

  destroy(): void {
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}
