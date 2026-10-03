// Engine session: starts the libobs host process, owns the main video canvas
// and reports performance statistics.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { EncoderOption, EngineStats, VideoSettings } from "../../shared/types";
import { pipeName, stopHost, stopOrphanedHosts } from "./orphans";
import { loadOsn, osnRoot, type IVideo, type OSN } from "./osn";

// libobs enum values (const enums cannot be imported across isolated modules).
const VIDEO_FORMAT_NV12 = 2;
const COLORSPACE_709 = 2;
const RANGE_PARTIAL = 1;
const SCALE_BICUBIC = 2;
// Fractional uses fpsNum/fpsDen directly, which covers integer rates too.
const FPS_FRACTIONAL = 2;

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
    private readonly options: { dataDir: string; appVersion: string },
  ) {
    this.osn = loadOsn();
    this.videoSettings = video;
  }

  start(): void {
    const { NodeObs } = this.osn;
    const stopped = stopOrphanedHosts();
    if (stopped > 0) console.warn(`[engine] stopped ${stopped} leftover engine process(es)`);
    this.pipe = pipeName(randomUUID());
    NodeObs.IPC.host(this.pipe);
    NodeObs.SetWorkingDirectory(osnRoot());
    const engineData = path.join(this.options.dataDir, "engine");
    mkdirSync(engineData, { recursive: true });
    disableCrashUploads(engineData);
    const result = NodeObs.OBS_API_initAPI("en-US", engineData, this.options.appVersion, "") as number;
    if (result !== 0) {
      this.disconnect();
      throw new Error(result === -2 ? "engine-graphics-missing" : "engine-init-failed");
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
      fpsNum: settings.fps,
      fpsDen: 1,
      baseWidth: settings.baseWidth,
      baseHeight: settings.baseHeight,
      outputWidth: settings.outputWidth,
      outputHeight: settings.outputHeight,
      outputFormat: VIDEO_FORMAT_NV12,
      colorspace: COLORSPACE_709,
      range: RANGE_PARTIAL,
      scaleType: SCALE_BICUBIC,
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
   * host process does not always exit on its own, so it is stopped explicitly.
   */
  shutdown(): void {
    const { NodeObs } = this.osn;
    try {
      NodeObs.InitShutdownSequence();
      NodeObs.OBS_API_destroyOBS_API();
    } catch (error) {
      console.error("[engine] engine teardown failed", error);
    } finally {
      this.context = null;
      this.disconnect();
      if (this.pipe) stopHost(this.pipe);
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
