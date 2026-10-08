// Contract between a projector window and the main process. Projector windows
// get only this small API (src/preload/projector.ts), never the studio API.
// No Electron/Node imports: the renderer uses this too.

import type { MenuEntry } from "./ipc";
import type { ProjectorTarget, Rect, ScreenChoice } from "./types";

/** Scenes a multiview shows besides the preview and the program. */
export const MULTIVIEW_SCENES = 8;

export interface ProjectorCell {
  role: "preview" | "program" | "scene" | "source";
  /** Scene or source name (the shown scene for preview/program); null when there is none. */
  name: string | null;
  /** The cell's scene is on the program output. */
  live: boolean;
  /** The cell's scene is in the studio-mode preview. */
  previewing: boolean;
}

export interface ProjectorView {
  target: ProjectorTarget;
  /** Canvas width / height. */
  aspect: number;
  fullscreen: boolean;
  studioMode: boolean;
  cells: ProjectorCell[];
  screens: ScreenChoice[];
}

export interface ProjectorApi {
  getView(): Promise<ProjectorView | null>;
  /**
   * Where each cell's picture goes (CSS pixels, null when not shown), in cell
   * order, and the page's devicePixelRatio; reported again when either changes.
   */
  setCells(rects: (Rect | null)[], pixelRatio: number): Promise<void>;
  /** Multiview: a click on a cell puts its scene in the preview (studio mode) or on the program. */
  pick(index: number): Promise<void>;
  /** Fills a screen; null leaves full screen. */
  setFullscreen(screenId: number | null): Promise<void>;
  /** Native menu at the pointer; resolves with the chosen index or null. */
  showMenu(entries: MenuEntry[]): Promise<number | null>;
  close(): Promise<void>;
  onView(listener: (view: ProjectorView) => void): () => void;
}

export const PROJECTOR_IPC = {
  invoke: "projector:invoke",
  view: "projector:view",
} as const;

export const PROJECTOR_METHODS = ["getView", "setCells", "pick", "setFullscreen", "showMenu", "close"] as const;
export type ProjectorMethod = (typeof PROJECTOR_METHODS)[number];

/** Cells a projector shows for its target, in order. */
export function projectorCells(
  target: ProjectorTarget,
  context: { studioMode: boolean; programScene: string | null; previewScene: string | null; scenes: readonly string[] },
): ProjectorCell[] {
  const { studioMode, programScene, previewScene } = context;
  const shownInPreview = studioMode ? previewScene : programScene;
  const preview: ProjectorCell = { role: "preview", name: shownInPreview, live: !studioMode, previewing: studioMode };
  const program: ProjectorCell = { role: "program", name: programScene, live: true, previewing: false };
  const scene = (name: string): ProjectorCell => ({ role: "scene", name, live: name === programScene, previewing: studioMode && name === previewScene });
  switch (target.kind) {
    case "program":
      return [program];
    case "preview":
      return [preview];
    case "scene":
      return [scene(target.name)];
    case "source":
      return [{ role: "source", name: target.name, live: false, previewing: false }];
    case "multiview":
      return [preview, program, ...context.scenes.slice(0, MULTIVIEW_SCENES).map(scene)];
  }
}

/** Validates a projector target from IPC. */
export function sanitizeProjectorTarget(value: unknown): ProjectorTarget | null {
  if (!value || typeof value !== "object") return null;
  const { kind, name } = value as { kind?: unknown; name?: unknown };
  if (kind === "program" || kind === "preview" || kind === "multiview") return { kind };
  if ((kind === "scene" || kind === "source") && typeof name === "string" && name.length > 0 && name.length <= 256) return { kind, name };
  return null;
}
