// Loads the screen-recording windows' pages and keeps every one of them on
// its own page: no navigation, no new windows.

import path from 'node:path';
import { app, type BrowserWindow } from 'electron';

export type PageName = 'capture' | 'recorder' | 'facecam' | 'controls' | 'editor';

const DEV_URL = process.env.ELECTRON_RENDERER_URL;

/** Built preload script for a screen-recording page. */
export function preloadPath(page: PageName): string {
  return path.join(__dirname, `../preload/recording-${page}.js`);
}

function pageUrl(page: PageName): string {
  return DEV_URL ? `${DEV_URL}/screen-recording/${page}/index.html` : `file://${path.join(__dirname, `../renderer/screen-recording/${page}/index.html`)}`;
}

/** True when `url` is the given page itself (any query), so IPC can check the sender. */
export function isPageUrl(url: string, page: PageName): boolean {
  const expected = new URL(pageUrl(page));
  try {
    const actual = new URL(url);
    return actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}

export function loadPage(window: BrowserWindow, page: PageName, query: Record<string, string> = {}): Promise<void> {
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (DEV_URL) {
    const url = new URL(pageUrl(page));
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return window.loadURL(url.href);
  }
  return window.loadFile(path.join(__dirname, `../renderer/screen-recording/${page}/index.html`), { query });
}

/** Where the macOS helpers are: bin/ in development, Resources/bin when packaged. */
export function helperPath(name: string): string {
  return path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'bin', name);
}

/** Windows scripts shipped in native/ (Resources/native when packaged). */
export function scriptPath(name: string): string {
  return path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'native', name);
}
