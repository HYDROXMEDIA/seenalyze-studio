import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from "electron";
import { IPC, STUDIO_METHODS, type StudioApi } from "../shared/ipc";
import { macOSMajorVersion, STUDIO_TITLE_BAR, titleBarCss } from "../shared/window-chrome";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const invokers = Object.fromEntries(
  STUDIO_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(IPC.invoke, method, args)]),
);

const api = {
  ...invokers,
  onSnapshot: (listener) => subscribe(IPC.snapshot, listener),
  onStats: (listener) => subscribe(IPC.stats, listener),
  onAudioLevels: (listener) => subscribe(IPC.audioLevels, listener),
  onNotice: (listener) => subscribe(IPC.notice, listener),
  onQuitRequest: (listener) => subscribe(IPC.quitRequest, listener),
  onChat: (listener) => subscribe(IPC.chat, listener),
  onSourceMenu: (listener) => subscribe(IPC.sourceMenu, listener),
} as StudioApi;

contextBridge.exposeInMainWorld("studio", api);
contextBridge.exposeInMainWorld("platform", process.platform);

// The header's height and the room it keeps for the macOS window buttons, from
// the same numbers the main process places the buttons with.
webFrame.insertCSS(titleBarCss(STUDIO_TITLE_BAR, process.platform, macOSMajorVersion(process.getSystemVersion())));
