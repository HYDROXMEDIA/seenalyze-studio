import { describe, expect, test } from "bun:test";
import { parseColor } from "./color";
import {
  COLOR_PRESETS,
  CUSTOM_THEME_ID,
  DEFAULT_COLOR_THEME,
  THEME_ROLES,
  findPreset,
  parseColorThemeChoice,
  presetRoles,
  resolveThemeRoles,
  seedCustomRoles,
  themeCssVariables,
} from "./color-theme";

const HEX = /^#[0-9A-F]{6}$/u;

describe("color presets", () => {
  test("every preset derives valid roles for both appearances", () => {
    for (const preset of COLOR_PRESETS) {
      for (const variant of ["light", "dark"] as const) {
        const roles = presetRoles(preset, variant);
        for (const role of THEME_ROLES) expect(roles[role]).toMatch(HEX);
      }
    }
  });

  test("preset ids are unique", () => {
    const ids = COLOR_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("neutral keeps the stylesheet defaults", () => {
    expect(resolveThemeRoles(DEFAULT_COLOR_THEME, "dark")).toBeNull();
    expect(resolveThemeRoles(DEFAULT_COLOR_THEME, "light")).toBeNull();
  });
});

describe("css variables", () => {
  test("primary text is readable on the primary color", () => {
    const red = themeCssVariables(presetRoles(findPreset("red")!, "light"));
    expect(red["--primary-foreground"]).toBe("#FFFFFF");
    const yellow = themeCssVariables(presetRoles(findPreset("cyberYellow")!, "light"));
    expect(yellow["--primary-foreground"]).toBe("#000000");
  });

  test("covers every variable the stylesheet defines for the theme", () => {
    const names = Object.keys(themeCssVariables(presetRoles(COLOR_PRESETS[1], "dark")));
    for (const name of ["--background", "--card", "--primary", "--accent", "--border", "--live", "--muted-foreground", "--surface"]) {
      expect(names).toContain(name);
    }
  });
});

describe("custom themes", () => {
  test("seeds from the current preset for both appearances", () => {
    const seeded = seedCustomRoles({ id: "blue", custom: null });
    expect(seeded.light).toEqual(presetRoles(findPreset("blue")!, "light"));
    expect(seeded.dark).toEqual(presetRoles(findPreset("blue")!, "dark"));
  });

  test("seeds from the neutral look when no preset is set", () => {
    const seeded = seedCustomRoles(DEFAULT_COLOR_THEME);
    expect(seeded.dark.primary).toBe("#FAFAFA");
    expect(seeded.light.primary).toBe("#171717");
  });

  test("accepts a valid stored palette and normalizes it to hex", () => {
    const roles = Object.fromEntries(THEME_ROLES.map((role) => [role, "#abcdef"]));
    const choice = parseColorThemeChoice({ id: CUSTOM_THEME_ID, custom: { light: roles, dark: roles } });
    expect(choice.id).toBe(CUSTOM_THEME_ID);
    expect(choice.custom?.dark.primary).toBe("#ABCDEF");
  });

  test("rejects a stored palette with an invalid or missing role", () => {
    const roles = Object.fromEntries(THEME_ROLES.map((role) => [role, "#000000"]));
    const broken = { ...roles, live: "not-a-color" };
    expect(parseColorThemeChoice({ id: CUSTOM_THEME_ID, custom: { light: broken, dark: roles } })).toEqual(DEFAULT_COLOR_THEME);
    const missing = Object.fromEntries(Object.entries(roles).filter(([role]) => role !== "live"));
    expect(parseColorThemeChoice({ id: CUSTOM_THEME_ID, custom: { light: missing, dark: roles } })).toEqual(DEFAULT_COLOR_THEME);
  });

  test("falls back to the default for unknown presets and malformed input", () => {
    expect(parseColorThemeChoice({ id: "not-a-preset" })).toEqual(DEFAULT_COLOR_THEME);
    expect(parseColorThemeChoice(null)).toEqual(DEFAULT_COLOR_THEME);
    expect(parseColorThemeChoice("red")).toEqual(DEFAULT_COLOR_THEME);
    expect(parseColorThemeChoice({ id: "red" })).toEqual({ id: "red", custom: null });
  });

  test("custom palettes keep their colors in the resolved roles", () => {
    const seeded = seedCustomRoles({ id: "green", custom: null });
    const choice = { id: CUSTOM_THEME_ID, custom: seeded };
    expect(resolveThemeRoles(choice, "dark")?.primary).toBe(seeded.dark.primary);
    expect(parseColor(resolveThemeRoles(choice, "light")!.primary)).not.toBeNull();
  });
});
