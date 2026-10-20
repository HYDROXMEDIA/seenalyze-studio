// Text for native dialogs opened by the screen-recording windows. It comes
// from the same catalogs as the app UI (`screenRecording.main`), in the
// interface language chosen in the studio.

import { loadMessages } from '../../renderer/i18n';

type Tree = { [key: string]: string | Tree };

let catalog = catalogFor(null);

function catalogFor(language: string | null): Tree {
  return (loadMessages(language).messages as unknown as { screenRecording: { main: Tree } }).screenRecording.main;
}

/** Follows the studio's interface language; unsupported tags fall back to English. */
export function setLanguage(language: string): void {
  catalog = catalogFor(language);
}

export function t(key: string, values: Record<string, string | number> = {}): string {
  let node: string | Tree | undefined = catalog;
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') return key;
  return node.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
