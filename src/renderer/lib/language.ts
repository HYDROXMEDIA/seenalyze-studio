// Interface language is a per-device convenience, like the theme, so it lives in localStorage.
// The signed-in SEENALYZE account can override it from the settings page (see SeenalyzeAccountRow).

import { useSyncExternalStore } from "react";
import { DEFAULT_UI_LOCALE, directionFor, isUiLocale, matchLocale, type UiLocale } from "../i18n";

const KEY = "seenalyze-studio-language";

const listeners = new Set<() => void>();

function readStoredLanguage(): UiLocale | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return isUiLocale(value) ? value : null;
  } catch (error) {
    console.warn("[language] storage unavailable", error);
    return null;
  }
}

function systemLanguage(): UiLocale {
  return matchLocale(navigator.language) ?? DEFAULT_UI_LOCALE;
}

let current: UiLocale = readStoredLanguage() ?? systemLanguage();

function applyToDocument(locale: UiLocale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = directionFor(locale);
}

/** Applies the stored or system language before the first render. */
export function initLanguage(): void {
  applyToDocument(current);
}

export function saveLanguage(locale: UiLocale): void {
  if (locale === current) return;
  try {
    window.localStorage.setItem(KEY, locale);
  } catch (error) {
    console.warn("[language] storage unavailable", error);
  }
  current = locale;
  applyToDocument(locale);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLanguage(): UiLocale {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
