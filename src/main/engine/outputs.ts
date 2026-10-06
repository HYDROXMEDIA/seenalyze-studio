// Native multistreaming. Destinations with identical video requirements share
// one encoder; every destination gets its own output, connection, reconnect
// loop and statistics, so one failing destination never stops the others.

import { EventEmitter } from "node:events";
import type { DestinationConfig, DestinationProfile, DestinationStatus, OutputState, RecordingStatus } from "../../shared/types";
import { planEncoders } from "../../shared/planner";
import type { EngineSession } from "./engine";
import type { EOutputSignal, IAdvancedRecording, IAdvancedStreaming, IVideoEncoder } from "./osn";

export interface LiveDestination {
  config: DestinationConfig;
  server: string;
  streamKey: string;
}

interface EncoderGroupState {
  key: string;
  encoder: IVideoEncoder;
  users: Set<string>;
  index: number;
}

interface ActiveOutput {
  destinationId: string;
  stream: IAdvancedStreaming;
  group: EncoderGroupState;
  status: DestinationStatus;
}

const AUDIO_TRACK = 1;
const RECORDING_BITRATE_KBPS = 12000;

/** Maps libobs output stop codes to translation keys. */
function stopErrorKey(code: number): string | undefined {
  switch (code) {
    case 0:
      return undefined;
    case -1:
      return "errors.output.badPath";
    case -2:
      return "errors.output.connectFailed";
    case -3:
      return "errors.output.invalidStream";
    case -5:
      return "errors.output.disconnected";
    case -6:
      return "errors.output.unsupported";
    case -7:
      return "errors.output.noSpace";
    case -8:
      return "errors.output.encoder";
    default:
      return "errors.output.generic";
  }
}

function groupKey(profile: DestinationProfile): string {
  return [profile.codec, profile.width, profile.height, profile.fps, profile.videoBitrateKbps, profile.keyframeSec].join(":");
}

export class OutputManager extends EventEmitter {
  private readonly outputs = new Map<string, ActiveOutput>();
  private readonly groups = new Map<string, EncoderGroupState>();
  private nextGroupIndex = 0;
  private recording: { output: IAdvancedRecording; encoder: IVideoEncoder } | null = null;
  private recordingStatus: RecordingStatus = { active: false };

  constructor(private readonly engine: EngineSession) {
    super();
  }

  get isStreaming(): boolean {
    return this.outputs.size > 0;
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }

  statuses(): DestinationStatus[] {
    return [...this.outputs.values()].map((output) => ({ ...output.status }));
  }

  recordingState(): RecordingStatus {
    return { ...this.recordingStatus };
  }

  /** Starts every destination that is not already live. */
  start(destinations: LiveDestination[], encoderId: string): void {
    const pending = destinations.filter((destination) => !this.outputs.has(destination.config.id));
    if (pending.length === 0) return;

    // Frame rate is a property of the canvas, so every profile uses it.
    const fps = this.engine.settings.fps;
    const configs = pending.map(({ config }) => ({ ...config, profile: { ...config.profile, fps } }));
    const plan = planEncoders(configs);

    this.configureAudioTrack(configs);

    for (const group of plan.groups) {
      let encoderGroup: EncoderGroupState;
      try {
        encoderGroup = this.acquireGroup(group.profile, encoderId);
      } catch (error) {
        console.error("[outputs] failed to create an encoder", error);
        for (const id of group.destinationIds) this.emitStatus({ id, state: "error", kbps: 0, droppedFrames: 0, totalFrames: 0, encoderGroup: null, errorKey: "errors.output.startFailed" });
        continue;
      }
      // Reserve all users before starting: an early failure must not release
      // the encoder that the next destination in this group still needs.
      for (const id of group.destinationIds) encoderGroup.users.add(id);
      for (const destinationId of group.destinationIds) {
        const destination = pending.find((entry) => entry.config.id === destinationId);
        if (!destination) continue;
        try {
          this.startOutput(destination, encoderGroup, group.profile);
        } catch (error) {
          console.error(`[outputs] failed to start destination ${destinationId}`, error);
          const output = this.outputs.get(destinationId);
          if (output) this.teardown(output, "errors.output.startFailed");
          else this.releaseUser(encoderGroup, destinationId);
          this.emitStatus({
            id: destinationId,
            state: "error",
            kbps: 0,
            droppedFrames: 0,
            totalFrames: 0,
            encoderGroup: null,
            errorKey: "errors.output.startFailed",
          });
        }
      }
    }
  }

