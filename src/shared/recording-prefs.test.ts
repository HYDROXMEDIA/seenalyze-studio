import { describe, expect, test } from "bun:test";
import { DEFAULT_CAPTURE_PREFERENCES, recordingBitrate, sanitizeCapturePreferences } from "./recording-prefs";

const destination = (enabled: boolean, videoBitrateKbps: number) => ({
  enabled,
  profile: { width: 1920, height: 1080, fps: 30, videoBitrateKbps, audioBitrateKbps: 160, keyframeSec: 2, codec: "h264" as const },
});

describe("capture preferences", () => {
  test("older saved state gets the defaults", () => {
    expect(sanitizeCapturePreferences({})).toEqual(DEFAULT_CAPTURE_PREFERENCES);
  });

  test("invalid values fall back; valid ones are kept", () => {
    expect(sanitizeCapturePreferences({ autoRecord: "yes", replayBufferSeconds: 2, replayBufferEnabled: true })).toEqual({
      ...DEFAULT_CAPTURE_PREFERENCES,
      replayBufferEnabled: true,
    });
    expect(sanitizeCapturePreferences({ replayBufferSeconds: 90.4 }).replayBufferSeconds).toBe(90);
    expect(sanitizeCapturePreferences({ replayBufferSeconds: 301 }).replayBufferSeconds).toBe(30);
  });
});

describe("recording bitrate", () => {
  test("a fixed bitrate is used as is", () => {
    expect(recordingBitrate({ recordingBitrateKbps: 12000, recordingMatchStream: false }, [destination(true, 6000)])).toBe(12000);
  });

  test("same as stream follows the best enabled destination", () => {
    const destinations = [destination(true, 6000), destination(true, 9000), destination(false, 40000)];
    expect(recordingBitrate({ recordingBitrateKbps: 12000, recordingMatchStream: true }, destinations)).toBe(9000);
  });

  test("same as stream without destinations keeps the chosen bitrate and stays in range", () => {
    expect(recordingBitrate({ recordingBitrateKbps: 12000, recordingMatchStream: true }, [])).toBe(12000);
    expect(recordingBitrate({ recordingBitrateKbps: 12000, recordingMatchStream: true }, [destination(true, 1000)])).toBe(2500);
  });
});
