// Contrast of the stylesheet theme tokens in both appearances, computed from the CSS itself
// (there is no DOM harness): text pairs need 4.5:1 (WCAG AA), focus rings and selection
// borders 3:1. Color themes are checked in lib/color-theme.test.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { contrastRatio } from "./lib/color-theme";

type Rgba = { r: number; g: number; b: number; a: number };

function oklch(l: number, c: number, h: number, a: number): Rgba {
  const hue = (h * Math.PI) / 180;
  const [A, B] = [c * Math.cos(hue), c * Math.sin(hue)];
  const [lc, mc, sc] = [l + 0.3963377774 * A + 0.2158037573 * B, l - 0.1055613458 * A - 0.0638541728 * B, l - 0.0894841775 * A - 1.291485548 * B].map((v) => v ** 3);
  const linear = [4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc, -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc, -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc];
  const [r, g, b] = linear.map((v) => 255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
  return { r, g, b, a };
}

function parse(value: string): Rgba {
  const text = value.trim();
  const lch = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%)?\)$/u.exec(text);
  if (lch) return oklch(Number(lch[1]), Number(lch[2]), Number(lch[3]), lch[4] ? Number(lch[4]) / 100 : 1);
  const hex = /^#([0-9a-f]{6})$/iu.exec(text);
  if (hex) return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: 1 };
  const rgba = /^rgba?\(([^)]+)\)$/u.exec(text);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(/[\s,/]+/u).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  throw new Error(`unsupported color ${text}`);
}

const over = (top: Rgba, bottom: Rgba): Rgba => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
const hex = (color: Rgba) => "#" + [color.r, color.g, color.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** The custom properties declared in the first rule with exactly this selector. */
function tokens(file: string, selector: string): Record<string, string> {
  const css = "\n" + readFileSync(path.join(import.meta.dir, file), "utf8");
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`${selector} not found in ${file}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/gu)].map((match) => [match[1], match[2].trim()]));
}

/** Contrast of `foreground` painted over the layered backgrounds (topmost last), on an opaque base. */
function ratio(theme: Record<string, string>, foreground: string, layers: string[], base: string): number {
  const color = (name: string) => parse(name.startsWith("#") ? name : theme[name]);
  let backdrop = parse(base);
  for (const layer of layers) backdrop = over(color(layer), backdrop);
  return contrastRatio(hex(over(color(foreground), backdrop)), hex(backdrop));
}

describe("studio stylesheet tokens", () => {
  const light = tokens("styles.css", ":root");
  const dark = { ...light, ...tokens("styles.css", ".dark") };
  for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
    test(`${name}: text, focus rings and live badges meet WCAG AA`, () => {
      const background = theme.background;
      const check = (foreground: string, layers: string[], minimum: number) => {
        const value = ratio(theme, foreground, layers, background);
        expect({ pair: `${foreground} on ${layers.join(" over ") || "background"}`, ok: value >= minimum, value: Math.round(value * 100) / 100 }).toMatchObject({ ok: true });
      };
      check("foreground", [], 4.5);
      for (const surface of ["card", "popover", "muted", "accent", "secondary", "surface"]) check("muted-foreground", [surface], 4.5);
      check("secondary-foreground", ["secondary"], 4.5);
      check("accent-foreground", ["accent"], 4.5);
      check("primary-foreground", ["primary"], 4.5);
      check("destructive", [], 4.5);
      check("#ffffff", ["live"], 4.5);
      check("ring", [], 3);
      check("primary", [], 3);
    });
  }
});

describe("screen recording editor tokens", () => {
  const dark = tokens("screen-recording/editor/editor.css", ":root");
  const light = { ...dark, ...tokens("screen-recording/editor/editor.css", "body[data-theme='light']") };
  for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
    test(`${name}: text and the selected segment meet WCAG AA`, () => {
      const check = (foreground: string, layers: string[], minimum: number) => {
        const value = ratio(theme, foreground, layers, theme.window);
        expect({ pair: `${foreground} on ${layers.join(" over ")}`, ok: value >= minimum, value: Math.round(value * 100) / 100 }).toMatchObject({ ok: true });
      };
      for (const surface of [["panel"], ["stage"], ["dialog"], ["panel", "control"]]) {
        check("text", surface, 4.5);
        check("secondary", surface, 4.5);
      }
      check("accent", ["panel", "control", "selected"], 4.5);
      check("accent", ["dialog"], 4.5);
      check("accent-ink", ["accent"], 4.5);
      check("accent", ["panel"], 3);
    });
  }
});
