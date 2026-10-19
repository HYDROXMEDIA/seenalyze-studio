// macOS half of the preview (main process): shows an engine display's surface
// in a view above the window's content and keeps it on the rect the page reserved.
//
// The view comes from the preview presenter (native/preview_presenter.mm): a
// Metal layer that Core Animation scales to the view. It needs no rebuild when
// the window moves to a screen with another backing scale or changes size, and
// it shows the last picture until a new surface has a frame.
//
// Every display has its own view, named after the display (names are unique
// across all windows), so several views can live in one window or in several.

import { createRequire } from "node:module";
import type { BrowserWindow } from "electron";
import type { Rect } from "../shared/types";
import { helperPath } from "./screen-recording/pages";

interface PreviewPresenter {
  attach(name: string, contentView: Buffer, onError: (code: string) => void): void;
  setSurface(name: string, surface: number): void;
  /** Content-relative points, top-left origin. */
  setFrame(name: string, x: number, y: number, width: number, height: number): void;
  setHidden(name: string, hidden: boolean): void;
  /** Flat [x, y, width, height, ...] in content-relative points; left see-through. */
  setCutouts(name: string, rects: number[]): void;
  setDimmed(name: string, dimmed: boolean): void;
  detach(name: string): void;
}

/** A view that stopped showing frames is rebuilt at most this often; failing again sooner is reported. */
const REBUILD_INTERVAL_MS = 10_000;

// The main bundle is CommonJS, so __filename is defined at runtime.
const nativeRequire = createRequire(__filename);
let presenter: PreviewPresenter | null = null;

function loadPresenter(): PreviewPresenter {
  presenter ??= nativeRequire(helperPath("preview-presenter.node")) as PreviewPresenter;
  return presenter;
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MacPreviewView {
  private attached = false;
  /** Surface the view shows; it stays valid while the engine runs. */
  private surface: number | null = null;
  private rect: Rect | null = null;
  private cutouts: Rect[] = [];
  private dimmed = false;
  /** Counts attaches, so a report from a removed view is ignored. */
  private generation = 0;
  private lastRebuild = 0;
  /** The user was told; told again only after a new surface showed. */
  private failureReported = false;

  constructor(
    private readonly window: BrowserWindow,
    /** The engine display's name; the presenter keys its view by it. */
    readonly name: string,
    /** The preview stopped showing frames and could not be restored. */
    private readonly onFailure: (code: string) => void,
  ) {}

  /**
   * Shows the preview at `rect` (content-relative points). `surface` is the
   * engine's new surface, if it made one. Returns true when a new view was made.
   */
  show(rect: Rect, surface?: number): boolean {
    const created = !this.attached;
    if (created && !this.attempt("could not be shown", () => this.attach())) return false;
    // A surface that cannot be shown leaves the last picture up, still placed on the new rect.
    if (surface !== undefined) this.attempt(`cannot show its new surface ${surface}`, () => this.setSurface(surface));
    this.attempt("could not be placed", () => this.place(rect));
    if (created && this.cutouts.length) this.attempt("could not cut out popups", () => this.applyCutouts());
    if (created && this.dimmed) this.attempt("could not be dimmed", () => loadPresenter().setDimmed(this.name, true));
    return created;
  }

  /** Areas (content-relative points) where popups cover the view; kept across rebuilds. */
  setCutouts(rects: Rect[]): void {
    this.cutouts = rects;
    if (this.attached) this.attempt("could not cut out popups", () => this.applyCutouts());
  }

  setDimmed(dimmed: boolean): void {
    if (this.dimmed === dimmed) return;
    this.dimmed = dimmed;
    if (this.attached) this.attempt("could not be dimmed", () => loadPresenter().setDimmed(this.name, dimmed));
  }

  private applyCutouts(): void {
    loadPresenter().setCutouts(
      this.name,
      this.cutouts.flatMap((rect) => [rect.x, rect.y, rect.width, rect.height]),
    );
  }

  detach(): void {
    if (this.attached) {
      this.attached = false;
      this.generation += 1;
      this.attempt("could not be removed", () => loadPresenter().detach(this.name));
    }
    this.surface = null;
    this.rect = null;
  }

  private attach(): void {
    const generation = ++this.generation;
    loadPresenter().attach(this.name, this.window.getNativeWindowHandle(), (code) => {
      if (generation === this.generation) this.stopped(code);
    });
    this.attached = true;
  }

  private setSurface(surface: number): void {
    // The engine reports a failed surface as 0; the last picture stays up.
    if (!Number.isInteger(surface) || surface <= 0) throw new Error("preview-failed");
    loadPresenter().setSurface(this.name, surface);
    this.surface = surface;
    this.failureReported = false;
  }

  private place(rect: Rect): void {
    this.rect = rect;
    const [width, height] = this.window.getContentSize();
    // Floating UI parks the preview off the content area (see studio.ts).
    const parked = rect.x + rect.width <= 0 || rect.y + rect.height <= 0 || rect.x >= width || rect.y >= height;
    const native = loadPresenter();
    if (!parked) native.setFrame(this.name, rect.x, rect.y, rect.width, rect.height);
    native.setHidden(this.name, parked);
  }

  /** The presenter stopped showing frames: rebuild the view once, then tell the user. */
  private stopped(code: string): void {
    console.error(`[preview] ${this.name} stopped showing frames: ${code}`);
    const surface = this.surface;
    const rect = this.rect;
    const now = Date.now();
    if (surface !== null && rect && now - this.lastRebuild >= REBUILD_INTERVAL_MS) {
      this.lastRebuild = now;
      this.detach();
      this.show(rect, surface);
      return;
    }
    this.report(code);
  }

  /** Runs a presenter call; a failure is logged and reported. */
  private attempt(what: string, action: () => void): boolean {
    try {
      action();
      return true;
    } catch (error) {
      console.error(`[preview] ${this.name} ${what}`, error);
      this.report(errorCode(error));
      return false;
    }
  }

  private report(code: string): void {
    if (this.failureReported) return;
    this.failureReported = true;
    this.onFailure(code);
  }
}
