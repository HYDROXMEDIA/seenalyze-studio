// Engine session: starts the libobs host process, owns the main video canvas
// and reports performance statistics.

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { EncoderOption, EngineStats, ScaleFilter, VideoSettings } from "../../shared/types";
import { pipeName, stopHost, stopOrphanedHosts } from "./orphans";
import { loadOsn, osnRoot, type IVideo, type OSN } from "./osn";
import { applyAudioFormat, videoFormatInfo } from "./formats";
import type { AudioFormat } from "../../shared/formats";

// libobs enum values (const enums cannot be imported across isolated modules).
// Color format, space and range come from formats.ts.
const SCALE_TYPES: Record<ScaleFilter, number> = { bicubic: 2, bilinear: 3, lanczos: 4, area: 5 };
// Fractional uses fpsNum/fpsDen directly, which covers integer rates too.
const FPS_FRACTIONAL = 2;
// The host needs a few hundred ms to destroy the engine after disconnecting;
// stays well under the client's 12 s shutdown deadline.
const HOST_EXIT_GRACE_MS = 5000;
// A host we launched ourselves (macOS) stays idle after teardown and
// disconnect instead of exiting, so it only gets a short grace period.
const LAUNCHED_HOST_EXIT_GRACE_MS = 500;

/**
 * Engine encoder names in order of preference. The engine maps these to the
 * concrete libobs encoder ids listed alongside them.
 */
const ENCODER_CANDIDATES: { id: string; hardware: boolean; requires: string[] }[] = [
  { id: "apple_h264", hardware: true, requires: ["com.apple.videotoolbox.videoencoder.ave.avc"] },
  { id: "nvenc", hardware: true, requires: ["obs_nvenc_h264_tex", "jim_nvenc", "ffmpeg_nvenc"] },
  { id: "amd", hardware: true, requires: ["h264_texture_amf"] },
  { id: "qsv", hardware: true, requires: ["obs_qsv11", "obs_qsv11_v2"] },
  { id: "x264", hardware: false, requires: ["obs_x264"] },
];

export interface PerformanceStatistics {
  CPU?: number;
  frameRate?: number;
  numberDroppedFrames?: number;
  percentageDroppedFrames?: number;
  memoryUsage?: number;
}

export class EngineSession {
  readonly osn: OSN;
  private context: IVideo | null = null;
  private pipe = "";
  private videoSettings: VideoSettings;

  constructor(
    video: VideoSettings,
    /** `audioFormat` is applied before any source exists; absent keeps the engine default. */
    private readonly options: { dataDir: string; appVersion: string; audioFormat?: AudioFormat },
  ) {
    this.osn = loadOsn();
    this.videoSettings = video;
  }

  start(): void {
    const { NodeObs } = this.osn;
    const stopped = stopOrphanedHosts();
    if (stopped > 0) console.warn(`[engine] stopped ${stopped} leftover engine process(es)`);
    this.pipe = pipeName(randomUUID());
    if (process.platform === "darwin") {
      launchHost(this.pipe);
      NodeObs.IPC.connect(this.pipe);
    } else {
      NodeObs.IPC.host(this.pipe);
    }
    NodeObs.SetWorkingDirectory(osnRoot());
    const engineData = path.join(this.options.dataDir, "engine");
    mkdirSync(engineData, { recursive: true });
    disableCrashUploads(engineData);
    const result = NodeObs.OBS_API_initAPI("en-US", engineData, this.options.appVersion, "") as number;
    if (result !== 0) {
      this.disconnect();
      throw new Error(result === -2 ? "engine-graphics-missing" : "engine-init-failed");
    }
    if (this.options.audioFormat) {
      try {
        applyAudioFormat(this.osn, this.options.audioFormat);
      } catch (error) {
        console.warn("[engine] audio format not applied; using the default", error);
      }
    }
    this.context = this.osn.VideoFactory.create();
    this.applyVideo(this.videoSettings);
  }

