import { describe, expect, test } from "bun:test";
import { softwareFallback } from "./encoder-fallback";

const windowsNvidia = [
  { id: "nvenc", hardware: true },
  { id: "qsv", hardware: true },
  { id: "x264", hardware: false },
];

describe("software encoder fallback", () => {
  test("a failed graphics-card encoder moves to the software encoder", () => {
    expect(softwareFallback(windowsNvidia, "nvenc")).toBe("x264");
    expect(softwareFallback(windowsNvidia, "qsv")).toBe("x264");
    expect(softwareFallback([{ id: "amd", hardware: true }, { id: "x264", hardware: false }], "amd")).toBe("x264");
  });

  test("no switch when already on software, unknown, or no software encoder exists", () => {
    expect(softwareFallback(windowsNvidia, "x264")).toBeNull();
    expect(softwareFallback(windowsNvidia, "missing")).toBeNull();
    expect(softwareFallback(windowsNvidia, null)).toBeNull();
    expect(softwareFallback([{ id: "nvenc", hardware: true }], "nvenc")).toBeNull();
    expect(softwareFallback([], "nvenc")).toBeNull();
  });
});
