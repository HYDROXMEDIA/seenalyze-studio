// Engine worker: runs in an Electron utility process and owns every libobs
// object. Engine calls are synchronous and can block (permission prompts,
// device or font enumeration, teardown), so they must never run on the main
// process, which drives the app window.

import type {
  AdvancedStreamSettings,
  AudioLevel,
  AudioSourceDTO,
  DisplaySpec,
  DestinationStatus,
  EncoderOption,
  EngineStats,
  ItemPlacement,
  ItemTransformPatch,
  PropertyDTO,
  RecordingStatus,
  ReplayStatus,
  SceneDTO,
  SourceKind,
  SourceTransform,
  TransformPreset,
  VideoSettings,
} from "../../shared/types";
import type { TransitionChoice } from "../../shared/transitions";
import type { EffectKind, EffectSnapshot } from "../../shared/video-effects";
import type { AudioChange } from "../../shared/audio";
import { AudioMixer } from "./audio";
import { AudioProcessor } from "./audio-processing";
import { EngineSession } from "./engine";
import { readAudioFormat } from "./formats";
import type { AudioFormat } from "../../shared/formats";
import { setVendorRoot } from "./osn";
import { OutputManager, type LiveDestination, type RecordingOptions } from "./outputs";
import { DisplayHosts, PREVIEW_DISPLAY_NAME, type PreviewRequest, type PreviewResult } from "./preview";
import { displayContent, StudioPreview } from "./studio-mode";
import { ReplayBuffer, type ReplayOptions } from "./replay";
import { SceneGraph, type SceneCollection } from "./scenes";
import { MediaProbe } from "./media-probe";
import { VirtualCamera } from "./virtual-camera";

export interface EngineInit {
  vendorRoot: string;
  dataDir: string;
  appVersion: string;
  video: VideoSettings;
  collection: SceneCollection | null;
  transition: TransitionChoice;
  /** Device opened in place of the system default microphone (see audio-inputs.ts). */
  defaultMicrophone?: string;
  /** Headphones that monitored sources play on ("default" or unset: system default). */
  monitoringDevice?: string;
  /** Sample rate and speakers chosen in Settings; unset keeps the engine default. */
  audioFormat?: AudioFormat;
}

export interface EngineState {
  scenes: SceneDTO[];
  availableSourceKinds: SourceKind[];
  unavailableSourceCount: number;
  activeScene: string | null;
  audio: AudioSourceDTO[];
  encoders: EncoderOption[];
  recording: RecordingStatus;
  streaming: boolean;
  replay: ReplayStatus;
  /** Installed engine transition types. */
  transitionTypes: string[];
  virtualCameraActive: boolean;
}

export type EngineEvent =
  | { type: "status"; status: DestinationStatus }
  | { type: "recording"; status: RecordingStatus }
  | { type: "replay"; status: ReplayStatus }
  | { type: "replaySaved"; file: string | null }
  | { type: "levels"; levels: AudioLevel[] }
  | { type: "stats"; stats: EngineStats; outputs: DestinationStatus[] };

export type WorkerMessage =
  | { kind: "result"; id: number; value: unknown }
  | { kind: "error"; id: number; code: string }
  | { kind: "event"; event: EngineEvent };

export type WorkerRequest = { id: number; method: keyof EngineHandlers; args: unknown[] };

interface ParentPort {
  on(event: "message", listener: (event: { data: WorkerRequest }) => void): void;
  postMessage(message: WorkerMessage): void;
}

const port = (process as unknown as { parentPort: ParentPort }).parentPort;

const STATS_INTERVAL_MS = 1000;
const LEVELS_INTERVAL_MS = 66;

let engine: EngineSession | null = null;
let scenes: SceneGraph | null = null;
let audio: AudioMixer | null = null;
let audioProcessing: AudioProcessor | null = null;
let outputs: OutputManager | null = null;
let replay: ReplayBuffer | null = null;
let displays: DisplayHosts | null = null;
let studioPreview: StudioPreview | null = null;
let virtualCamera: VirtualCamera | null = null;
let mediaProbe: MediaProbe | null = null;
const timers: NodeJS.Timeout[] = [];

function emit(event: EngineEvent): void {
  port.postMessage({ kind: "event", event });
}

function need<T>(value: T | null): T {
  if (!value) throw new Error("engine-not-ready");
  return value;
}

