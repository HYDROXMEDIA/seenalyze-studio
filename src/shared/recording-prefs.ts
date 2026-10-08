// Recording and instant-replay preferences: defaults, validation, and the
// recording bitrate that "Same as stream" resolves to.

import { RECORDING_BITRATE_RANGE, REPLAY_SECONDS_RANGE, type DestinationConfig, type StudioPreferences } from "./types";

export type CapturePreferences = Pick<
  StudioPreferences,
  "recordingMatchStream" | "autoRecord" | "keepRecordingAfterStream" | "replayBufferEnabled" | "replayBufferSeconds"
>;

export const DEFAULT_CAPTURE_PREFERENCES: CapturePreferences = {
  recordingMatchStream: false,
  autoRecord: false,
  keepRecordingAfterStream: false,
  replayBufferEnabled: false,
  replayBufferSeconds: 30,
};

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

export function sanitizeCapturePreferences(value: Partial<Record<keyof CapturePreferences, unknown>>): CapturePreferences {
  const seconds = Math.round(Number(value.replayBufferSeconds));
  return {
    recordingMatchStream: bool(value.recordingMatchStream, DEFAULT_CAPTURE_PREFERENCES.recordingMatchStream),
    autoRecord: bool(value.autoRecord, DEFAULT_CAPTURE_PREFERENCES.autoRecord),
    keepRecordingAfterStream: bool(value.keepRecordingAfterStream, DEFAULT_CAPTURE_PREFERENCES.keepRecordingAfterStream),
    replayBufferEnabled: bool(value.replayBufferEnabled, DEFAULT_CAPTURE_PREFERENCES.replayBufferEnabled),
    replayBufferSeconds:
      Number.isFinite(seconds) && seconds >= REPLAY_SECONDS_RANGE.min && seconds <= REPLAY_SECONDS_RANGE.max
        ? seconds
        : DEFAULT_CAPTURE_PREFERENCES.replayBufferSeconds,
  };
}

/**
 * The bitrate a recording uses. "Same as stream" takes the highest bitrate of
 * the enabled destinations (the best quality being streamed), within the
 * recording range; with no destination it keeps the chosen bitrate.
 */
export function recordingBitrate(preferences: Pick<StudioPreferences, "recordingBitrateKbps" | "recordingMatchStream">, destinations: Pick<DestinationConfig, "enabled" | "profile">[]): number {
  if (!preferences.recordingMatchStream) return preferences.recordingBitrateKbps;
  const rates = destinations.filter((destination) => destination.enabled).map((destination) => destination.profile.videoBitrateKbps);
  if (rates.length === 0) return preferences.recordingBitrateKbps;
  return Math.min(RECORDING_BITRATE_RANGE.max, Math.max(RECORDING_BITRATE_RANGE.min, Math.max(...rates)));
}
