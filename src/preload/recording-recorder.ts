// Bridge for the hidden built-in recorder window (used where the native
// recorder is unavailable).

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('recordingRecorder', {
  safeMicrophone: (name: string | null): Promise<string | null> => ipcRenderer.invoke('audio:recording-microphone', name),
  init: (): Promise<unknown> => ipcRenderer.invoke('recorder:init'),
  begin: (extension: 'mp4' | 'webm'): Promise<boolean> => ipcRenderer.invoke('recorder:begin', extension),
  chunk: (data: Uint8Array): void => ipcRenderer.send('recorder:chunk', data),
  started: (): void => ipcRenderer.send('recorder:started'),
  done: (): void => ipcRenderer.send('recorder:done'),
  stop: (): void => ipcRenderer.send('recorder:stop-clicked'),
  error: (message: string): void => ipcRenderer.send('recorder:error', message),
  onPause: (callback: () => void): void => {
    ipcRenderer.on('recorder:pause', () => callback());
  },
  onResume: (callback: () => void): void => {
    ipcRenderer.on('recorder:resume', () => callback());
  },
  onRequestStop: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('recorder:request-stop', listener);
    return () => ipcRenderer.removeListener('recorder:request-stop', listener);
  }
});