  stop(destinationIds: string[]): void {
    for (const id of destinationIds) {
      const output = this.outputs.get(id);
      if (!output) continue;
      this.setState(output, "stopping");
      try {
        output.stream.stop();
      } catch (error) {
        console.error(`[outputs] stop failed for ${id}; forcing`, error);
        this.teardown(output);
      }
    }
  }

  stopAll(force = false): void {
    for (const output of [...this.outputs.values()]) {
      try {
        output.stream.stop(force);
      } catch (error) {
        console.error(`[outputs] stop failed for ${output.destinationId}`, error);
      }
      if (force) this.teardown(output);
    }
  }

  /** Polls per-destination statistics. */
  refreshStats(): void {
    for (const output of this.outputs.values()) {
      output.status.kbps = Math.round(output.stream.kbitsPerSec);
      output.status.droppedFrames = output.stream.droppedFrames;
      output.status.totalFrames = output.stream.totalFrames;
    }
  }

  // ----- recording ----------------------------------------------------------

  startRecording(folder: string, encoderId: string): void {
    if (this.recording) return;
    const { osn } = this.engine;
    const encoder = osn.VideoEncoderFactory.create(encoderId, "seenalyze-recording", {
      rate_control: "CBR",
      bitrate: RECORDING_BITRATE_KBPS,
      keyint_sec: 2,
    });
    const output = osn.AdvancedRecordingFactory.create();
    output.path = folder;
    output.format = "mkv" as IAdvancedRecording["format"];
    output.fileFormat = "%CCYY-%MM-%DD %hh-%mm-%ss";
    output.overwrite = false;
    output.noSpace = false;
    output.video = this.engine.video;
    output.videoEncoder = encoder;
    output.mixer = 1 << (AUDIO_TRACK - 1);
    output.useStreamEncoders = false;
    output.signalHandler = (signal) => this.onRecordingSignal(signal);
    this.recording = { output, encoder };
    this.recordingStatus = { active: true, startedAt: Date.now() };
    this.emit("recording", this.recordingState());
    try {
      output.start();
    } catch (error) {
      console.error("[outputs] recording failed to start", error);
      this.finishRecording("errors.output.recordingFailed");
    }
  }

  stopRecording(): void {
    this.recording?.output.stop();
  }

  // ----- internals ----------------------------------------------------------

  private configureAudioTrack(configs: DestinationConfig[]): void {
    if (this.outputs.size > 0 || this.recording) return; // Track is in use; keep it stable.
    const bitrate = Math.max(...configs.map((config) => config.profile.audioBitrateKbps), 128);
    const { AudioTrackFactory } = this.engine.osn;
    AudioTrackFactory.setAtIndex(AudioTrackFactory.create(Math.min(bitrate, 320), "Track1"), AUDIO_TRACK);
  }

  private acquireGroup(profile: DestinationProfile, encoderId: string): EncoderGroupState {
    const key = `${encoderId}|${groupKey(profile)}`;
    const existing = this.groups.get(key);
    if (existing) return existing;
    const encoder = this.engine.osn.VideoEncoderFactory.create(encoderId, `seenalyze-video-${this.nextGroupIndex}`, {
      rate_control: "CBR",
      bitrate: profile.videoBitrateKbps,
      keyint_sec: profile.keyframeSec,
      profile: "high",
      bf: 2,
    });
    const group: EncoderGroupState = { key, encoder, users: new Set(), index: this.nextGroupIndex++ };
    this.groups.set(key, group);
    return group;
  }

