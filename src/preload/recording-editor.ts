// Bridge for the recording editor window.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('recordingEditor', {
  transcribe: (id: string) => ipcRenderer.invoke('editor:transcribe', id),
  cancelTranscription: (id: string) => ipcRenderer.invoke('editor:transcription-cancel', id),
  exportSubtitles: (text: string, format: string) => ipcRenderer.invoke('editor:subtitles-export', text, format),
  getPresets: () => ipcRenderer.invoke('editor:presets'),
  savePreset: (preset: unknown) => ipcRenderer.invoke('editor:preset-save', preset),
  deletePreset: (id: string) => ipcRenderer.invoke('editor:preset-delete', id),
  backgroundUrl: (id: string) => ipcRenderer.invoke('editor:background-url', id),
  onTranscriptionProgress: (callback: (progress: number) => void) => ipcRenderer.on('editor:transcription-progress', (_event, progress) => callback(progress)),
  discard: (): Promise<{ ok: boolean; canceled?: boolean }> => ipcRenderer.invoke('editor:discard'),
  init: (): Promise<unknown> => ipcRenderer.invoke('editor:init'),
  saveProject: (data: string): Promise<boolean> => ipcRenderer.invoke('editor:save-project', data),
  // Saves before the window closes; it has to finish before the page goes away.
  saveProjectNow: (data: string): boolean => ipcRenderer.sendSync('editor:save-project-now', data) === true,
  pickBackground: (): Promise<{ ok: boolean; canceled?: boolean; invalid?: boolean; id?: string; url?: string }> => ipcRenderer.invoke('editor:pick-background'),
  removeBackground: (id: string): Promise<boolean> => ipcRenderer.invoke('editor:remove-background', id),
  setOpenAfterRecording: (value: boolean): void => ipcRenderer.send('editor:set-open-after-recording', value),
  readRange: (offset: number, length: number, source: 'video' | 'camera'): Promise<Uint8Array | null> => ipcRenderer.invoke('editor:read-range', offset, length, source),
  exportBegin: (options: { width: number; height: number; fps: number; audio: { sampleRate: number; channels: number; codec: 'aac' | 'opus' | null } | null }): Promise<{ ok: boolean; canceled?: boolean; protected?: boolean; audio?: 'pcm' | 'encoded' | 'none' }> =>
    ipcRenderer.invoke('editor:export-begin', options),
  exportConfig: (data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('editor:export-config', data),
  exportVideo: (header: { timestamp: number; duration: number; key: boolean }, data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('editor:export-video', header, data),
  exportAudio: (data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('editor:export-audio', data),
  exportAudioConfig: (data: Uint8Array | null): Promise<boolean> => ipcRenderer.invoke('editor:export-audio-config', data),
  exportAudioChunk: (header: { timestamp: number; duration: number }, data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('editor:export-audio-chunk', header, data),
  exportDone: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('editor:export-done'),
  exportCancel: (): Promise<void> => ipcRenderer.invoke('editor:export-cancel'),
  revealExport: (): Promise<boolean> => ipcRenderer.invoke('editor:reveal-export'),
  close: (): void => ipcRenderer.send('editor:close'),
  onOpenAfterRecording: (callback: (value: boolean) => void): void => {
    ipcRenderer.on('editor:open-after-recording', (_event, value: boolean) => callback(value === true));
  },
  onExportFailed: (callback: () => void): void => {
    ipcRenderer.on('editor:export-failed', () => callback());
  }
});
