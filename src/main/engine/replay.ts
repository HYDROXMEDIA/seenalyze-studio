// Instant replay: keeps the last seconds of the program in memory and writes
// them to the recording folder on request. It has its own encoder, so it keeps
// running independently of streams and recordings starting or stopping.

import { EventEmitter } from "node:events";
import type { RecordingFormat, ReplayStatus } from "../../shared/types";
import type { EngineSession } from "./engine";
import type { EOutputSignal, IAdvancedRecording, IAdvancedReplayBuffer, IVideoEncoder } from "./osn";

export interface ReplayOptions {
  folder: string;
  format: RecordingFormat;
  bitrateKbps: number;
  seconds: number;
}

interface ActiveReplay {
  buffer: IAdvancedReplayBuffer;
  /** Never started: the replay buffer takes its video encoder from a recording object. */
  holder: IAdvancedRecording;
  encoder: IVideoEncoder;
}

const AUDIO_MIXER = 1; // Track 1, shared with streams and recordings.

export class ReplayBuffer extends EventEmitter {
  private replay: ActiveReplay | null = null;
  private status: ReplayStatus = { active: false };
  private last: { encoderId: string; options: ReplayOptions } | null = null;

  constructor(
    private readonly engine: EngineSession,
    /** Keeps the shared audio track configured and stable while the buffer uses it. */
    private readonly audioTrack: { hold(): void; release(): void },
  ) {
    super();
  }

  state(): ReplayStatus {
    return { ...this.status };
  }

  get running(): boolean {
    return this.replay !== null;
  }

  start(encoderId: string, options: ReplayOptions): void {
    if (this.replay) return;
    this.last = { encoderId, options };
    const { osn } = this.engine;
    this.audioTrack.hold();
    let encoder: IVideoEncoder | null = null;
    let holder: IAdvancedRecording | null = null;
    let buffer: IAdvancedReplayBuffer | null = null;
    try {
      encoder = osn.VideoEncoderFactory.create(encoderId, "seenalyze-replay", {
        rate_control: "CBR",
        bitrate: options.bitrateKbps,
        keyint_sec: 2,
      });
      holder = osn.AdvancedRecordingFactory.create();
      holder.path = options.folder;
      holder.format = options.format as IAdvancedRecording["format"];
      holder.video = this.engine.video;
      holder.videoEncoder = encoder;
      holder.mixer = AUDIO_MIXER;
      holder.useStreamEncoders = false;

      buffer = osn.AdvancedReplayBufferFactory.create();
      buffer.path = options.folder;
      buffer.format = options.format as IAdvancedReplayBuffer["format"];
      buffer.fileFormat = "%CCYY-%MM-%DD %hh-%mm-%ss";
      buffer.prefix = "Replay";
      buffer.suffix = "";
      buffer.overwrite = false;
      buffer.noSpace = false;
      buffer.duration = options.seconds;
      buffer.video = this.engine.video;
      buffer.mixer = AUDIO_MIXER;
      buffer.usesStream = false;
      buffer.recording = holder;
      const replay: ActiveReplay = { buffer, holder, encoder };
      buffer.signalHandler = (signal) => this.onSignal(replay, signal);
      this.replay = replay;
      this.setStatus({ active: true });
      buffer.start();
    } catch (error) {
      console.error("[replay] instant replay failed to start", error);
      if (this.replay) this.finish("errors.output.replayFailed");
      else {
        this.release(buffer, holder, encoder);
        this.setStatus({ active: false, errorKey: "errors.output.replayFailed" });
      }
    }
  }

  stop(force = false): void {
    const replay = this.replay;
    if (!replay) return;
    try {
      replay.buffer.stop(force);
    } catch (error) {
      console.error("[replay] stop failed; releasing", error);
      this.finish();
      return;
    }
    if (force) this.finish();
  }

  /** Runs with these options (restarting when they changed), or stops with null. */
  configure(encoderId: string, options: ReplayOptions | null): void {
    if (!options) {
      this.stop();
      return;
    }
    const same = this.last?.encoderId === encoderId && JSON.stringify(this.last.options) === JSON.stringify(options);
    if (this.replay && same) return;
    if (this.replay) this.stop(true);
    this.start(encoderId, options);
  }

  /** Starts again with the last options, e.g. after the canvas changed. */
  restart(): void {
    if (this.replay || !this.last) return;
    this.start(this.last.encoderId, this.last.options);
  }

  save(): void {
    if (!this.replay) throw new Error("replay-not-running");
    this.replay.buffer.save();
  }

  private onSignal(replay: ActiveReplay, signal: EOutputSignal): void {
    if (this.replay !== replay) return;
    switch (signal.signal) {
      case "wrote": {
        let file: string | undefined;
        try {
          file = replay.buffer.lastFile();
        } catch (error) {
          console.error("[replay] could not read the clip file name", error);
        }
        this.emit("saved", file ?? "");
        break;
      }
      case "writing_error":
        this.emit("saveFailed");
        break;
      case "stop":
        this.finish(signal.code === 0 ? undefined : "errors.output.replayFailed");
        break;
      default:
        break;
    }
  }

  private finish(errorKey?: string): void {
    const replay = this.replay;
    if (!replay) return;
    this.replay = null;
    this.release(replay.buffer, replay.holder, replay.encoder);
    this.setStatus({ active: false, errorKey });
  }

  private release(buffer: IAdvancedReplayBuffer | null, holder: IAdvancedRecording | null, encoder: IVideoEncoder | null): void {
    const { osn } = this.engine;
    try {
      if (buffer) osn.AdvancedReplayBufferFactory.destroy(buffer);
      if (holder) osn.AdvancedRecordingFactory.destroy(holder);
      encoder?.release();
    } catch (error) {
      console.error("[replay] failed to release instant replay", error);
    }
    this.audioTrack.release();
  }

  private setStatus(status: ReplayStatus): void {
    this.status = status;
    this.emit("status", this.state());
  }
}
