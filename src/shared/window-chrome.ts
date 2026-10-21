// Window chrome geometry shared by the main process (where macOS draws its
// window buttons, how tall the Windows caption buttons are) and the pages
// (title-bar heights, room kept free for the buttons). Both sides read these
// numbers so the buttons and the custom title bars always line up.

/** A macOS window button (close, minimize, zoom) is a 14 × 14 pt circle. */
export const TRAFFIC_LIGHT_SIZE = 14;

/** Space between two macOS window buttons: 9 pt from macOS 26, 6 pt before. */
export function trafficLightGap(macOSMajor: number): number {
  return macOSMajor >= 26 ? 9 : 6;
}

/** Width of the three macOS window buttons together. */
export function trafficLightGroupWidth(macOSMajor: number): number {
  return 3 * TRAFFIC_LIGHT_SIZE + 2 * trafficLightGap(macOSMajor);
}

/** The macOS major version from `process.getSystemVersion()` ("26.1.0" → 26); 0 when unknown. */
export function macOSMajorVersion(systemVersion: string): number {
  const major = Number.parseInt(systemVersion.split(".")[0] ?? "", 10);
  return Number.isFinite(major) && major > 0 ? major : 0;
}

/** A custom title bar: its height (without a bottom border) and the window buttons' leading inset. */
export interface TitleBar {
  height: number;
  inset: number;
  /** Space between the window buttons and the first item after them. */
  gap: number;
}

/** The studio window's header (`Header.tsx`): its padding is the buttons' inset. */
export const STUDIO_TITLE_BAR: TitleBar = { height: 48, inset: 16, gap: 12 };

/** The recording editor's toolbar; Windows draws its caption buttons over it at the same height. */
export const RECORDING_EDITOR_TITLE_BAR: TitleBar = { height: 52, inset: 14, gap: 12 };

/**
 * `trafficLightPosition` for a title bar: the buttons centred on it vertically,
 * at its leading inset. Electron places the buttons' top edge at `y`.
 */
export function trafficLightPosition(bar: TitleBar): { x: number; y: number } {
  return { x: bar.inset, y: Math.round((bar.height - TRAFFIC_LIGHT_SIZE) / 2) };
}

/** Room a title bar keeps free at its leading edge for the macOS window buttons. */
export function trafficLightReserve(bar: TitleBar, macOSMajor: number): number {
  return bar.inset + trafficLightGroupWidth(macOSMajor) + bar.gap;
}

/**
 * CSS custom properties for a page's title bar: `--titlebar-height` and
 * `--traffic-light-reserve` (0 where no window buttons overlap the page).
 */
export function titleBarCss(bar: TitleBar, platform: string, macOSMajor: number): string {
  const reserve = platform === "darwin" ? trafficLightReserve(bar, macOSMajor) : 0;
  return `:root { --titlebar-height: ${bar.height}px; --traffic-light-reserve: ${reserve}px; }`;
}

/** Applied while a macOS window is in full screen, where its window buttons are hidden. */
export const FULL_SCREEN_TITLE_BAR_CSS = ":root:root { --traffic-light-reserve: 0px; }";
