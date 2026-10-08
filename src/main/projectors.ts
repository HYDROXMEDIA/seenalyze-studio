// Projector windows: the program, the studio-mode preview, a scene, a source,
// or a multiview (preview, program and up to eight scenes), in a window or
// filling a chosen screen. Each picture is its own engine display
// (native-display.ts). The page (`#projector`) lays the pictures out and
// reports where they go; it talks only through the projector bridge, and
// every call is checked to come from a projector window.

import { BrowserWindow, ipcMain, Menu, screen, type Display, type IpcMainInvokeEvent } from "electron";
import type { MenuEntry } from "../shared/ipc";
import { STUDIO_ERROR_PREFIX } from "../shared/ipc";
import { PROJECTOR_IPC, PROJECTOR_METHODS, projectorCells, type ProjectorCell, type ProjectorMethod, type ProjectorView } from "../shared/projector";
import type { DisplaySpec, ProjectorTarget, Rect, ScreenChoice } from "../shared/types";
import type { EngineClient } from "./engine/client";
import { NativeDisplay } from "./native-display";

export const PROJECTOR_HASH = "projector";
const MAX_PROJECTORS = 16;
const MAX_CELLS = 10;
const FULLSCREEN_SWITCH_TIMEOUT_MS = 1500;
const TEARDOWN_TIMEOUT_MS = 2000;

export interface ProjectorContext {
  /** The engine runs and its state is known. */
  ready: boolean;
  studioMode: boolean;
  programScene: string | null;
  previewScene: string | null;
  scenes: string[];
  /** Sources a source projector can show. */
  sources: string[];
  /** Canvas width / height. */
  aspect: number;
}

export interface ProjectorHost {
  engine: EngineClient;
  context(): ProjectorContext;
  /** A multiview click on a scene. */
  pickScene(name: string): Promise<void>;
  preload: string;
  load(window: BrowserWindow): void;
  /** The sender's page is the app's own UI. */
  isAppUrl(url: string): boolean;
}

export function screenChoices(): ScreenChoice[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    label: display.label || `${display.size.width} × ${display.size.height}`,
    primary: display.id === primary,
  }));
}

function cellSpec(cell: ProjectorCell, studioMode: boolean): DisplaySpec {
  switch (cell.role) {
    case "preview":
      return studioMode && cell.name ? { kind: "studioPreview" } : { kind: "program" };
    case "program":
      return { kind: "program" };
    case "scene":
      return { kind: "scene", name: cell.name ?? "" };
    case "source":
      return { kind: "source", name: cell.name ?? "" };
  }
}

function targetExists(target: ProjectorTarget, context: ProjectorContext): boolean {
  if (target.kind === "scene") return context.scenes.includes(target.name);
  if (target.kind === "source") return context.sources.includes(target.name);
  return true;
}

function validRect(value: unknown): Rect | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const numbers = [x, y, width, height];
  if (!numbers.every((entry) => typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) < 100_000)) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

class Projector {
  readonly window: BrowserWindow;
  private displays: NativeDisplay[] = [];
  private specs: string[] = [];
  private cells: ProjectorCell[] = [];
  /** Cell rects in window points. */
  private rects: (Rect | null)[] = [];
  /** Backing scale from the page's devicePixelRatio (0 until reported). */
  private scale = 0;
  private queue: Promise<void> = Promise.resolve();
  private closing = false;
  private lastView = "";

  constructor(
    readonly id: number,
    readonly target: ProjectorTarget,
    private readonly host: ProjectorHost,
    screenId: number | null,
    private readonly onClosed: () => void,
  ) {
    const fill = screenId === null ? undefined : screen.getAllDisplays().find((display) => display.id === screenId);
    const anchor = fill ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.window = new BrowserWindow({
      ...this.windowBounds(anchor),
      show: false,
      backgroundColor: "#000000",
      autoHideMenuBar: true,
      fullscreenable: true,
      minWidth: 240,
      minHeight: 160,
      webPreferences: {
        preload: host.preload,
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
    // Esc closes a projector that fills a screen.
    contents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape" && this.window.isFullScreen()) {
        event.preventDefault();
        this.window.close();
      }
    });
    this.window.once("ready-to-show", () => {
      this.window.show();
      if (fill) this.window.setFullScreen(true);
    });
    for (const event of ["enter-full-screen", "leave-full-screen"] as const) this.window.on(event as "enter-full-screen", () => this.pushView());
    // The page may report its layout before the window is first shown.
    this.window.on("show", () => this.apply());
    this.window.on("minimize", () => this.apply());
    this.window.on("restore", () => this.apply());
    this.window.on("close", (event) => {
      if (this.closing) return;
      event.preventDefault();
      void this.teardown().finally(() => {
        if (!this.window.isDestroyed()) this.window.destroy();
      });
    });
    this.window.on("closed", () => this.onClosed());
    this.refresh();
    host.load(this.window);
  }

