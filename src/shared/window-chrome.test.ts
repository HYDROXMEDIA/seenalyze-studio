import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FULL_SCREEN_TITLE_BAR_CSS,
  macOSMajorVersion,
  RECORDING_EDITOR_TITLE_BAR,
  STUDIO_TITLE_BAR,
  TRAFFIC_LIGHT_SIZE,
  titleBarCss,
  trafficLightGroupWidth,
  trafficLightPosition,
  trafficLightReserve,
} from "./window-chrome";

const read = (file: string) => readFileSync(path.join(import.meta.dir, "..", file), "utf8");

describe("window chrome", () => {
  test("the traffic lights are centred on every title bar", () => {
    for (const bar of [STUDIO_TITLE_BAR, RECORDING_EDITOR_TITLE_BAR]) {
      const { x, y } = trafficLightPosition(bar);
      expect(x).toBe(bar.inset);
      // Electron needs whole points; an even bar height keeps the centre exact.
      expect(bar.height % 2).toBe(0);
      expect(y + TRAFFIC_LIGHT_SIZE / 2).toBe(bar.height / 2);
    }
    expect(trafficLightPosition(STUDIO_TITLE_BAR)).toEqual({ x: 16, y: 17 });
    expect(trafficLightPosition(RECORDING_EDITOR_TITLE_BAR)).toEqual({ x: 14, y: 19 });
  });

  test("the reserved room matches the buttons' real width on each macOS", () => {
    // Measured with NSWindow.standardWindowButton: 14 pt buttons, 23 pt apart from macOS 26, 20 pt before.
    expect(trafficLightGroupWidth(27)).toBe(60);
    expect(trafficLightGroupWidth(26)).toBe(60);
    expect(trafficLightGroupWidth(15)).toBe(54);
    expect(trafficLightReserve(STUDIO_TITLE_BAR, 26)).toBe(16 + 60 + 12);
    expect(trafficLightReserve(STUDIO_TITLE_BAR, 14)).toBe(16 + 54 + 12);
  });

  test("reads the macOS major version", () => {
    expect(macOSMajorVersion("26.1.0")).toBe(26);
    expect(macOSMajorVersion("15.7")).toBe(15);
    expect(macOSMajorVersion("")).toBe(0);
    expect(macOSMajorVersion("10.0.26100")).toBe(10);
  });

  test("only macOS keeps room for window buttons at the leading edge", () => {
    expect(titleBarCss(STUDIO_TITLE_BAR, "darwin", 26)).toBe(":root { --titlebar-height: 48px; --traffic-light-reserve: 88px; }");
    expect(titleBarCss(STUDIO_TITLE_BAR, "win32", 0)).toBe(":root { --titlebar-height: 48px; --traffic-light-reserve: 0px; }");
    // Wins over the preload's rule while the window is in full screen.
    expect(FULL_SCREEN_TITLE_BAR_CSS.startsWith(":root:root")).toBe(true);
  });

  test("the pages size their title bars from the shared variables", () => {
    const editor = read("renderer/screen-recording/editor/editor.css");
    expect(editor).toContain("min-height: var(--titlebar-height);");
    expect(editor).toContain("env(titlebar-area-x, var(--traffic-light-reserve))");
    const styles = read("renderer/styles.css");
    expect(styles).toContain("block-size: var(--titlebar-height);");
    expect(read("renderer/features/Header.tsx")).toContain("app-titlebar");
  });
});
