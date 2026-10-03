// Engine side of the preview (runs in the engine worker). libobs renders the
// program canvas into a display attached to the app window.
// Windows: a child window positioned in physical pixels.
// macOS: an IOSurface; the main process shows it with node-window-rendering
// (preview-mac.ts) because that view must live in the window's own process.

import type { Rect } from "../../shared/types";
import type { EngineSession } from "./engine";

const DISPLAY = "seenalyze-program";
const MAIN_RENDERING = 0;

export interface PreviewRequest {
  rect: Rect;
  /** Native window handle bytes from BrowserWindow.getNativeWindowHandle(). */
  windowHandle: Uint8Array;
  /** Display scale factor (Windows positions in physical pixels). */
  scale: number;
  mac: boolean;
}

export interface PreviewResult {
  /** New IOSurface id when the macOS surface had to be (re)created. */
  surface?: number;
}

export class PreviewHost {
  private created = false;
  private size: { width: number; height: number } | null = null;

  constructor(private readonly engine: EngineSession) {}

  setBounds(request: PreviewRequest): PreviewResult {
    const { NodeObs } = this.engine.osn;
    const { rect } = request;
    if (!this.created) {
      NodeObs.OBS_content_createDisplay(Buffer.from(request.windowHandle), DISPLAY, MAIN_RENDERING, false, this.engine.video);
      NodeObs.OBS_content_setShouldDrawUI(DISPLAY, false);
      NodeObs.OBS_content_setPaddingSize(DISPLAY, 0);
      NodeObs.OBS_content_setPaddingColor(DISPLAY, 0, 0, 0);
      this.created = true;
      this.size = null;
    }

    const width = Math.round(rect.width * (request.mac ? 1 : request.scale));
    const height = Math.round(rect.height * (request.mac ? 1 : request.scale));
    const sizeChanged = !this.size || this.size.width !== width || this.size.height !== height;
    if (sizeChanged) {
      NodeObs.OBS_content_resizeDisplay(DISPLAY, width, height);
      this.size = { width, height };
    }

    if (request.mac) {
      // The surface must be recreated whenever the display size changes.
      return sizeChanged ? { surface: NodeObs.OBS_content_createIOSurface(DISPLAY) as number } : {};
    }
    NodeObs.OBS_content_moveDisplay(DISPLAY, Math.round(rect.x * request.scale), Math.round(rect.y * request.scale));
    return {};
  }

  destroy(): void {
    if (!this.created) return;
    this.engine.osn.NodeObs.OBS_content_destroyDisplay(DISPLAY);
    this.created = false;
    this.size = null;
  }
}

export const PREVIEW_DISPLAY_NAME = DISPLAY;