  get video(): IVideo {
    if (!this.context) throw new Error("engine-not-ready");
    return this.context;
  }

  get settings(): VideoSettings {
    return this.videoSettings;
  }

  applyVideo(settings: VideoSettings): void {
    this.videoSettings = settings;
    this.video.video = {
      ...videoFormatInfo(settings),
      baseWidth: settings.baseWidth,
      baseHeight: settings.baseHeight,
      outputWidth: settings.outputWidth,
      outputHeight: settings.outputHeight,
      scaleType: SCALE_TYPES[settings.scaleFilter] ?? SCALE_TYPES.bicubic,
      fpsType: FPS_FRACTIONAL,
    };
  }

  availableEncoders(): EncoderOption[] {
    const installed = new Set(this.osn.VideoEncoderFactory.types());
    return ENCODER_CANDIDATES.filter((candidate) => candidate.requires.some((id) => installed.has(id))).map(
      ({ id, hardware }) => ({ id, hardware }),
    );
  }

  stats(): EngineStats {
    const stats = this.osn.NodeObs.OBS_API_getPerformanceStatistics() as PerformanceStatistics;
    return {
      cpu: Number(stats.CPU ?? 0),
      fps: Number(stats.frameRate ?? 0),
      renderLagFrames: this.osn.Global.laggedFrames,
      totalFrames: this.osn.Global.totalFrames,
      memoryMb: Number(stats.memoryUsage ?? 0),
    };
  }

  /**
   * Tears the engine down. Sources and scenes must NOT be released first: the
   * engine enumerates them during destroy and crashes on freed objects. The
   * host destroys the engine itself when we disconnect; calling
   * OBS_API_destroyOBS_API here as well made it run twice and crash on every
   * quit. A host that has not exited after the grace period is stopped.
   * Exception: a host we launched ourselves (macOS, see launchHost) does not
   * tear down on disconnect, so it gets the explicit destroy call.
   */
  shutdown(): void {
    try {
      this.osn.NodeObs.InitShutdownSequence();
      if (process.platform === "darwin") this.osn.NodeObs.OBS_API_destroyOBS_API();
    } catch (error) {
      console.error("[engine] engine teardown failed", error);
    } finally {
      this.context = null;
      this.disconnect();
      if (this.pipe) {
        stopHost(this.pipe, process.platform === "darwin" ? LAUNCHED_HOST_EXIT_GRACE_MS : HOST_EXIT_GRACE_MS);
      }
    }
  }

  private disconnect(): void {
    try {
      this.osn.NodeObs.IPC.disconnect();
    } catch (error) {
      console.error("[engine] failed to disconnect from the engine host", error);
    }
  }
}

/**
 * Starts the macOS engine host with stdin/stdout/stderr open on /dev/null.
 * The client's own launcher (`IPC.host`) can leave them closed; the host's
 * reply pipe then becomes fd 2, its log lines are written into the IPC
 * channel, and the first reply after browser-source init is read as garbage
 * (the worker aborts and the preview stays black).
 */
function launchHost(pipe: string): void {
  const host = spawn(path.join(osnRoot(), "bin", "obs64"), [pipe, "DEVMODE_VERSION", osnRoot()], {
    cwd: osnRoot(),
    stdio: "ignore",
  });
  host.on("error", (error) => console.error("[engine] could not start the engine host", error));
}

/**
 * The bundled crash handler would try to upload engine crash reports to a
 * remote server. Reports stay local unless the user explicitly shares them.
 */
function disableCrashUploads(engineData: string): void {
  const tool = path.join(osnRoot(), process.platform === "win32" ? "crashpad_database_util.exe" : "crashpad_database_util");
  if (!existsSync(tool)) return;
  try {
    execFileSync(tool, ["--create", `--database=${path.join(engineData, "Crashpad")}`, "--set-uploads-enabled=false"], {
      timeout: 5000,
      windowsHide: true,
    });
  } catch (error) {
    console.warn("[engine] could not disable crash report uploads", error);
  }
}
