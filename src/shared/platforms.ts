// Platform capability registry. Values come from each platform's published
// encoder guidance (checked 2026-10-02) and are defaults, not hard promises.

import type { DestinationProfile, Platform } from "./types";

export interface PlatformSpec {
  platform: Platform;
  defaultServer: string;
  maxVideoBitrateKbps: number;
  keyframeSec: number;
  defaultProfile: DestinationProfile;
}

const BASE_PROFILE: DestinationProfile = {
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitrateKbps: 6000,
  audioBitrateKbps: 160,
  keyframeSec: 2,
  codec: "h264",
};

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  youtube: {
    platform: "youtube",
    // Overwritten by the ingestion address YouTube returns for account streams.
    defaultServer: "rtmps://a.rtmps.youtube.com/live2",
    maxVideoBitrateKbps: 51000,
    keyframeSec: 2,
    defaultProfile: { ...BASE_PROFILE },
  },
  twitch: {
    platform: "twitch",
    defaultServer: "rtmp://live.twitch.tv/app",
    maxVideoBitrateKbps: 6000,
    keyframeSec: 2,
    defaultProfile: { ...BASE_PROFILE },
  },
};

export function clampProfile(platform: Platform, profile: DestinationProfile): DestinationProfile {
  const spec = PLATFORM_SPECS[platform];
  return {
    ...profile,
    videoBitrateKbps: Math.min(Math.max(500, Math.round(profile.videoBitrateKbps)), spec.maxVideoBitrateKbps),
    keyframeSec: spec.keyframeSec,
    codec: "h264",
  };
}
