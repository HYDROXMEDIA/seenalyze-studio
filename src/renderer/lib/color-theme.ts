// Color themes: a palette of named roles per appearance (light or dark), turned into the CSS variables the UI reads.

import { clamp, parseColor, toHex, type Rgba } from "./color";

export type ThemeVariant = "light" | "dark";

/** The UI roles a user can recolor. Everything else is derived from them. */
export const THEME_ROLES = ["background", "card", "foreground", "primary", "accent", "border", "live"] as const;
export type ThemeRole = (typeof THEME_ROLES)[number];
export type ThemeRoles = Record<ThemeRole, string>;

export interface ColorPreset {
  id: string;
  group: "classic" | "vibrant";
  primary: Record<ThemeVariant, string>;
}

const same = (hex: string): Record<ThemeVariant, string> => ({ light: hex, dark: hex });

/** Popular colors first, then vibrant ones. "neutral" is the app's original look and sets no overrides. */
export const COLOR_PRESETS: readonly ColorPreset[] = [
  { id: "neutral", group: "classic", primary: { light: "#171717", dark: "#FAFAFA" } },
  { id: "red", group: "classic", primary: same("#EF4444") },
  { id: "orange", group: "classic", primary: same("#F97316") },
  { id: "amber", group: "classic", primary: same("#F59E0B") },
  { id: "green", group: "classic", primary: same("#22C55E") },
  { id: "teal", group: "classic", primary: same("#14B8A6") },
  { id: "blue", group: "classic", primary: same("#3B82F6") },
  { id: "indigo", group: "classic", primary: same("#6366F1") },
  { id: "violet", group: "classic", primary: same("#8B5CF6") },
  { id: "pink", group: "classic", primary: same("#EC4899") },
  { id: "neonMint", group: "vibrant", primary: same("#00FFDE") },
  { id: "electricLime", group: "vibrant", primary: same("#B8FF2C") },
  { id: "hotPink", group: "vibrant", primary: same("#FF2D95") },
  { id: "cyberYellow", group: "vibrant", primary: same("#FFD60A") },
  { id: "sunset", group: "vibrant", primary: same("#FF6B35") },
  { id: "electricPurple", group: "vibrant", primary: same("#B026FF") },
  { id: "lagoon", group: "vibrant", primary: same("#00B4FF") },
];

export const NEUTRAL_PRESET_ID = "neutral";
export const CUSTOM_THEME_ID = "custom";

export interface ColorThemeChoice {
  id: string;
  /** Only set for the custom theme: a full role palette for each appearance. */
  custom: Record<ThemeVariant, ThemeRoles> | null;
}

export const DEFAULT_COLOR_THEME: ColorThemeChoice = { id: NEUTRAL_PRESET_ID, custom: null };

/** Mixing ratios per appearance. Light surfaces take a faint tint, dark surfaces a slightly stronger one. */
const TONES: Record<ThemeVariant, { background: string; foreground: string; tint: number; accent: number; border: number; live: string }> = {
  light: { background: "#FFFFFF", foreground: "#0A0A0A", tint: 0.04, accent: 0.1, border: 0.09, live: "#EF4444" },
  dark: { background: "#000000", foreground: "#FAFAFA", tint: 0.08, accent: 0.16, border: 0.16, live: "#F87171" },
};

function rgbOf(hex: string): Rgba {
  const color = parseColor(hex);
  if (!color) throw new Error(`invalid theme color ${hex}`);
  return color;
}

