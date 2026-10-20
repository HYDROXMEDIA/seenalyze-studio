// Translation and appearance helpers for the screen-recording windows. Their
// text lives with the rest of the app in messages/<locale>.json under
// `screenRecording`, and is formatted by the same library as the studio UI.
//
// Static markup:
//   <span data-i18n="editor.export.button"></span>                 -> textContent
//   <button data-i18n-attr="aria-label:editor.play;title:editor.play"> -> attributes

import { createTranslator } from 'use-intl/core';
import { directionFor, loadMessages } from '../../i18n';

// The studio stores the chosen interface language on this device; these windows use the same one.
const LANGUAGE_KEY = 'seenalyze-studio-language';

function chosenLanguage() {
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) ?? navigator.language;
  } catch (error) {
    console.warn('Interface language unavailable; using the system language', error);
    return navigator.language;
  }
}

let LOCALE = 'en';
let translate = null;
let numberFormat = null;

function useLanguage(language) {
  const { locale, messages } = loadMessages(language);
  LOCALE = locale;
  translate = createTranslator({
    locale,
    messages,
    namespace: 'screenRecording',
    onError: (error) => console.error(error)
  });
  numberFormat = new Intl.NumberFormat(locale);
}
useLanguage(chosenLanguage());

/** @param {string} key @param {Record<string, string | number>} [values] */
export function t(key, values) {
  return translate(key, values);
}

export function intlLocale() {
  return LOCALE;
}

/** @param {number} value */
export function formatNumber(value) {
  return numberFormat.format(value);
}

/**
 * Translates `[data-i18n]` and `[data-i18n-attr]` elements inside `root`.
 * @param {ParentNode} [root]
 */
export function applyTranslations(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.getAttribute('data-i18n'));
  }
  for (const element of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of element.getAttribute('data-i18n-attr').split(';')) {
      const [attribute, key] = pair.split(':').map((part) => part.trim());
      if (attribute && key) element.setAttribute(attribute, t(key));
    }
  }
}

export function initI18n() {
  document.documentElement.lang = LOCALE;
  document.documentElement.dir = directionFor(LOCALE);
  applyTranslations(document);
}

const localeListeners = new Set();

// A language picked in the studio while this window is open applies right away.
window.addEventListener('storage', (event) => {
  if (event.key !== LANGUAGE_KEY) return;
  useLanguage(chosenLanguage());
  initI18n();
  for (const listener of localeListeners) listener(LOCALE);
});

/**
 * Calls `callback` after the interface language changed and the page's static text was updated.
 * @param {(locale: string) => void} callback
 * @returns {() => void}
 */
export function onLocaleChange(callback) {
  localeListeners.add(callback);
  return () => localeListeners.delete(callback);
}

/** The appearance chosen in the studio (stored on this device), as 'dark' or 'light'. */
export function appTheme() {
  let preference = 'dark';
  try {
    const stored = window.localStorage.getItem('seenalyze-studio-theme');
    if (stored === 'light' || stored === 'system') preference = stored;
  } catch {
    // Storage is unavailable; the studio's default appearance applies.
  }
  if (preference === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return preference;
}