/** Mutations that can change the set of audio sources resync the mixer. */
function withScenes<T>(fn: (graph: SceneGraph) => T): T {
  const result = fn(need(scenes));
  audio?.sync();
  return result;
}

const handlers = {
  init(options: EngineInit): void {
    setVendorRoot(options.vendorRoot);
    engine = new EngineSession(options.video, { dataDir: options.dataDir, appVersion: options.appVersion, audioFormat: options.audioFormat });
    engine.start();
    scenes = new SceneGraph(engine, options.defaultMicrophone);
    scenes.setTransition(options.transition);
    audioProcessing = new AudioProcessor(engine.osn, scenes);
    scenes.audioHooks = audioProcessing.hooks;
    if (options.monitoringDevice) {
      try {
        audioProcessing.setMonitoringDevice(options.monitoringDevice);
      } catch (error) {
        console.warn("[engine-worker] monitoring device not applied", error);
      }
    }
    scenes.load(options.collection);
    audio = new AudioMixer(engine.osn, scenes);
    audio.sync();
    outputs = new OutputManager(engine);
    outputs.on("status", (status: DestinationStatus) => emit({ type: "status", status }));
    outputs.on("recording", (status: RecordingStatus) => emit({ type: "recording", status }));
    const audioTrackOwner = outputs;
    replay = new ReplayBuffer(engine, { hold: () => audioTrackOwner.holdAudioTrack(), release: () => audioTrackOwner.releaseAudioTrack() });
    replay.on("status", (status: ReplayStatus) => emit({ type: "replay", status }));
    replay.on("saved", (file: string) => emit({ type: "replaySaved", file }));
    replay.on("saveFailed", () => emit({ type: "replaySaved", file: null }));
    displays = new DisplayHosts(engine);
    studioPreview = new StudioPreview(engine.osn, scenes);
    timers.push(
      setInterval(() => {
        if (!engine || !outputs) return;
        outputs.refreshStats();
        emit({ type: "stats", stats: engine.stats(), outputs: outputs.statuses() });
      }, STATS_INTERVAL_MS),
      setInterval(() => {
        const levels = audio?.drainLevels() ?? [];
        if (levels.length > 0) emit({ type: "levels", levels });
      }, LEVELS_INTERVAL_MS),
    );
  },

  state(): EngineState {
    const graph = need(scenes);
    const out = need(outputs);
    return {
      scenes: graph.listScenes(),
      availableSourceKinds: graph.availableKinds(),
      unavailableSourceCount: graph.unavailableSourceCount,
      activeScene: graph.activeScene,
      audio: need(audio).list(),
      encoders: need(engine).availableEncoders(),
      recording: out.recordingState(),
      streaming: out.isStreaming,
      replay: need(replay).state(),
      transitionTypes: graph.transitionTypes(),
      virtualCameraActive: virtualCamera?.active ?? false,
    };
  },

  /** Sample rate and speaker layout the engine runs with. */
  audioFormat: (): AudioFormat => readAudioFormat(need(engine).osn),

  saveCollection(): SceneCollection {
    return need(scenes).save((name) => audio?.volumeOf(name));
  },

  // Scenes & sources
  createScene: (name: string) => withScenes((graph) => graph.createScene(name)),
  removeScene: (name: string) => withScenes((graph) => graph.removeScene(name)),
  renameScene: (name: string, next: string) => withScenes((graph) => graph.renameScene(name, next)),
  setActiveScene: (name: string) => withScenes((graph) => graph.setActiveScene(name)),
  setTransition: (choice: TransitionChoice) => need(scenes).setTransition(choice),
  programSource: (): string | null => need(scenes).programSource,
  setSceneTransition: (scene: string, choice: TransitionChoice | null) => need(scenes).setSceneTransition(scene, choice),
  mediaDurationMs: (file: string): number => (mediaProbe ??= new MediaProbe(need(engine).osn)).durationMs(file),

  // Virtual camera
  virtualCameraProbe: () => (virtualCamera ??= new VirtualCamera(need(engine))).probe(),
  installVirtualCamera: () => (virtualCamera ??= new VirtualCamera(need(engine))).install(),
  startVirtualCamera: (scene: string | null) => (virtualCamera ??= new VirtualCamera(need(engine))).start(scene),
  setVirtualCameraScene: (scene: string | null) => virtualCamera?.setScene(scene),
  stopVirtualCamera: () => virtualCamera?.stop(),
  addSource: (scene: string, kind: SourceKind, name: string, settings?: Record<string, unknown>): string =>
    withScenes((graph) => graph.addSource(scene, kind, name, settings)),
  listSourceChoices: (scene: string) => need(scenes).sourceChoices(scene),
  addExistingSource: (scene: string, source: string) => withScenes((graph) => graph.addExistingSource(scene, source)),
  retargetChatOverlays: (origin: string): number => need(scenes).retargetChatOverlays(origin),
  resizeOverlaySources: (overlayId: string, width: number, height: number): number => need(scenes).resizeOverlaySources(overlayId, width, height),
  removeSceneItem: (scene: string, itemId: number) => withScenes((graph) => graph.removeSceneItem(scene, itemId)),
  setItemVisible: (scene: string, itemId: number, visible: boolean) => need(scenes).setItemVisible(scene, itemId, visible),
  setItemLocked: (scene: string, itemId: number, locked: boolean) => need(scenes).setItemLocked(scene, itemId, locked),
  moveSceneItem: (scene: string, itemId: number, direction: "up" | "down") => need(scenes).moveSceneItem(scene, itemId, direction),
  applyTransform: (scene: string, itemId: number, preset: TransformPreset) => need(scenes).applyTransform(scene, itemId, preset),
  patchItemTransform: (scene: string, itemId: number, patch: ItemTransformPatch) => need(scenes).patchItemTransform(scene, itemId, patch),
  getItemPlacement: (scene: string, itemId: number) => need(scenes).getItemPlacement(scene, itemId),
  setItemPlacement: (scene: string, itemId: number, placement: ItemPlacement) => need(scenes).setItemPlacement(scene, itemId, placement),
  setSelectedItem: (scene: string, itemId: number | null) => need(scenes).setSelectedItem(scene, itemId),
  getItemTransform: (scene: string, itemId: number) => need(scenes).getItemTransform(scene, itemId),
  setItemTransform: (scene: string, itemId: number, transform: SourceTransform) => need(scenes).setItemTransform(scene, itemId, transform),
  sceneReadiness: () => need(scenes).readiness((name) => audio?.volumeOf(name)),
  getProperties: (source: string): PropertyDTO[] => need(scenes).getProperties(source),
  updateSettings: (source: string, settings: Record<string, unknown>): PropertyDTO[] => withScenes((graph) => graph.updateSettings(source, settings)),
  clickButton: (source: string, property: string): PropertyDTO[] => withScenes((graph) => graph.clickButton(source, property)),

  // Scene and source management
  moveScene: (name: string, direction: "up" | "down") => need(scenes).moveScene(name, direction),
  duplicateScene: (name: string): string => withScenes((graph) => graph.duplicateScene(name)),
  duplicateSceneItem: (scene: string, itemId: number) => withScenes((graph) => graph.duplicateSceneItem(scene, itemId)),

  // Video effects
  listEffects: (source: string) => need(scenes).effects.list(need(scenes).effectTarget(source)),
  addEffect: (source: string, kind: EffectKind) => need(scenes).effects.add(need(scenes).effectTarget(source), kind),
  removeEffect: (source: string, name: string) => need(scenes).effects.remove(need(scenes).effectTarget(source), name),
  setEffectEnabled: (source: string, name: string, enabled: boolean) => need(scenes).effects.setEnabled(need(scenes).effectTarget(source), name, enabled),
  moveEffect: (source: string, name: string, direction: "up" | "down") => need(scenes).effects.move(need(scenes).effectTarget(source), name, direction),
  getEffectProperties: (source: string, name: string): PropertyDTO[] => need(scenes).effects.properties(need(scenes).effectTarget(source), name),
  updateEffectSettings: (source: string, name: string, settings: Record<string, unknown>): PropertyDTO[] =>
    need(scenes).effects.update(need(scenes).effectTarget(source), name, settings),
  copyEffects: (source: string): EffectSnapshot[] => need(scenes).effects.snapshot(need(scenes).effectTarget(source)),
  pasteEffects(source: string, effects: EffectSnapshot[]) {
    const graph = need(scenes);
    const input = graph.effectTarget(source);
    graph.effects.restore(input, effects);
    return graph.effects.list(input);
  },

  renameSource(source: string, next: string): void {
    const graph = need(scenes);
    graph.renameSource(source, next);
    audio?.rename(source, next.trim());
  },

  // Audio
  setVolume: (source: string, deflection: number) => need(audio).setVolume(source, deflection),
  setMuted: (source: string, muted: boolean) => need(audio).setMuted(source, muted),
  /** Push-to-talk / push-to-mute: mute flag only, the device stays open. */
  setTalkMuted: (source: string, muted: boolean) => withScenes(() => need(audioProcessing).setTalkMuted(source, muted)),
  audioDetails: (source: string) => need(audioProcessing).details(source),
  changeAudio: (source: string, change: AudioChange) => need(audioProcessing).change(source, change),
  audioDevices: (source: string, allowOpen: boolean) => withScenes(() => need(audioProcessing).devices(source, allowOpen)),
  setAudioDevice: (source: string, deviceId: string) => withScenes(() => need(audioProcessing).setDevice(source, deviceId)),
  monitoringDevices: () => need(audioProcessing).monitoringDevices(),
  setMonitoringDevice: (id: string) => need(audioProcessing).setMonitoringDevice(id),

  // Video
  applyVideo(settings: VideoSettings): void {
    const current = need(engine).settings;
    // The canvas cannot change under a running encoder; instant replay restarts after.
    const replaying = replay?.running ?? false;
    if (replaying) replay?.stop(true);
    // The virtual camera also follows the canvas; it restarts with the new size.
    const camera = virtualCamera?.active ? virtualCamera : null;
    camera?.stop();
    try {
      need(engine).applyVideo(settings);
      need(scenes).rescale(current, settings);
    } finally {
      if (replaying) replay?.restart();
      camera?.restart();
    }
  },
  availableEncoders: (): EncoderOption[] => need(engine).availableEncoders(),

  // Preview
  /** Creates, sizes or moves a display; without `display` it is the main window's program display. */
  setPreview(request: PreviewRequest, display?: { name: string; spec: DisplaySpec }): PreviewResult {
    const content = display ? displayContent(display.spec, need(scenes), need(studioPreview)) : { kind: "program" as const };
    return need(displays).set(display?.name ?? PREVIEW_DISPLAY_NAME, content, request);
  },
  hidePreview: (name?: string) => displays?.destroy(name ?? PREVIEW_DISPLAY_NAME),

  // Studio mode
  /** Shows a scene in the studio-mode preview; null empties it. */
  setStudioPreview: (scene: string | null) => need(studioPreview).show(scene),
  /** Switches the program scene without a transition (studio mode "Cut"). */
  cutToScene: (name: string) => withScenes((graph) => graph.setActiveScene(name, false)),

  // Outputs
  startOutputs: (destinations: LiveDestination[], encoderId: string, options?: AdvancedStreamSettings) => need(outputs).start(destinations, encoderId, options),
  stopOutputs: (ids: string[]) => need(outputs).stop(ids),
  startRecording: (folder: string, encoderId: string, options: RecordingOptions) => need(outputs).startRecording(folder, encoderId, options),
  stopRecording: () => need(outputs).stopRecording(),
  configureReplay: (encoderId: string, options: ReplayOptions | null) => need(replay).configure(encoderId, options),
  saveReplay: () => need(replay).save(),

  shutdown(): void {
    for (const timer of timers) clearInterval(timer);
    try {
      outputs?.stopAll(true);
      replay?.stop(true);
      virtualCamera?.stop();
      displays?.destroyAll();
    } catch (error) {
      console.error("[engine-worker] stopping outputs failed", error);
    }
    // Scenes, sources and meters are freed by the engine teardown itself.
    engine?.shutdown();
    engine = null;
    scenes = null;
    audio = null;
    audioProcessing = null;
    outputs = null;
    replay = null;
    displays = null;
    studioPreview = null;
    virtualCamera = null;
    mediaProbe = null;
  },
};

export type EngineHandlers = typeof handlers;

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(message) ? message : "generic";
}

port.on("message", ({ data }) => {
  const { id, method, args } = data;
  const handler = handlers[method] as ((...params: unknown[]) => unknown) | undefined;
  if (!handler) {
    port.postMessage({ kind: "error", id, code: "invalid-request" });
    return;
  }
  try {
    port.postMessage({ kind: "result", id, value: handler(...args) });
  } catch (error) {
    console.error(`[engine-worker] ${method} failed`, error);
    port.postMessage({ kind: "error", id, code: errorCode(error) });
  }
});
