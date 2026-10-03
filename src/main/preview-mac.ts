// macOS half of the preview (main process): shows the engine's IOSurface in a
// child view of the app window and keeps it aligned with the reserved rect.

import type { BrowserWindow } from "electron";
import type { Rect } from "../shared/types";
import { PREVIEW_DISPLAY_NAME } from "./engine/preview";
import { loadNwr } from "./engine/osn";

export class MacPreviewView {
  private attached = false;

  constructor(private readonly window: BrowserWindow) {}

  /** Attaches a new surface, replacing the previous view. */
  attach(surface: number): void {
    const nwr = loadNwr();
    this.detach();
    nwr.createWindow(PREVIEW_DISPLAY_NAME, this.window.getNativeWindowHandle());
    nwr.connectIOSurface(PREVIEW_DISPLAY_NAME, surface);
    this.attached = true;
  }

  move(rect: Rect): void {
    if (!this.attached) return;
    // AppKit origin is bottom-left, in points.
    const [, contentHeight] = this.window.getContentSize();
    loadNwr().moveWindow(PREVIEW_DISPLAY_NAME, rect.x, contentHeight - (rect.y + rect.height));
  }

  detach(): void {
    if (!this.attached) return;
    const nwr = loadNwr();
    nwr.destroyWindow(PREVIEW_DISPLAY_NAME);
    nwr.destroyIOSurface(PREVIEW_DISPLAY_NAME);
    this.attached = false;
  }
}
