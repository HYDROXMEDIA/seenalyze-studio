// Bridge for projector windows: exactly the ProjectorApi contract, nothing else.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { PROJECTOR_IPC, PROJECTOR_METHODS, type ProjectorApi, type ProjectorView } from "../shared/projector";

const invokers = Object.fromEntries(PROJECTOR_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(PROJECTOR_IPC.invoke, method, args)]));

const api = {
  ...invokers,
  onView: (listener: (view: ProjectorView) => void) => {
    const handler = (_event: IpcRendererEvent, view: ProjectorView) => listener(view);
    ipcRenderer.on(PROJECTOR_IPC.view, handler);
    return () => void ipcRenderer.removeListener(PROJECTOR_IPC.view, handler);
  },
} as ProjectorApi;

contextBridge.exposeInMainWorld("projector", api);
contextBridge.exposeInMainWorld("platform", process.platform);
