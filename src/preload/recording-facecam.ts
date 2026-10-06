// Bridge for the live camera bubble shown while recording.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('recordingFacecam', {
  init: (): Promise<{ camera: string } | null> => ipcRenderer.invoke('facecam:init'),
  resize: (delta: number): void => ipcRenderer.send('facecam:resize', delta),
  error: (message: string): void => ipcRenderer.send('facecam:error', message)
});