  private startOutput(destination: LiveDestination, group: EncoderGroupState, profile: DestinationProfile): void {
    const { osn } = this.engine;
    const { config } = destination;
    const stream = osn.AdvancedStreamingFactory.create();
    try {
      stream.service = osn.ServiceFactory.create("rtmp_custom", `seenalyze-service-${config.id}`, {
        server: destination.server,
        key: destination.streamKey,
        use_auth: false,
      });
      stream.video = this.engine.video;
      stream.videoEncoder = group.encoder;
      stream.audioTrack = AUDIO_TRACK;
      stream.enforceServiceBitrate = false;
      stream.enableTwitchVOD = false;

      const settings = this.engine.settings;
      const rescale = profile.width !== settings.outputWidth || profile.height !== settings.outputHeight;
      stream.rescaling = rescale;
      if (rescale) {
        stream.outputWidth = profile.width;
        stream.outputHeight = profile.height;
      }

      const delay = osn.DelayFactory.create();
      delay.enabled = false;
      stream.delay = delay;

      const reconnect = osn.ReconnectFactory.create();
      reconnect.enabled = true;
      reconnect.retryDelay = 2;
      reconnect.maxRetries = 25;
      stream.reconnect = reconnect;

      const network = osn.NetworkFactory.create();
      // Dynamic bitrate would change the shared encoder for every destination in
      // the group; adaptation is a group decision, so it stays off per output.
      network.enableDynamicBitrate = false;
      network.enableOptimizations = false;
      network.enableLowLatency = false;
      stream.network = network;

      const output: ActiveOutput = {
        destinationId: config.id,
        stream,
        group,
        status: {
          id: config.id,
          state: "preparing",
          kbps: 0,
          droppedFrames: 0,
          totalFrames: 0,
          encoderGroup: group.index,
        },
      };
      stream.signalHandler = (signal) => this.onSignal(output, signal);
      group.users.add(config.id);
      this.outputs.set(config.id, output);
      this.emitStatus(output.status);
      stream.start();
    } catch (error) {
      if (!this.outputs.has(config.id)) osn.AdvancedStreamingFactory.destroy(stream);
      throw error;
    }
  }

  private onSignal(output: ActiveOutput, signal: EOutputSignal): void {
    switch (signal.signal) {
      case "starting":
        this.setState(output, "connecting");
        break;
      // "activate" fires before the connection exists; only "start" means live.
      case "start":
      case "reconnect_success":
        output.status.errorKey = undefined;
        if (output.status.state !== "live") output.status.startedAt ??= Date.now();
        this.setState(output, "live");
        break;
      case "reconnect":
        this.setState(output, "reconnecting");
        break;
      case "stopping":
        this.setState(output, "stopping");
        break;
      case "stop": {
        const errorKey = stopErrorKey(signal.code);
        this.teardown(output, errorKey);
        break;
      }
      default:
        break;
    }
  }

  private teardown(output: ActiveOutput, errorKey?: string): void {
    if (!this.outputs.has(output.destinationId)) return;
    this.outputs.delete(output.destinationId);
    try {
      this.engine.osn.AdvancedStreamingFactory.destroy(output.stream);
    } catch (error) {
      console.error(`[outputs] failed to release output ${output.destinationId}`, error);
    }
    this.releaseUser(output.group, output.destinationId);
    this.emitStatus({
      id: output.destinationId,
      state: errorKey ? "error" : "idle",
      kbps: 0,
      droppedFrames: output.status.droppedFrames,
      totalFrames: output.status.totalFrames,
      encoderGroup: null,
      errorKey,
    });
  }

  private releaseUser(group: EncoderGroupState, destinationId: string): void {
    group.users.delete(destinationId);
    if (group.users.size > 0) return;
    this.groups.delete(group.key);
    try {
      group.encoder.release();
    } catch (error) {
      console.error("[outputs] failed to release encoder", error);
    }
  }

  private onRecordingSignal(signal: EOutputSignal): void {
    if (signal.signal === "stop") this.finishRecording(signal.code === 0 ? undefined : "errors.output.recordingFailed");
  }

  private finishRecording(errorKey?: string): void {
    if (!this.recording) return;
    const { output, encoder } = this.recording;
    let lastFile: string | undefined;
    try {
      lastFile = output.lastFile();
    } catch (error) {
      console.error("[outputs] could not read the recording file name", error);
    }
    this.engine.osn.AdvancedRecordingFactory.destroy(output);
    encoder.release();
    this.recording = null;
    this.recordingStatus = { active: false, lastFile, errorKey };
    this.emit("recording", this.recordingState());
  }

  private setState(output: ActiveOutput, state: OutputState): void {
    output.status.state = state;
    this.emitStatus(output.status);
  }

  private emitStatus(status: DestinationStatus): void {
    this.emit("status", { ...status });
  }
}
