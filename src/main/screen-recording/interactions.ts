import { screen } from 'electron';
import { promises as fs } from 'node:fs';
import { acquireInputHook, releaseInputHook, uIOhook } from '../input-hook';
import { interactionLogPath, prepareRecordingData } from './recording-data';

// Pointer path and input activity recorded next to a screen recording, so the
// editor can plan zooms and redraw the pointer afterwards. Only positions,
// button presses, scrolling, the moments keys were typed, and shortcut combos
// (like ⌘⇧S) are kept; never which keys were typed.
export type InteractionLog = {
  version: 2;
  // Captured area in global points; positions below are normalized to it (0..1).
  rect: { x: number; y: number; width: number; height: number };
  // Times are milliseconds on the video clock (paused time removed).
  moves: Array<[number, number, number]>;
  // [time, x, y, button] with button 0 left, 1 right, 2 other.
  clicks: Array<[number, number, number, number]>;
  releases: Array<[number, number, number, number]>;
  // [time, x, y, dx, dy]
  scrolls: Array<[number, number, number, number, number]>;
  keys: number[];
  shortcuts: Array<[number, string]>;
  // True when the video has no pointer in it, so the editor draws one.
  cursorHidden: boolean;
  // Pointer images by id (PNG, size and hotspot in points), and when each was shown.
  cursors: Record<string, { png: string; w: number; h: number; hx: number; hy: number }>;
  cursorChanges: Array<[number, number]>;
  // Where the live camera bubble was left, as a starting point for editing.
  cameraHint?: { position: string; size: number; x?: number; y?: number };
  cameraLayouts?: Array<[number, number, number, number]>;
};

const SAMPLE_INTERVAL_MS = 1000 / 60;
const MAX_SHORTCUT_LENGTH = 24;

const finite = (...values: unknown[]): boolean => values.every((value) => typeof value === 'number' && Number.isFinite(value));

export class InteractionRecorder {
  private startedAt = 0;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private timer: NodeJS.Timeout | null = null;
  private hookRunning = false;
  private external = false;
  private lastMove: [number, number] | null = null;
  private readonly log: InteractionLog;

  constructor(rect: InteractionLog['rect'], private readonly onLog: (line: string) => void, private readonly cameraLayout?: () => { x: number; y: number; size: number } | null) {
    this.log = {
      version: 2,
      rect: { ...rect },
      moves: [],
      clicks: [],
      releases: [],
      scrolls: [],
      keys: [],
      shortcuts: [],
      cursorHidden: false,
      cursors: {},
      cursorChanges: []
    };
  }

  private readonly onMouseDown = (event: { button?: unknown }) => {
    const time = this.now();
    if (time === null) return;
    const [x, y] = this.position();
    this.log.clicks.push([time, x, y, event.button === 2 ? 1 : event.button === 1 || event.button === undefined ? 0 : 2]);
  };

  private readonly onKeyDown = () => {
    const time = this.now();
    if (time !== null) this.log.keys.push(time);
  };

  // Called when the first video frame is being recorded. With `external`, the
  // native recorder reports input on the video clock and nothing is sampled here.
  begin(external = false): void {
    if (this.startedAt !== 0) return;
    this.startedAt = Date.now();
    this.external = external;
    if (this.cameraLayout) {
      this.timer = setInterval(() => {
        if (this.pausedAt !== null) return;
        const layout = this.cameraLayout?.();
        if (!layout) return;
        const rows = this.log.cameraLayouts ??= [];
        const last = rows[rows.length - 1];
        if (last && last[1] === layout.x && last[2] === layout.y && last[3] === layout.size) return;
        rows.push([Date.now() - this.startedAt - this.pausedTotal, layout.x, layout.y, layout.size]);
      }, SAMPLE_INTERVAL_MS);
    }
    if (external) return;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.sample();
    try {
      uIOhook.on('mousedown', this.onMouseDown);
      uIOhook.on('keydown', this.onKeyDown);
      acquireInputHook();
      this.hookRunning = true;
    } catch (error) {
      // Without input access the recording still gets the cursor path.
      uIOhook.off('mousedown', this.onMouseDown);
      uIOhook.off('keydown', this.onKeyDown);
      this.onLog(`Click tracking unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  setCameraHint(hint: InteractionLog['cameraHint'] | null): void {
    if (hint === null) delete this.log.cameraHint;
    else this.log.cameraHint = hint;
  }

  setCursorHidden(hidden: boolean): void {
    this.log.cursorHidden = hidden;
  }

  // Input reported by the native recorder, already on the video clock.
  addMove(time: number, x: number, y: number): void {
    if (finite(time, x, y)) this.log.moves.push([Math.max(0, time), x, y]);
  }

  addButton(down: boolean, time: number, x: number, y: number, button: number): void {
    if (!finite(time, x, y, button)) return;
    (down ? this.log.clicks : this.log.releases).push([Math.max(0, time), x, y, Math.min(2, Math.max(0, Math.round(button)))]);
  }

  addScroll(time: number, x: number, y: number, dx: number, dy: number): void {
    if (finite(time, x, y, dx, dy)) this.log.scrolls.push([Math.max(0, time), x, y, dx, dy]);
  }

  addTyping(time: number): void {
    if (finite(time)) this.log.keys.push(Math.max(0, time));
  }

  addShortcut(time: number, keys: string): void {
    if (finite(time) && keys.length > 0 && keys.length <= MAX_SHORTCUT_LENGTH) this.log.shortcuts.push([Math.max(0, time), keys]);
  }

  // Pointer look reported by the native recorder, timed on the video clock.
  addCursor(time: number, id: number, image: InteractionLog['cursors'][string] | null): void {
    if (image !== null) this.log.cursors[String(id)] = image;
    this.log.cursorChanges.push([Math.max(0, time), id]);
  }

  setPaused(paused: boolean): void {
    if (paused && this.pausedAt === null) this.pausedAt = Date.now();
    if (!paused && this.pausedAt !== null) {
      this.pausedTotal += Date.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    uIOhook.off('mousedown', this.onMouseDown);
    uIOhook.off('keydown', this.onKeyDown);
    if (this.hookRunning) {
      this.hookRunning = false;
      try {
        releaseInputHook();
      } catch (error) {
        this.onLog(`Click tracking did not stop cleanly: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async save(videoPath: string): Promise<void> {
    this.stop();
    if (this.startedAt === 0) return;
    // Native input arrives in order per kind, but sort defensively.
    for (const list of [this.log.moves, this.log.clicks, this.log.releases, this.log.scrolls, this.log.shortcuts, this.log.cursorChanges]) {
      list.sort((a, b) => a[0] - b[0]);
    }
    this.log.keys.sort((a, b) => a - b);
    await prepareRecordingData(videoPath);
    await fs.writeFile(interactionLogPath(videoPath), JSON.stringify(this.log));
  }

  private now(): number | null {
    if (this.external || this.startedAt === 0 || this.timer === null || this.pausedAt !== null) return null;
    return Date.now() - this.startedAt - this.pausedTotal;
  }

  private position(): [number, number] {
    const point = screen.getCursorScreenPoint();
    const { rect } = this.log;
    const round = (value: number) => Math.round(value * 10000) / 10000;
    return [round((point.x - rect.x) / rect.width), round((point.y - rect.y) / rect.height)];
  }

  private sample(): void {
    const time = this.now();
    if (time === null) return;
    const [x, y] = this.position();
    // Only store changes; the editor holds the last position in between.
    if (this.lastMove !== null && this.lastMove[0] === x && this.lastMove[1] === y) return;
    this.lastMove = [x, y];
    this.log.moves.push([time, x, y]);
  }
}
