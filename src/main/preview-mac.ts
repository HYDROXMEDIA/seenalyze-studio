// macOS half of the preview (main process): shows the engine's IOSurface in a
// view on top of the window's content and keeps it aligned with the reserved rect.
//
// The helper (node-window-rendering) sizes its view in points from the
// surface's pixel size, and its drawing buffer keeps the size in backing pixels
// that the view had when it first drew: it never follows a later change of
// size or backing scale (the preview then fills only part of the view and the
// rest shows the helper's green background, or a magnified corner). So a view
// only ever shows one surface at one backing scale; a new surface, or a move
// to a screen with another scale, gets a new view.
//
// Every display has its own view, named after the display (names are unique
// across all windows), so several views can live in one window or in several.

import type { BrowserWindow } from "electron";
import type { Rect } from "../shared/types";
import { PREVIEW_DISPLAY_NAME } from "./engine/preview";
import { loadNwr } from "./engine/osn";

export class MacPreviewView {
  /** Surface the engine draws into; it stays valid until the engine creates a new one. */
  private surface: number | null = null;
  /** Backing scale the current view was created at; null while there is no view. */
  private viewScale: number | null = null;

  constructor(
    private readonly window: BrowserWindow,
    /** The engine display's name; the helper keys its view by it. */
    readonly name: string = PREVIEW_DISPLAY_NAME,
  ) {}

  /**
   * Shows the preview at `rect` (content-relative points) in a window with
   * backing scale `scale`. `surface` is the engine's new surface, if it made one.
   * Returns true when a new view was created.
   */
  show(rect: Rect, scale: number, surface?: number): boolean {
    if (surface !== undefined) {
      this.detach();
      // The helper cannot replace a view whose surface failed to connect, so
      // only real surfaces are attached.
      if (!Number.isInteger(surface) || surface <= 0) return false;
      this.surface = surface;
    }
    if (this.surface === null) return false;
    const created = this.viewScale !== scale;
    if (created) this.createView(this.surface, scale);
    // Sizes the view and positions it; the view draws for the first time only
    // after this call returns, so its buffer matches this size and scale.
    this.move(rect);
    return created;
  }

  detach(): void {
    this.destroyView();
    this.surface = null;
  }

  private createView(surface: number, scale: number): void {
    this.destroyView();
    const nwr = loadNwr();
    nwr.createWindow(this.name, this.window.getNativeWindowHandle());
    nwr.connectIOSurface(this.name, surface);
    this.viewScale = scale;
  }

  private move(rect: Rect): void {
    // AppKit origin is bottom-left, in points.
    const [, contentHeight] = this.window.getContentSize();
    loadNwr().moveWindow(this.name, rect.x, contentHeight - (rect.y + rect.height));
  }

  private destroyView(): void {
    if (this.viewScale === null) return;
    const nwr = loadNwr();
    // Keep this order: removing the surface first leaves the helper unable to
    // remove the view.
    nwr.destroyWindow(this.name);
    nwr.destroyIOSurface(this.name);
    this.viewScale = null;
  }
}
