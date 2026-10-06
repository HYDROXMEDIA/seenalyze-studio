// Text for native dialogs opened by the screen-recording windows. It comes
// from the same catalog as the app UI (`screenRecording.main` in en.json).

import en from '../../renderer/messages/en.json';

type Tree = { [key: string]: string | Tree };

const CATALOG = (en as unknown as { screenRecording: { main: Tree } }).screenRecording.main;

export function t(key: string, values: Record<string, string | number> = {}): string {
  let node: string | Tree | undefined = CATALOG;
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') return key;
  return node.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
