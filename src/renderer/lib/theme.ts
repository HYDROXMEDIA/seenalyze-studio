// Theme preference is a per-device convenience, so it lives in localStorage.

export type ThemePreference = "dark" | "light" | "system";

const KEY = "seenalyze-studio-theme";

export function readTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "system" ? value : "dark";
  } catch (error) {
    console.warn("[theme] storage unavailable", error);
    return "dark";
  }
}

export function applyTheme(preference: ThemePreference): void {
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function saveTheme(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(KEY, preference);
  } catch (error) {
    console.warn("[theme] storage unavailable", error);
  }
  applyTheme(preference);
}
