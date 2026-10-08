// Engine side of the preview and projector displays (runs in the engine
// worker). libobs renders into displays attached to app windows: the program
// canvas, or a single source (the studio-mode preview, a scene, a source).
// Windows: a child window positioned in physical pixels.
// macOS: an IOSurface; the main process shows it with node-window-rendering
// (preview-mac.ts) because that view must live in the window's own process.

import type { Rect } from "../../shared/types";
import type { EngineSession } from "./engine";

const DISPLAY = "seenalyze-program";
const MAIN_RENDERING = 0;
/** Display names: unique per display (the engine refuses a duplicate) and safe as helper view names. */
const DISPLAY_NAME = /^seenalyze-[a-z0-9-]{1,80}$/u;

export interface PreviewRequest {
  rect: Rect;
  /** Native window handle bytes from BrowserWindow.getNativeWindowHandle(). */
  windowHandle: Uint8Array;
  /** Window backing scale factor (Windows positions and sizes in physical pixels; unused on macOS). */
  scale: number;
  mac: boolean;
}

export interface PreviewResult {
  /** New IOSurface id when the macOS surface had to be (re)created. */
  surface?: number;
}

/** What a display shows: the program output, or one engine source by its engine name. */
export type DisplayContent = { kind: "program" } | { kind: "source"; source: string };

export class PreviewHost {
  private created = false;
  private size: { width: number; height: number } | null = null;
  private windowKey = "";

  constructor(
    private readonly engine: EngineSession,
    readonly name: string = DISPLAY,
    readonly content: DisplayContent = { kind: "program" },
  ) {
    if (!DISPLAY_NAME.test(name)) throw new Error("invalid-request");
  }

  setBounds(request: PreviewRequest): PreviewResult {
    const { NodeObs } = this.engine.osn;
    const { rect } = request;
    const windowKey = Buffer.from(request.windowHandle).toString("hex");
    // A display belongs to one window for its whole life.
    if (this.created && windowKey !== this.windowKey) this.destroy();
    if (!this.created) {
      const handle = Buffer.from(request.windowHandle);
      if (this.content.kind === "program") {
        NodeObs.OBS_content_createDisplay(handle, this.name, MAIN_RENDERING, false, this.engine.video);
      } else {
        NodeObs.OBS_content_createSourcePreviewDisplay(handle, this.content.source, this.name, false, this.engine.video);
      }
      // The preview editor draws selection and handles itself.
      NodeObs.OBS_content_setShouldDrawUI(this.name, false);
      NodeObs.OBS_content_setPaddingSize(this.name, 0);
      NodeObs.OBS_content_setPaddingColor(this.name, 0, 0, 0);
      this.created = true;
      this.size = null;
      this.windowKey = windowKey;
    }

    // Windows: the display is a child window positioned and sized in physical
    // pixels. macOS: the preview helper makes its view as many points as the
    // surface has pixels and stretches the surface over the view's backing
    // pixels, so the surface is sized in points on every screen (sized in
    // physical pixels, it shows twice too large on Retina screens).
    // Resizing is enough; the display needs no rebuild when the window moves
    // to another screen, and destroying it right after a resize is unsafe.
    const pixelScale = request.mac ? 1 : request.scale;
    const width = Math.round(rect.width * pixelScale);
    const height = Math.round(rect.height * pixelScale);
    const sizeChanged = !this.size || this.size.width !== width || this.size.height !== height;
    if (sizeChanged) {
      NodeObs.OBS_content_resizeDisplay(this.name, width, height);
      this.size = { width, height };
    }

    if (request.mac) {
      // A surface keeps the size it was created with and the engine stops
      // drawing into it once a new one exists, so every new size gets one.
      return sizeChanged ? { surface: NodeObs.OBS_content_createIOSurface(this.name) as number } : {};
    }
    NodeObs.OBS_content_moveDisplay(this.name, Math.round(rect.x * request.scale), Math.round(rect.y * request.scale));
    return {};
  }

  destroy(): void {
    if (!this.created) return;
    this.engine.osn.NodeObs.OBS_content_destroyDisplay(this.name);
    this.created = false;
    this.size = null;
  }
}

/**
 * Every display the app shows, by name. A display that has to show other
 * content is destroyed and made again; a new size or position never rebuilds it.
 */
export class DisplayHosts {
  private readonly hosts = new Map<string, PreviewHost>();

  constructor(private readonly engine: EngineSession) {}

  set(name: string, content: DisplayContent, request: PreviewRequest): PreviewResult {
    let host = this.hosts.get(name);
    if (host && !sameContent(host.content, content)) {
      host.destroy();
      this.hosts.delete(name);
      host = undefined;
    }
    if (!host) {
      host = new PreviewHost(this.engine, name, content);
      this.hosts.set(name, host);
    }
    return host.setBounds(request);
  }

  destroy(name: string): void {
    this.hosts.get(name)?.destroy();
    this.hosts.delete(name);
  }

  destroyAll(): void {
    for (const host of this.hosts.values()) host.destroy();
    this.hosts.clear();
  }
}

function sameContent(a: DisplayContent, b: DisplayContent): boolean {
  return a.kind === b.kind && (a.kind === "program" || a.source === (b as { source: string }).source);
}

export const PREVIEW_DISPLAY_NAME = DISPLAY;
