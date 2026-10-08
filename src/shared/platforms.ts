// Platform capability registry. Values come from each platform's published
// encoder guidance (checked 2026-10-02) and are defaults, not hard promises.

import { ENCODER_PRESETS, type DestinationProfile, type Platform } from "./types";

export interface BitrateRange {
  min: number;
  max: number;
  recommended: number;
}

export interface PlatformSpec {
  platform: Platform;
  defaultServer: string;
  maxVideoBitrateKbps: number;
  keyframeSec: number;
  /** Keyframe intervals the platform accepts, in seconds. */
  keyframeOptions: readonly number[];
  maxAudioBitrateKbps: number;
  defaultProfile: DestinationProfile;
}

/** AAC bitrates offered for the shared audio track (the engine needs at least 128). */
export const AUDIO_BITRATES = [128, 160, 192, 256, 320] as const;

const BASE_PROFILE: DestinationProfile = {
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitrateKbps: 6000,
  audioBitrateKbps: 160,
  keyframeSec: 2,
  codec: "h264",
  encoderPreset: "balanced",
};

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  youtube: {
    platform: "youtube",
    // Overwritten by the ingestion address YouTube returns for account streams.
    defaultServer: "rtmps://a.rtmps.youtube.com/live2",
    maxVideoBitrateKbps: 51000,
    keyframeSec: 2,
    keyframeOptions: [1, 2, 3, 4],
    maxAudioBitrateKbps: 320,
    defaultProfile: { ...BASE_PROFILE },
  },
  twitch: {
    platform: "twitch",
    defaultServer: "rtmp://live.twitch.tv/app",
    maxVideoBitrateKbps: 6000,
    keyframeSec: 2,
    keyframeOptions: [2],
    maxAudioBitrateKbps: 160,
    defaultProfile: { ...BASE_PROFILE },
  },
};

type Tier = { minHeight: number; high: BitrateRange; standard: BitrateRange };

/**
 * Video bitrate guidance per output height, for high (above 30) and standard
 * frame rates. YouTube: live encoder settings table. Twitch: broadcasting
 * guidelines, capped at its 6000 kbps ingest limit.
 */
const BITRATE_TIERS: Record<Platform, Tier[]> = {
  youtube: [
    { minHeight: 2160, high: { min: 20000, max: 51000, recommended: 35000 }, standard: { min: 13000, max: 34000, recommended: 25000 } },
    { minHeight: 1440, high: { min: 9000, max: 18000, recommended: 15000 }, standard: { min: 6000, max: 13000, recommended: 10000 } },
    { minHeight: 1080, high: { min: 4500, max: 9000, recommended: 9000 }, standard: { min: 3000, max: 6000, recommended: 6000 } },
    { minHeight: 720, high: { min: 2250, max: 6000, recommended: 4500 }, standard: { min: 1500, max: 4000, recommended: 4000 } },
    { minHeight: 0, high: { min: 500, max: 2000, recommended: 2000 }, standard: { min: 500, max: 2000, recommended: 2000 } },
  ],
  twitch: [
    { minHeight: 1080, high: { min: 4500, max: 6000, recommended: 6000 }, standard: { min: 3500, max: 6000, recommended: 4500 } },
    { minHeight: 720, high: { min: 3500, max: 6000, recommended: 4500 }, standard: { min: 2500, max: 4500, recommended: 3000 } },
    { minHeight: 0, high: { min: 1000, max: 2500, recommended: 2000 }, standard: { min: 1000, max: 2500, recommended: 2000 } },
  ],
};

/** The platform's recommended video bitrate range for an output size and frame rate. */
export function bitrateRange(platform: Platform, height: number, fps: number): BitrateRange {
  const tiers = BITRATE_TIERS[platform];
  const tier = tiers.find((entry) => height >= entry.minHeight) ?? tiers[tiers.length - 1];
  return { ...(fps > 30 ? tier.high : tier.standard) };
}

/** Where a bitrate sits relative to the platform's recommended range. */
export function bitrateFit(range: BitrateRange, kbps: number): "low" | "ok" | "high" {
  if (kbps < range.min) return "low";
  if (kbps > range.max) return "high";
  return "ok";
}

function nearest(options: readonly number[], value: number): number {
  return options.reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best), options[0]);
}

export function clampProfile(platform: Platform, profile: DestinationProfile): DestinationProfile {
  const spec = PLATFORM_SPECS[platform];
  const audioOptions = AUDIO_BITRATES.filter((kbps) => kbps <= spec.maxAudioBitrateKbps);
  const audio = Number(profile.audioBitrateKbps);
  const keyframe = Number(profile.keyframeSec);
  return {
    ...profile,
    videoBitrateKbps: Math.min(Math.max(500, Math.round(profile.videoBitrateKbps)), spec.maxVideoBitrateKbps),
    audioBitrateKbps: nearest(audioOptions, Number.isFinite(audio) ? audio : BASE_PROFILE.audioBitrateKbps),
    keyframeSec: spec.keyframeOptions.includes(keyframe) ? keyframe : spec.keyframeSec,
    codec: "h264",
    encoderPreset: profile.encoderPreset && ENCODER_PRESETS.includes(profile.encoderPreset) ? profile.encoderPreset : "balanced",
  };
}