  get webContentsId(): number | null {
    return this.window.isDestroyed() ? null : this.window.webContents.id;
  }

  private windowBounds(display: Display): Electron.Rectangle {
    const area = display.workArea;
    const aspect = this.target.kind === "source" ? 16 / 9 : this.host.context().aspect || 16 / 9;
    const width = Math.round(Math.min(960, area.width * 0.6));
    const height = Math.round(Math.min(area.height * 0.8, width / aspect));
    return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
  }

  view(): ProjectorView {
    const context = this.host.context();
    return {
      target: this.target,
      aspect: context.aspect || 16 / 9,
      fullscreen: !this.window.isDestroyed() && this.window.isFullScreen(),
      studioMode: context.studioMode,
      cells: this.cells,
      screens: screenChoices(),
    };
  }

  /** Follows scene, studio-mode and screen changes; closes when the target is gone. */
  refresh(): void {
    if (this.closing || this.window.isDestroyed()) return;
    const context = this.host.context();
    if (context.ready && !targetExists(this.target, context)) {
      this.window.close();
      return;
    }
    this.cells = projectorCells(this.target, context).slice(0, MAX_CELLS);
    const specs = this.cells.map((cell) => cellSpec(cell, context.studioMode));
    let changed = specs.length !== this.displays.length;
    specs.forEach((spec, index) => {
      const key = JSON.stringify(spec);
      if (!this.displays[index]) {
        this.displays[index] = new NativeDisplay(this.host.engine, this.window, `seenalyze-projector-${this.id}-${index}`, spec);
      } else if (this.specs[index] !== key) {
        this.displays[index].spec = spec;
        changed = true;
      }
      this.specs[index] = key;
    });
    const removed = this.displays.splice(specs.length);
    this.specs.length = specs.length;
    if (removed.length > 0) this.enqueue(async () => void (await Promise.all(removed.map((display) => display.hide()))));
    this.pushView();
    if (changed) this.apply();
  }

  setCells(rects: unknown, pixelRatio: unknown): void {
    if (!Array.isArray(rects) || rects.length > MAX_CELLS) throw new Error("invalid-request");
    const zoom = this.window.webContents.getZoomFactor();
    const factor = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    this.rects = rects.map((entry) => {
      const rect = validRect(entry);
      return rect && { x: Math.round(rect.x * factor), y: Math.round(rect.y * factor), width: Math.round(rect.width * factor), height: Math.round(rect.height * factor) };
    });
    if (typeof pixelRatio === "number" && Number.isFinite(pixelRatio) && pixelRatio > 0) this.scale = Math.round((pixelRatio / factor) * 100) / 100;
    this.apply();
  }

  async pick(index: unknown): Promise<void> {
    const cell = typeof index === "number" ? this.cells[index] : undefined;
    if (cell?.role === "scene" && cell.name) await this.host.pickScene(cell.name);
  }

  async setFullscreen(screenId: unknown): Promise<void> {
    if (screenId === null) {
      if (this.window.isFullScreen()) this.window.setFullScreen(false);
      return;
    }
    const target = screen.getAllDisplays().find((display) => display.id === screenId);
    if (!target) throw new Error("invalid-request");
    if (this.window.isFullScreen()) {
      if (screen.getDisplayMatching(this.window.getBounds()).id === target.id) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, FULLSCREEN_SWITCH_TIMEOUT_MS);
        this.window.once("leave-full-screen", () => {
          clearTimeout(timer);
          resolve();
        });
        this.window.setFullScreen(false);
      });
    }
    if (this.window.isDestroyed()) return;
    this.window.setBounds(this.windowBounds(target));
    this.window.setFullScreen(true);
  }

  showMenu(entries: unknown): Promise<number | null> {
    if (!Array.isArray(entries) || entries.length > 40) throw new Error("invalid-request");
    return new Promise((resolve) => {
      let chosen: number | null = null;
      const menu = Menu.buildFromTemplate(
        (entries as MenuEntry[]).map((entry, index) =>
          entry?.separator
            ? { type: "separator" as const }
            : { label: String(entry?.label ?? ""), enabled: entry?.enabled !== false, click: () => (chosen = index) },
        ),
      );
      // The close callback can run before the item's click; settle after both.
      menu.popup({ window: this.window, callback: () => setTimeout(() => resolve(chosen), 0) });
    });
  }

  /** Shows every cell's display where the page put it (nothing while minimized). */
  apply(): void {
    this.enqueue(async () => {
      const context = this.host.context();
      if (!context.ready || this.closing || this.window.isDestroyed()) return;
      const visible = this.window.isVisible() && !this.window.isMinimized();
      const scale = this.scale || screen.getDisplayMatching(this.window.getBounds()).scaleFactor;
      const alive = () => !this.closing && !this.window.isDestroyed() && this.host.context().ready;
      for (const [index, display] of this.displays.entries()) {
        if (!alive()) return;
        try {
          await display.show(visible ? (this.rects[index] ?? null) : null, scale, alive);
        } catch (error) {
          console.error(`[projector] display ${display.name} failed`, error);
        }
      }
    });
  }

  /** The engine stopped: its displays are gone. */
  reset(): void {
    for (const display of this.displays) display.reset();
  }

  /** The canvas changed: every display is made again. */
  rebuild(): void {
    const displays = [...this.displays];
    this.enqueue(async () => void (await Promise.all(displays.map((display) => display.hide()))));
    this.apply();
  }

  /** Removes every view (synchronously) and engine display (bounded). */
  async teardown(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    for (const display of this.displays) display.reset();
    const displays = this.displays;
    this.displays = [];
    // The engine displays must go before their window does (Windows child windows).
    const removal = this.queue.then(() =>
      Promise.all(displays.map((display) => this.host.engine.call("hidePreview", display.name).catch(() => undefined))),
    );
    await Promise.race([removal, new Promise((resolve) => setTimeout(resolve, TEARDOWN_TIMEOUT_MS))]);
  }

  private pushView(): void {
    if (this.window.isDestroyed()) return;
    const view = this.view();
    const serialized = JSON.stringify(view);
    if (serialized === this.lastView) return;
    this.lastView = serialized;
    this.window.webContents.send(PROJECTOR_IPC.view, view);
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => console.error("[projector] update failed", error));
  }
}

