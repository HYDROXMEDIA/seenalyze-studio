// One engine display shown in an app window (main process side): asks the
// engine worker to create, size or move it, and on macOS shows its surface
// with a helper view (preview-mac.ts). Callers serialize calls per window.

import type { BrowserWindow } from "electron";
import type { DisplaySpec, Rect } from "../shared/types";
import type { EngineClient } from "./engine/client";
import { MacPreviewView } from "./preview-mac";

const IS_MAC = process.platform === "darwin";
/** The engine needs about two frames (at the canvas frame rate) to draw a complete picture into a new preview surface. */
export const NEW_SURFACE_SETTLE_MS = 100;

export class NativeDisplay {
  private readonly view: MacPreviewView | null;
  /** The engine display exists. */
  private created = false;

  constructor(
    private readonly engine: EngineClient,
    private readonly window: BrowserWindow,
    /** Engine display name, unique across the app. */
    readonly name: string,
    /** What it shows; null is the main window's program display. A change takes effect on the next show. */
    public spec: DisplaySpec | null,
  ) {
    this.view = IS_MAC ? new MacPreviewView(window, name) : null;
  }

  /**
   * Shows the display at `rect` (content-relative points) in a window with
   * backing scale `scale`, or removes it for null. `alive` is checked again
   * after waiting for a new surface. Returns true when a new macOS view was made.
   */
  async show(rect: Rect | null, scale: number, alive: () => boolean): Promise<boolean> {
    if (!rect || rect.width < 2 || rect.height < 2) {
      await this.hide();
      return false;
    }
    const request = { rect, windowHandle: new Uint8Array(this.window.getNativeWindowHandle()), scale, mac: IS_MAC };
    let result: { surface?: number };
    try {
      result = this.spec ? await this.engine.call("setPreview", request, { name: this.name, spec: this.spec }) : await this.engine.call("setPreview", request);
    } catch (error) {
      // The content may be gone (a removed scene); never leave a stale picture up.
      this.view?.detach();
      throw error;
    }
    this.created = true;
    if (!this.view) return false;
    if (result.surface !== undefined) {
      // The engine's first frames in a new surface can be partly drawn; keep
      // the previous view up until a complete frame is in.
      await new Promise((resolve) => setTimeout(resolve, NEW_SURFACE_SETTLE_MS));
      if (!alive() || this.window.isDestroyed()) return false;
    }
    return this.view.show(rect, scale, result.surface);
  }

  /** Removes the view and the engine display. */
  async hide(): Promise<void> {
    this.view?.detach();
    if (!this.created) return;
    this.created = false;
    await this.engine.call("hidePreview", this.name);
  }

  /** The engine stopped: its displays are gone; only the view is left to remove. */
  reset(): void {
    this.view?.detach();
    this.created = false;
  }
}
