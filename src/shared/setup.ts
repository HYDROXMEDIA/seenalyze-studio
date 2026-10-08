// First-run setup decisions: pure functions so the wizard's recommendations
// are testable without the engine or a window.

import { bitrateRange, clampProfile, PLATFORM_SPECS } from "./platforms";
import type { DestinationProfile, EncoderOption, Platform, SourceTransform, VideoSettings } from "./types";

export const SETUP_GOALS = ["stream", "record", "both"] as const;
export type SetupGoal = (typeof SETUP_GOALS)[number];

export const STARTER_LAYOUTS = ["screenCamera", "cameraOnly", "screenOnly"] as const;
export type StarterLayout = (typeof STARTER_LAYOUTS)[number];

/** 16:9 canvas sizes, largest first. Larger canvases cost GPU time for little gain. */
const CANVAS_SIZES = [
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
];

/** Hardware encoders keep the computer responsive; software is the fallback. */
export function recommendEncoder(encoders: EncoderOption[]): EncoderOption | undefined {
  return encoders.find((encoder) => encoder.hardware) ?? encoders[0];
}

export function streams(goal: SetupGoal): boolean {
  return goal !== "record";
}

/**
 * Canvas from the screen size (in physical pixels), output sized for the goal:
 * streams stay at or below 1080p, and a software encoder drops to 720p.
 */
export function recommendVideo(input: { screenWidth: number; screenHeight: number; goal: SetupGoal; hardware: boolean }): VideoSettings {
  const fits = (size: { width: number; height: number }) => size.width <= input.screenWidth && size.height <= input.screenHeight;
  const canvas = CANVAS_SIZES.find(fits) ?? CANVAS_SIZES[CANVAS_SIZES.length - 1];
  const cap = !input.hardware ? 720 : streams(input.goal) ? 1080 : canvas.height;
  const output = CANVAS_SIZES.find((size) => size.height <= Math.min(cap, canvas.height)) ?? CANVAS_SIZES[CANVAS_SIZES.length - 1];
  return {
    baseWidth: canvas.width,
    baseHeight: canvas.height,
    outputWidth: output.width,
    outputHeight: output.height,
    // Recording only with a hardware encoder can afford smoother motion.
    fps: input.hardware && input.goal === "record" ? 60 : 30,
    scaleFilter: "bicubic",
  };
}

/**
 * Video bitrate per platform. When every platform's recommended range
 * overlaps, all get one shared value so a single encode serves them all.
 */
export function suggestBitrates(platforms: Platform[], height: number, fps: number): Partial<Record<Platform, number>> {
  const unique = [...new Set(platforms)];
  const ranges = unique.map((platform) => ({ platform, range: bitrateRange(platform, height, fps) }));
  const result: Partial<Record<Platform, number>> = {};
  if (ranges.length === 0) return result;
  const low = Math.max(...ranges.map(({ range }) => range.min));
  const high = Math.min(...ranges.map(({ range }) => range.max));
  if (low <= high) {
    const shared = Math.min(Math.max(Math.min(...ranges.map(({ range }) => range.recommended)), low), high);
    for (const { platform } of ranges) result[platform] = shared;
    return result;
  }
  for (const { platform, range } of ranges) result[platform] = range.recommended;
  return result;
}

/** Destination profile for a platform at the chosen output size. */
export function setupProfile(platform: Platform, video: VideoSettings, videoBitrateKbps: number): DestinationProfile {
  return clampProfile(platform, {
    ...PLATFORM_SPECS[platform].defaultProfile,
    width: video.outputWidth,
    height: video.outputHeight,
    fps: video.fps,
    videoBitrateKbps,
  });
}

export interface LayoutSource {
  kind: "display" | "camera";
  /** Placement on the canvas; absent keeps the engine's fit-to-canvas default. */
  transform?: SourceTransform;
}

const CAMERA_WIDTH_SHARE = 0.25;
const CAMERA_MARGIN_SHARE = 0.025;

/** Sources of a starter layout, bottom to top, placed for the canvas size. */
export function layoutSources(layout: StarterLayout, canvasWidth: number, canvasHeight: number): LayoutSource[] {
  if (layout === "screenOnly") return [{ kind: "display" }];
  if (layout === "cameraOnly") return [{ kind: "camera" }];
  const width = Math.round(canvasWidth * CAMERA_WIDTH_SHARE);
  const height = Math.round((width * 9) / 16);
  const margin = Math.round(canvasHeight * CAMERA_MARGIN_SHARE);
  return [
    { kind: "display" },
    {
      kind: "camera",
      transform: {
        x: canvasWidth - margin,
        y: canvasHeight - margin,
        width,
        height,
        rotation: 0,
        sizing: "fit",
        anchor: "bottomRight",
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
      },
    },
  ];
}

/** A scene name not used yet: the base name, then "base 2", "base 3"… */
export function uniqueSceneName(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base} ${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}