export class Projectors {
  private readonly open = new Map<number, Projector>();
  private nextId = 1;

  constructor(private readonly host: ProjectorHost) {
    ipcMain.handle(PROJECTOR_IPC.invoke, (event, method: unknown, args: unknown) => this.invoke(event, method, args));
    const screensChanged = () => this.refresh();
    screen.on("display-added", screensChanged);
    screen.on("display-removed", screensChanged);
    screen.on("display-metrics-changed", screensChanged);
  }

  openProjector(target: ProjectorTarget, screenId: number | null): void {
    if (screenId !== null && !screen.getAllDisplays().some((display) => display.id === screenId)) throw new Error("invalid-request");
    if (!targetExists(target, this.host.context())) throw new Error("invalid-request");
    if (this.open.size >= MAX_PROJECTORS) throw new Error("invalid-request");
    const id = this.nextId++;
    this.open.set(id, new Projector(id, target, this.host, screenId, () => this.open.delete(id)));
  }

  /** Scenes, studio mode or screens changed. */
  refresh(): void {
    for (const projector of this.open.values()) projector.refresh();
  }

  /** The engine (re)started: show every picture again. */
  reapply(): void {
    for (const projector of this.open.values()) {
      projector.refresh();
      projector.apply();
    }
  }

  /** The engine stopped. */
  reset(): void {
    for (const projector of this.open.values()) projector.reset();
  }

  /** The canvas changed. */
  rebuild(): void {
    for (const projector of this.open.values()) projector.rebuild();
  }

  /** Closes projectors that show a scene or source about to go away. */
  async closeShowing(kind: "scene" | "source", name: string): Promise<void> {
    const closing = [...this.open.values()].filter((projector) => projector.target.kind === kind && (projector.target as { name: string }).name === name);
    await Promise.all(closing.map((projector) => projector.teardown()));
    for (const projector of closing) if (!projector.window.isDestroyed()) projector.window.destroy();
  }

  async closeAll(): Promise<void> {
    const all = [...this.open.values()];
    await Promise.all(all.map((projector) => projector.teardown()));
    for (const projector of all) if (!projector.window.isDestroyed()) projector.window.destroy();
  }

  private find(event: IpcMainInvokeEvent): Projector | undefined {
    for (const projector of this.open.values()) if (projector.webContentsId === event.sender.id) return projector;
    return undefined;
  }

  private async invoke(event: IpcMainInvokeEvent, method: unknown, args: unknown): Promise<unknown> {
    const projector = this.find(event);
    if (!projector || !this.host.isAppUrl(event.senderFrame?.url ?? "")) throw new Error(`${STUDIO_ERROR_PREFIX}forbidden`);
    if (typeof method !== "string" || !(PROJECTOR_METHODS as readonly string[]).includes(method) || !Array.isArray(args)) {
      throw new Error(`${STUDIO_ERROR_PREFIX}invalid-request`);
    }
    try {
      switch (method as ProjectorMethod) {
        case "getView":
          return projector.view();
        case "setCells":
          return projector.setCells(args[0], args[1]);
        case "pick":
          return await projector.pick(args[0]);
        case "setFullscreen":
          return await projector.setFullscreen(args[0]);
        case "showMenu":
          return await projector.showMenu(args[0]);
        case "close":
          projector.window.close();
          return undefined;
      }
    } catch (error) {
      console.error(`[projector] ${method} failed`, error);
      const message = error instanceof Error && /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(error.message) ? error.message : "generic";
      throw new Error(`${STUDIO_ERROR_PREFIX}${message}`, { cause: error });
    }
    return undefined;
  }
}
