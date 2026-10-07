// Screen recording with an editor: pick a window, an area or a whole display,
// record it (with the pointer, clicks and typing tracked, and the camera kept
// as its own track), then polish the result in an editor window: automatic
// zooms, a redrawn smooth pointer, backgrounds, cuts, speed, captions and
// export. Everything here runs in its own windows next to the studio and
// never touches the streaming engine.

import { app, dialog, type BrowserWindow, type WebContents } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { readRecoverableJson, writeAtomic } from './atomic-file';
import { CaptureController, type RecordingDevices } from './capture';
import { ControlsWindow } from './controls';
import { EditorWindows } from './editor';
import { FacecamWindow } from './facecam';
import { handleMediaScheme } from './media-protocol';
import { helperPath, isPageUrl } from './pages';
import { pruneRecordingData } from './recording-data';
import { RecordingController } from './recording';
import { SpeechService } from './speech';
import { t } from './i18n';

export { registerMediaScheme } from './media-protocol';

export type ScreenRecordingState = { active: boolean; paused: boolean };

export type ScreenRecorderDependencies = {
  // Shared with the studio's own recordings.
  recordingFolder: () => string;
  setRecordingFolder: (folder: string) => void;
  // Screen access, requested the same way as for capture sources.
  ensureScreenAccess: () => Promise<boolean>;
  onStateChange: (state: ScreenRecordingState) => void;
};

type Preferences = RecordingDevices & { openEditorAfterRecording: boolean };

const DEFAULT_PREFERENCES: Preferences = { microphone: 'default', camera: '', openEditorAfterRecording: true };
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm'];

function log(line: string): void {
  console.log(`[screen-recording] ${line}`);
}

export class ScreenRecorder {
  private preferences: Preferences = { ...DEFAULT_PREFERENCES };
  private theme: 'dark' | 'light' = 'dark';
  private startedAt: number | null = null;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private shuttingDown = false;
  private started = false;
  // Where the last recording was made, so its controls show on that display.
  private lastArea: { x: number; y: number; width: number; height: number } | null = null;
  private readonly speech = new SpeechService(log);

  private readonly facecam = new FacecamWindow({
    log,
    onError: () => this.capture.notifyCameraError()
  });

  private readonly controls = new ControlsWindow({
    togglePause: () => this.recordings.togglePause(),
    stop: () => this.recordings.stop()
  });

  private readonly recordings = new RecordingController({
    log,
    onSaved: async (filePath) => {
      if (!this.shuttingDown && this.preferences.openEditorAfterRecording) await this.editors.open(filePath);
    },
    outputDirectory: () => this.deps.recordingFolder(),
    facecam: {
      hint: (area) => this.facecam.hint(area),
      open: (camera, area) => this.facecam.open(camera, area),
      close: (area) => this.facecam.close(area)
    },
    nativeRecorderPath: () => {
      if (process.platform !== 'darwin') return null;
      const path = helperPath('screen-recorder');
      return existsSync(path) ? path : null;
    },
    onPauseChange: (paused) => {
      if (paused) {
        this.pausedAt = Date.now();
      } else if (this.pausedAt !== null) {
        this.pausedTotal += Date.now() - this.pausedAt;
        this.pausedAt = null;
      }
      this.pushControls();
      this.deps.onStateChange(this.state);
    },
    onStateChange: (recording) => {
      this.startedAt = recording ? Date.now() : null;
      this.pausedAt = null;
      this.pausedTotal = 0;
      if (recording) this.controls.show(this.lastArea ?? { x: 0, y: 0, width: 1, height: 1 }, this.controlsState());
      else this.controls.hide();
      this.deps.onStateChange(this.state);
    }
  });

  private readonly capture = new CaptureController({
    log,
    ensureScreenAccess: () => this.deps.ensureScreenAccess(),
    startRecording: (request) => {
      this.lastArea = request.rect;
      return this.recordings.start(request);
    },
    facecamPreview: (camera, area) => {
      if (camera === null || area === null) this.facecam.close();
      else this.facecam.open(camera, area);
    },
    recordingDevices: () => ({ microphone: this.preferences.microphone, camera: this.preferences.camera }),
    setRecordingDevices: (devices) => {
      this.preferences = { ...this.preferences, ...devices };
      this.capture.devicesChanged(devices);
      void this.savePreferences();
    },
    recordingFolderName: () => basename(this.deps.recordingFolder()),
    chooseRecordingFolder: async (parent) => {
      const result = await dialog.showOpenDialog(parent, {
        title: t('dialogs.recordingFolder'),
        buttonLabel: t('dialogs.choose'),
        defaultPath: this.deps.recordingFolder(),
        properties: ['openDirectory', 'createDirectory']
      });
      const folder = result.filePaths[0];
      if (result.canceled || folder === undefined) return null;
      this.deps.setRecordingFolder(folder);
      return basename(folder);
    }
  });

