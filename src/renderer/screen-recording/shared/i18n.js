// Translation and appearance helpers for the screen-recording windows. Their
// text lives with the rest of the app in messages/en.json under
// `screenRecording`, and is formatted by the same library as the studio UI.
//
// Static markup:
//   <span data-i18n="editor.export.button"></span>                 -> textContent
//   <button data-i18n-attr="aria-label:editor.play;title:editor.play"> -> attributes

import { createTranslator } from 'use-intl/core';
import en from '../../messages/en.json';

const LOCALE = 'en';
const translate = createTranslator({
  locale: LOCALE,
  messages: en,
  namespace: 'screenRecording',
  onError: (error) => console.error(error)
});
const numberFormat = new Intl.NumberFormat(LOCALE);

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
  applyTranslations(document);
}

/**
 * The app has one language for now; kept so pages can re-render on a change.
 * @param {(locale: string) => void} _callback
 * @returns {() => void}
 */
export function onLocaleChange(_callback) {
  return () => undefined;
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
