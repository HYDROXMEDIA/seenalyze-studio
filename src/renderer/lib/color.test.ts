import { describe, expect, test } from "bun:test";
import { formatColor, hsvToRgb, packSourceColor, parseColor, rgbToHsv, toHex, unpackSourceColor } from "./color";

describe("color editor values", () => {
  test("reads hex, CSS colors and transparency without accepting malformed values", () => {
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("#11223380")?.a).toBeCloseTo(128 / 255);
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("transparent")?.a).toBe(0);
    for (const invalid of ["#12", "#nothex", "rgb(...,2,3)", "rgb(300,2,3)", "rgba(1,2,3,2)"]) expect(parseColor(invalid)).toBeNull();
  });

  test("the hue strip covers the standard colors and wraps at red", () => {
    for (const [hue, hex] of [[0, "#FF0000"], [60, "#FFFF00"], [120, "#00FF00"], [180, "#00FFFF"], [240, "#0000FF"], [300, "#FF00FF"], [360, "#FF0000"]] as const) {
      expect(toHex(hsvToRgb({ h: hue, s: 1, v: 1 }))).toBe(hex);
    }
  });

  test("RGB values survive HSV conversion, including black, white and grey", () => {
    for (const hex of ["#000000", "#FFFFFF", "#808080", "#2E83B7", "#F4C67A"]) {
      expect(toHex(hsvToRgb(rgbToHsv(parseColor(hex)!)))).toBe(hex);
    }
  });

  test("source color conversion keeps every opacity byte, including zero", () => {
    for (let alpha = 0; alpha <= 255; alpha += 1) {
      const packed = ((alpha << 24) | 0x563412) >>> 0;
      const rgba = unpackSourceColor(packed);
      expect(rgba.r).toBe(0x12);
      expect(packSourceColor(parseColor(formatColor(rgba))!)).toBe(packed);
    }
  });
});