  private readonly editors = new EditorWindows({
    log,
    theme: () => this.theme,
    openAfterRecording: () => this.preferences.openEditorAfterRecording,
    setOpenAfterRecording: (value) => {
      this.preferences.openEditorAfterRecording = value;
      void this.savePreferences();
    },
    onExported: () => undefined,
    transcribe: (path, id, progress) => this.speech.transcribeMedia(path, id, progress),
    cancelTranscription: (id) => this.speech.cancel(id),
    muxerPath: () => {
      if (process.platform !== 'darwin') return null;
      const path = helperPath('video-muxer');
      return existsSync(path) ? path : null;
    }
  });

  constructor(private readonly deps: ScreenRecorderDependencies) {}

  get state(): ScreenRecordingState {
    return { active: this.recordings.isRecording(), paused: this.recordings.isPaused() };
  }

  async start(): Promise<void> {
    // The studio window can reload; handlers are registered once.
    if (this.started) return;
    this.started = true;
    await this.loadPreferences();
    handleMediaScheme();
    this.facecam.registerIpc();
    this.controls.registerIpc();
    this.recordings.registerIpc();
    this.capture.registerIpc();
    this.editors.registerIpc();
    // Data of recordings deleted since last time goes first, then the images only they used.
    void pruneRecordingData()
      .then((removed) => { if (removed > 0) log(`Removed data of ${removed} deleted recording(s)`); })
      .catch(() => undefined)
      .then(() => this.editors.pruneBackgrounds());
  }

  /** Opens the picker, or stops the recording that is running. */
  async toggle(): Promise<void> {
    if (this.recordings.isRecording()) {
      this.recordings.stop();
      return;
    }
    await this.capture.start();
  }

  stop(): void {
    this.recordings.stop();
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme;
  }

  /** Lets the user pick a video and opens it in the editor. */
  async openEditor(parent: BrowserWindow): Promise<boolean> {
    const result = await dialog.showOpenDialog(parent, {
      title: t('dialogs.openRecording'),
      defaultPath: this.deps.recordingFolder(),
      properties: ['openFile'],
      filters: [{ name: t('dialogs.video'), extensions: VIDEO_EXTENSIONS }]
    });
    const path = result.filePaths[0];
    if (result.canceled || path === undefined) return false;
    return this.editors.open(path);
  }

  /**
   * Camera and microphone access for the windows that need it: the picker
   * (device names), the camera bubble and the built-in recorder.
   */
  allowsMedia(contents: WebContents): boolean {
    return (['capture', 'facecam', 'recorder'] as const).some((page) => isPageUrl(contents.getURL(), page));
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.capture.cancel('Quitting');
    await this.recordings.shutdown();
    await Promise.race([this.editors.shutdown(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    this.editors.closeAll();
    this.controls.hide();
    this.facecam.close();
    await this.speech.shutdown();
  }

  private controlsState(): { startedAt: number; pausedAt: number | null } {
    return { startedAt: (this.startedAt ?? Date.now()) + this.pausedTotal, pausedAt: this.pausedAt };
  }

  private pushControls(): void {
    if (this.startedAt !== null) this.controls.update(this.controlsState());
  }

  private preferencesPath(): string {
    return join(app.getPath('userData'), 'screen-recording.json');
  }

  private async loadPreferences(): Promise<void> {
    const saved = (await readRecoverableJson(this.preferencesPath()).catch(() => ({ value: null }))).value as Partial<Preferences> | null;
    const device = (value: unknown, fallback: string) => (typeof value === 'string' && value.length <= 512 ? value : fallback);
    this.preferences = {
      microphone: device(saved?.microphone, DEFAULT_PREFERENCES.microphone),
      camera: device(saved?.camera, DEFAULT_PREFERENCES.camera),
      openEditorAfterRecording: typeof saved?.openEditorAfterRecording === 'boolean' ? saved.openEditorAfterRecording : true
    };
  }

  private async savePreferences(): Promise<void> {
    try {
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      await writeAtomic(this.preferencesPath(), JSON.stringify(this.preferences), true);
    } catch (error) {
      log(`Preferences could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

