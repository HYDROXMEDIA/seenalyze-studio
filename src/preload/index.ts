import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, STUDIO_METHODS, type StudioApi } from "../shared/ipc";

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
} as StudioApi;

contextBridge.exposeInMainWorld("studio", api);
contextBridge.exposeInMainWorld("platform", process.platform);
