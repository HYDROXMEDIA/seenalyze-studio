import { describe, expect, test } from "bun:test";
import {
  colorFormatsFor,
  formatFrameRate,
  frameRateOf,
  parseFrameRate,
  sanitizeAudioFormat,
  sanitizeRecordingTracks,
  sanitizeSourceTracks,
  sanitizeVideoFormat,
  toggleTrack,
  tracksOf,
} from "./formats";

describe("frame rates", () => {
  test("parses whole, NTSC decimal and fraction input", () => {
    expect(parseFrameRate("30")).toEqual({ num: 30, den: 1 });
    expect(parseFrameRate("29.97")).toEqual({ num: 30000, den: 1001 });
    expect(parseFrameRate("59,94")).toEqual({ num: 60000, den: 1001 });
    expect(parseFrameRate("23.976")).toEqual({ num: 24000, den: 1001 });
    expect(parseFrameRate("119.88")).toEqual({ num: 120000, den: 1001 });
    expect(parseFrameRate(" 30000 / 1001 ")).toEqual({ num: 30000, den: 1001 });
    expect(parseFrameRate("12.5")).toEqual({ num: 25, den: 2 });
  });

  test("rejects malformed or out-of-range rates", () => {
    for (const input of ["", "abc", "-30", "0", "0/1", "30/0", "1000", "1/2", "3e1", "30fps"]) expect(parseFrameRate(input)).toBeNull();
  });

  test("formats rates as people write them", () => {
    expect(formatFrameRate({ num: 30000, den: 1001 })).toBe("29.97");
    expect(formatFrameRate({ num: 24000, den: 1001 })).toBe("23.976");
    expect(formatFrameRate({ num: 60, den: 1 })).toBe("60");
  });

  test("video settings keep a whole fps unless a fraction is set", () => {
    expect(sanitizeVideoFormat({ fps: 30 }, 30)).toEqual({ fps: 30 });
    expect(sanitizeVideoFormat({ fps: 120 }, 30)).toEqual({ fps: 120 });
    expect(sanitizeVideoFormat({ fps: 1000 }, 30)).toEqual({ fps: 30 });
    expect(sanitizeVideoFormat({ fps: 30, fpsNum: 60000, fpsDen: 1001 }, 30)).toEqual({ fps: 60, fpsNum: 60000, fpsDen: 1001 });
    // A whole-number fraction is stored as plain fps.
    expect(sanitizeVideoFormat({ fps: 30, fpsNum: 120, fpsDen: 2 }, 30)).toEqual({ fps: 60 });
    expect(sanitizeVideoFormat({ fps: 30, fpsNum: 1, fpsDen: 0 }, 30)).toEqual({ fps: 30 });
    expect(frameRateOf({ fps: 60, fpsNum: 60000, fpsDen: 1001 })).toEqual({ num: 60000, den: 1001 });
    expect(frameRateOf({ fps: 25 })).toEqual({ num: 25, den: 1 });
  });

  test("color values: defaults are not stored, unknown ones are dropped", () => {
    expect(sanitizeVideoFormat({ fps: 30, colorFormat: "nv12", colorSpace: "709", colorRange: "partial" }, 30)).toEqual({ fps: 30 });
    expect(sanitizeVideoFormat({ fps: 30, colorFormat: "i444", colorSpace: "601", colorRange: "full" }, 30)).toEqual({ fps: 30, colorFormat: "i444", colorSpace: "601", colorRange: "full" });
    expect(sanitizeVideoFormat({ fps: 30, colorFormat: "p010", colorSpace: "2100pq", colorRange: "huge" }, 30)).toEqual({ fps: 30 });
  });

  test("4:4:4 is only offered with the software encoder", () => {
    expect(colorFormatsFor("x264")).toContain("i444");
    expect(colorFormatsFor("apple_h264")).not.toContain("i444");
  });
});

describe("audio format and tracks", () => {
  test("audio format must be a known rate and layout", () => {
    expect(sanitizeAudioFormat({ sampleRate: 44100, speakers: "mono" })).toEqual({ sampleRate: 44100, speakers: "mono" });
    expect(sanitizeAudioFormat({ sampleRate: 96000, speakers: "stereo" })).toBeNull();
    expect(sanitizeAudioFormat({ sampleRate: 48000, speakers: "9.1" })).toBeNull();
    expect(sanitizeAudioFormat(null)).toBeNull();
  });

  test("recordings keep at least one track", () => {
    expect(sanitizeRecordingTracks(0)).toBe(1);
    expect(sanitizeRecordingTracks(0b1000000)).toBe(1);
    expect(sanitizeRecordingTracks(0b101)).toBe(0b101);
    expect(sanitizeRecordingTracks("3")).toBe(1);
  });

  test("source tracks: all six is the default, none is allowed", () => {
    expect(sanitizeSourceTracks(255)).toBeUndefined();
    expect(sanitizeSourceTracks(63)).toBeUndefined();
    expect(sanitizeSourceTracks(0)).toBe(0);
    expect(sanitizeSourceTracks(3)).toBe(3);
    expect(sanitizeSourceTracks(-1)).toBeUndefined();
  });

  test("track lists and toggles", () => {
    expect(tracksOf(0b100101)).toEqual([1, 3, 6]);
    expect(toggleTrack(1, 2, true)).toBe(3);
    expect(toggleTrack(3, 1, false)).toBe(2);
    expect(toggleTrack(3, 7, true)).toBe(3);
  });
});
