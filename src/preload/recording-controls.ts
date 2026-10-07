// Bridge for the floating bar shown while a screen recording runs.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type ControlsState = { startedAt: number; pausedAt: number | null };

contextBridge.exposeInMainWorld("recordingControls", {
  init: (): Promise<ControlsState | null> => ipcRenderer.invoke("controls:init"),
  togglePause: (): void => ipcRenderer.send("controls:toggle-pause"),
  stop: (): void => ipcRenderer.send("controls:stop"),
  onState: (callback: (state: ControlsState) => void): void => {
    ipcRenderer.on("controls:state", (_event: IpcRendererEvent, state: ControlsState) => callback(state));
  },
});
