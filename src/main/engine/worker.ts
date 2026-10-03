// Engine worker: runs in an Electron utility process and owns every libobs
// object. Engine calls are synchronous and can block (permission prompts,
// device or font enumeration, teardown), so they must never run on the main
// process, which drives the app window.

import type {
  AudioLevel,
  AudioSourceDTO,
  DestinationStatus,
  EncoderOption,
  EngineStats,
  PropertyDTO,
  RecordingStatus,
  SceneDTO,
  SourceKind,
  TransformPreset,
  VideoSettings,
} from "../../shared/types";
import { AudioMixer } from "./audio";
import { EngineSession } from "./engine";
import { setVendorRoot } from "./osn";
import { OutputManager, type LiveDestination } from "./outputs";
import { PreviewHost, type PreviewRequest, type PreviewResult } from "./preview";
import { SceneGraph, type SceneCollection } from "./scenes";

export interface EngineInit {
  vendorRoot: string;
  dataDir: string;
  appVersion: string;
  video: VideoSettings;
  collection: SceneCollection | null;
}

export interface EngineState {
  scenes: SceneDTO[];
  activeScene: string | null;
  audio: AudioSourceDTO[];
  encoders: EncoderOption[];
  recording: RecordingStatus;
  streaming: boolean;
}

export type EngineEvent =
  | { type: "status"; status: DestinationStatus }
  | { type: "recording"; status: RecordingStatus }
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
let outputs: OutputManager | null = null;
let preview: PreviewHost | null = null;
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
    engine = new EngineSession(options.video, { dataDir: options.dataDir, appVersion: options.appVersion });
    engine.start();
    scenes = new SceneGraph(engine);
    scenes.load(options.collection);
    audio = new AudioMixer(engine.osn, scenes);
    audio.sync();
    outputs = new OutputManager(engine);
    outputs.on("status", (status: DestinationStatus) => emit({ type: "status", status }));
    outputs.on("recording", (status: RecordingStatus) => emit({ type: "recording", status }));
    preview = new PreviewHost(engine);
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
      activeScene: graph.activeScene,
      audio: need(audio).list(),
      encoders: need(engine).availableEncoders(),
      recording: out.recordingState(),
      streaming: out.isStreaming,
    };
  },

  saveCollection(): SceneCollection {
    return need(scenes).save((name) => audio?.volumeOf(name));
  },

  // Scenes & sources
  createScene: (name: string) => withScenes((graph) => graph.createScene(name)),
  removeScene: (name: string) => withScenes((graph) => graph.removeScene(name)),
  renameScene: (name: string, next: string) => withScenes((graph) => graph.renameScene(name, next)),
  setActiveScene: (name: string) => withScenes((graph) => graph.setActiveScene(name)),
  addSource: (scene: string, kind: SourceKind, name: string, settings?: Record<string, unknown>): string =>
    withScenes((graph) => graph.addSource(scene, kind, name, settings)),
  retargetChatOverlays: (origin: string): number => need(scenes).retargetChatOverlays(origin),
  resizeOverlaySources: (overlayId: string, width: number, height: number): number => need(scenes).resizeOverlaySources(overlayId, width, height),
  removeSceneItem: (scene: string, itemId: number) => withScenes((graph) => graph.removeSceneItem(scene, itemId)),
  setItemVisible: (scene: string, itemId: number, visible: boolean) => need(scenes).setItemVisible(scene, itemId, visible),
  setItemLocked: (scene: string, itemId: number, locked: boolean) => need(scenes).setItemLocked(scene, itemId, locked),
  moveSceneItem: (scene: string, itemId: number, direction: "up" | "down") => need(scenes).moveSceneItem(scene, itemId, direction),
  applyTransform: (scene: string, itemId: number, preset: TransformPreset) => need(scenes).applyTransform(scene, itemId, preset),
  getProperties: (source: string): PropertyDTO[] => need(scenes).getProperties(source),
  updateSettings: (source: string, settings: Record<string, unknown>): PropertyDTO[] => need(scenes).updateSettings(source, settings),
  clickButton: (source: string, property: string): PropertyDTO[] => need(scenes).clickButton(source, property),
  renameSource(source: string, next: string): void {
    const graph = need(scenes);
    graph.renameSource(source, next);
    audio?.rename(source, next.trim());
  },

  // Audio
  setVolume: (source: string, deflection: number) => need(audio).setVolume(source, deflection),
  setMuted: (source: string, muted: boolean) => need(audio).setMuted(source, muted),

  // Video
  applyVideo(settings: VideoSettings): void {
    const current = need(engine).settings;
    need(engine).applyVideo(settings);
    need(scenes).rescale(current, settings);
  },
  availableEncoders: (): EncoderOption[] => need(engine).availableEncoders(),

  // Preview
  setPreview: (request: PreviewRequest): PreviewResult => need(preview).setBounds(request),
  hidePreview: () => preview?.destroy(),

  // Outputs
  startOutputs: (destinations: LiveDestination[], encoderId: string) => need(outputs).start(destinations, encoderId),
  stopOutputs: (ids: string[]) => need(outputs).stop(ids),
  startRecording: (folder: string, encoderId: string) => need(outputs).startRecording(folder, encoderId),
  stopRecording: () => need(outputs).stopRecording(),

  shutdown(): void {
    for (const timer of timers) clearInterval(timer);
    try {
      outputs?.stopAll(true);
      preview?.destroy();
    } catch (error) {
      console.error("[engine-worker] stopping outputs failed", error);
    }
    // Scenes, sources and meters are freed by the engine teardown itself.
    engine?.shutdown();
    engine = null;
    scenes = null;
    audio = null;
    outputs = null;
    preview = null;
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
