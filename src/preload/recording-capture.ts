// Bridge for the screen-recording picker (one transparent panel per display).

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type CaptureMode = "area" | "window" | "screen";
type Rect = { x: number; y: number; width: number; height: number };

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("recordingCapture", {
  init: (): Promise<unknown> => ipcRenderer.invoke("capture:init"),
  setMode: (mode: CaptureMode): void => ipcRenderer.send("capture:set-mode", mode),
  reportSelection: (hasSelection: boolean): void => ipcRenderer.send("capture:selection", hasSelection),
  enter: (mode: CaptureMode): void => ipcRenderer.send("capture:enter", mode),
  cancel: (): void => ipcRenderer.send("capture:cancel"),
  perform: (request: { mode: CaptureMode; rect: Rect; windowId?: number }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("capture:perform", request),
  requestThumbnails: (): void => ipcRenderer.send("capture:window-thumbnails"),
  requestMicrophoneAccess: (): Promise<boolean> => ipcRenderer.invoke("capture:microphone-access"),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke("capture:choose-folder"),
  // The camera to show as a movable bubble before recording, or null for none.
  setFacecam: (camera: string | null): void => ipcRenderer.send("capture:facecam", camera),
  setDevices: (devices: { microphone: string; camera: string }): void => ipcRenderer.send("capture:devices", devices),
  onDevices: (callback: (devices: { microphone: string; camera: string }) => void) => subscribe("capture:devices", callback),
  onThumbnail: (callback: (payload: { id: number; url: string | null }) => void) => subscribe("capture:thumbnail", callback),
  onThumbnailsDone: (callback: () => void) => subscribe("capture:thumbnails-done", callback),
  onMode: (callback: (mode: CaptureMode) => void) => subscribe("capture:mode", callback),
  onClearSelection: (callback: () => void) => subscribe("capture:clear-selection", callback),
  onCommit: (callback: () => void) => subscribe("capture:commit", callback),
  onCameraError: (callback: () => void) => subscribe("capture:camera-error", callback),
});
