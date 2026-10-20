// Theme preference is a per-device convenience, so it lives in localStorage.

import { useSyncExternalStore } from "react";
import { PALETTE_VARIABLES, DEFAULT_COLOR_THEME, parseColorThemeChoice, resolveThemeRoles, themeCssVariables, type ColorThemeChoice } from "./color-theme";
import { studio } from "./studio";

export type ThemePreference = "dark" | "light" | "system";

const KEY = "seenalyze-studio-theme";
const COLOR_KEY = "seenalyze-studio-color-theme";

export function readTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "system" ? value : "dark";
  } catch (error) {
    console.warn("[theme] storage unavailable", error);
    return "dark";
  }
}

export function readColorTheme(): ColorThemeChoice {
  try {
    return parseColorThemeChoice(JSON.parse(window.localStorage.getItem(COLOR_KEY) ?? "null"));
  } catch (error) {
    console.warn("[theme] color theme unavailable", error);
    return DEFAULT_COLOR_THEME;
  }
}

/** Paints the chosen color theme over the stylesheet defaults. The default theme paints nothing. */
function applyPalette(choice: ColorThemeChoice, dark: boolean): void {
  const style = document.documentElement.style;
  for (const name of PALETTE_VARIABLES) style.removeProperty(name);
  const roles = resolveThemeRoles(choice, dark ? "dark" : "light");
  if (!roles) return;
  for (const [name, value] of Object.entries(themeCssVariables(roles))) style.setProperty(name, value);
}

export function applyTheme(preference: ThemePreference): void {
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  applyPalette(readColorTheme(), dark);
  // The screen-recording windows follow the main window's appearance; the
  // preview editor and projector windows may not change it (projectors have no studio API).
  if (window.location.hash === "#preview-editor" || window.location.hash === "#projector") return;
  studio.setAppearance(dark ? "dark" : "light").catch((error: unknown) => console.warn("[theme] could not share appearance", error));
}

export function saveTheme(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(KEY, preference);
  } catch (error) {
    console.warn("[theme] storage unavailable", error);
  }
  applyTheme(preference);
}

export function saveColorTheme(choice: ColorThemeChoice): void {
  try {
    window.localStorage.setItem(COLOR_KEY, JSON.stringify(choice));
  } catch (error) {
    console.warn("[theme] color theme storage unavailable", error);
  }
  applyPalette(choice, document.documentElement.classList.contains("dark"));
}

// "System" follows the OS appearance while the app runs, not only at start.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (readTheme() === "system") applyTheme("system");
});

function subscribeToDarkMode(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** Whether the dark appearance is in use; re-renders when it changes (a setting or the OS). */
export function useDarkMode(): boolean {
  return useSyncExternalStore(
    subscribeToDarkMode,
    () => document.documentElement.classList.contains("dark"),
    () => true,
  );
}
