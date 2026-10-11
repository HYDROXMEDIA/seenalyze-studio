import type { BrowserWindow, Rectangle, Screen } from "electron";

/** Preferred first-launch size and the smallest size the studio layout is designed for (points). */
export const DEFAULT_WINDOW_SIZE = { width: 1440, height: 900 };
export const MIN_WINDOW_SIZE = { width: 900, height: 600 };

type Size = { width: number; height: number };

/** The minimum size, reduced where a screen is smaller than it (portrait or small screens). */
export function minimumSizeFor(workArea: Rectangle): Size {
  return {
    width: Math.min(MIN_WINDOW_SIZE.width, workArea.width),
    height: Math.min(MIN_WINDOW_SIZE.height, workArea.height),
  };
}

/** First-launch bounds: the preferred size, shrunk to the screen and centred on it. */
export function initialBounds(workArea: Rectangle): Rectangle {
  const width = Math.min(DEFAULT_WINDOW_SIZE.width, workArea.width);
  const height = Math.min(DEFAULT_WINDOW_SIZE.height, workArea.height);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

/** Which top corner holds the window buttons (close/minimise): left on macOS, right elsewhere. */
export type ControlsCorner = "left" | "right";

/** Inset from the corner that must be on a screen for the window buttons to be clickable (points). */
const CONTROLS_INSET = 24;

/**
 * Bounds that keep the whole window usable on its screen, or null when it
 * already is. A window larger than its screen is shrunk to fit, and a window
 * whose title-bar buttons are on no screen at all is moved back. A window the
 * user placed across two screens, or partly past an edge with its buttons
 * still reachable, keeps its place.
 */
export function fittedBounds(bounds: Rectangle, workArea: Rectangle, workAreas: Rectangle[], corner: ControlsCorner): Rectangle | null {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const tooBig = width !== bounds.width || height !== bounds.height;
  const controls = {
    x: corner === "left" ? bounds.x + CONTROLS_INSET : bounds.x + bounds.width - CONTROLS_INSET,
    y: bounds.y + CONTROLS_INSET / 2,
  };
  const controlsVisible = workAreas.some((area) => contains(area, controls));
  if (!tooBig && controlsVisible) return null;
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height);
  return { x, y, width, height };
}

function contains(area: Rectangle, point: { x: number; y: number }): boolean {
  return point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height;
}

/**
 * Keeps a window usable on every screen: its minimum size never exceeds the
 * screen it is on, and it is pulled back inside that screen when it no longer
 * fits (moved to a smaller screen, resolution or arrangement changed).
 */
export function keepWindowOnScreen(window: BrowserWindow, screen: Screen): void {
  const fit = () => {
    if (window.isDestroyed() || window.isFullScreen() || window.isMinimized()) return;
    const { workArea } = screen.getDisplayMatching(window.getBounds());
    const min = minimumSizeFor(workArea);
    window.setMinimumSize(min.width, min.height);
    const workAreas = screen.getAllDisplays().map((display) => display.workArea);
    const corner: ControlsCorner = process.platform === "darwin" ? "left" : "right";
    const next = fittedBounds(window.getBounds(), workArea, workAreas, corner);
    if (next) window.setBounds(next);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Screen changes arrive in bursts (and `moved` fires repeatedly on Windows); fit once they settle.
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(fit, 150);
  };
  fit();
  window.on("moved", schedule);
  window.on("leave-full-screen", schedule);
  screen.on("display-metrics-changed", schedule);
  screen.on("display-removed", schedule);
  screen.on("display-added", schedule);
  window.once("closed", () => {
    clearTimeout(timer);
    screen.off("display-metrics-changed", schedule);
    screen.off("display-removed", schedule);
    screen.off("display-added", schedule);
  });
}