function mix(from: string, to: string, amount: number): string {
  const a = rgbOf(from);
  const b = rgbOf(to);
  const t = clamp(amount);
  return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

/**
 * Black or white text on the given color, by WCAG relative luminance. The cutoff sits above the
 * contrast crossover so mid-tone brand colors keep white text, and only bright colors take black.
 */
function readableOn(hex: string): string {
  const { r, g, b } = rgbOf(hex);
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.35 ? "#000000" : "#FFFFFF";
}

/** The role palette a preset produces for one appearance. */
export function presetRoles(preset: ColorPreset, variant: ThemeVariant): ThemeRoles {
  const tone = TONES[variant];
  const primary = preset.primary[variant];
  const background = mix(tone.background, primary, tone.tint);
  return {
    background,
    card: background,
    foreground: tone.foreground,
    primary,
    accent: mix(background, primary, tone.accent),
    border: mix(background, tone.foreground, tone.border),
    live: tone.live,
  };
}

/** Maps roles to the CSS variables that styles.css defines for each appearance. */
export function themeCssVariables(roles: ThemeRoles): Record<string, string> {
  const { background, foreground } = roles;
  const secondary = mix(background, foreground, 0.05);
  return {
    "--background": background,
    "--foreground": foreground,
    "--card": roles.card,
    "--card-foreground": foreground,
    "--popover": roles.card,
    "--popover-foreground": foreground,
    "--primary": roles.primary,
    "--primary-foreground": readableOn(roles.primary),
    "--secondary": secondary,
    "--secondary-foreground": foreground,
    "--muted": secondary,
    "--muted-foreground": mix(foreground, background, 0.4),
    "--accent": roles.accent,
    "--accent-foreground": foreground,
    "--border": roles.border,
    "--input": roles.border,
    "--ring": roles.primary,
    "--live": roles.live,
    "--surface": roles.card,
  };
}

export const PALETTE_VARIABLES = Object.keys(themeCssVariables(presetRoles(COLOR_PRESETS[0], "light")));

export function findPreset(id: string): ColorPreset | undefined {
  return COLOR_PRESETS.find((preset) => preset.id === id);
}

/** Roles to paint for the current choice, or null when the stylesheet defaults apply. */
export function resolveThemeRoles(choice: ColorThemeChoice, variant: ThemeVariant): ThemeRoles | null {
  if (choice.id === CUSTOM_THEME_ID && choice.custom) return choice.custom[variant];
  const preset = findPreset(choice.id);
  if (!preset || preset.id === NEUTRAL_PRESET_ID) return null;
  return presetRoles(preset, variant);
}

/** Starting point when the user first customizes: the roles currently in effect for both appearances. */
export function seedCustomRoles(choice: ColorThemeChoice): Record<ThemeVariant, ThemeRoles> {
  const neutral = findPreset(NEUTRAL_PRESET_ID) ?? COLOR_PRESETS[0];
  return {
    light: resolveThemeRoles(choice, "light") ?? presetRoles(neutral, "light"),
    dark: resolveThemeRoles(choice, "dark") ?? presetRoles(neutral, "dark"),
  };
}

function isThemeRoles(value: unknown): value is ThemeRoles {
  if (typeof value !== "object" || value === null) return false;
  return THEME_ROLES.every((role) => {
    const color = (value as Record<string, unknown>)[role];
    return typeof color === "string" && parseColor(color) !== null;
  });
}

/** Validates a stored choice. Anything unexpected falls back to the default theme. */
export function parseColorThemeChoice(value: unknown): ColorThemeChoice {
  if (typeof value !== "object" || value === null) return DEFAULT_COLOR_THEME;
  const { id, custom } = value as { id?: unknown; custom?: unknown };
  if (id === CUSTOM_THEME_ID) {
    if (typeof custom !== "object" || custom === null) return DEFAULT_COLOR_THEME;
    const { light, dark } = custom as { light?: unknown; dark?: unknown };
    if (!isThemeRoles(light) || !isThemeRoles(dark)) return DEFAULT_COLOR_THEME;
    const normalize = (roles: ThemeRoles): ThemeRoles =>
      Object.fromEntries(THEME_ROLES.map((role) => [role, toHex(rgbOf(roles[role]))])) as ThemeRoles;
    return { id: CUSTOM_THEME_ID, custom: { light: normalize(light), dark: normalize(dark) } };
  }
  if (typeof id !== "string" || !findPreset(id)) return DEFAULT_COLOR_THEME;
  return { id, custom: null };
}
