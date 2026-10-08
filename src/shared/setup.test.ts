import { describe, expect, test } from "bun:test";
import { encoderPresetSettings, supportsEncoderPreset } from "./encoder-presets";
import { planEncoders, sharedAudioBitrateKbps } from "./planner";
import { bitrateFit, bitrateRange, clampProfile, PLATFORM_SPECS } from "./platforms";
import { layoutSources, recommendEncoder, recommendVideo, setupProfile, suggestBitrates, uniqueSceneName } from "./setup";
import type { DestinationConfig, DestinationProfile } from "./types";

const base: DestinationProfile = { ...PLATFORM_SPECS.youtube.defaultProfile };

describe("platform bitrate guidance", () => {
  test("ranges depend on output height and frame rate", () => {
    expect(bitrateRange("youtube", 1080, 60)).toEqual({ min: 4500, max: 9000, recommended: 9000 });
    expect(bitrateRange("youtube", 1080, 30).max).toBe(6000);
    expect(bitrateRange("youtube", 2160, 60).max).toBe(51000);
    expect(bitrateRange("twitch", 720, 30)).toEqual({ min: 2500, max: 4500, recommended: 3000 });
    expect(bitrateRange("twitch", 480, 30).max).toBeLessThanOrEqual(PLATFORM_SPECS.twitch.maxVideoBitrateKbps);
  });

  test("Twitch ranges never exceed its ingest limit", () => {
    for (const height of [2160, 1440, 1080, 720, 480]) {
      for (const fps of [30, 60]) expect(bitrateRange("twitch", height, fps).max).toBeLessThanOrEqual(6000);
    }
  });

  test("fit reports out-of-range values", () => {
    const range = bitrateRange("twitch", 1080, 60);
    expect(bitrateFit(range, 3000)).toBe("low");
    expect(bitrateFit(range, 6000)).toBe("ok");
    expect(bitrateFit(range, 8000)).toBe("high");
  });
});

describe("clampProfile", () => {
  test("keeps allowed audio and keyframe choices", () => {
    const clean = clampProfile("youtube", { ...base, audioBitrateKbps: 256, keyframeSec: 4, encoderPreset: "quality" });
    expect(clean.audioBitrateKbps).toBe(256);
    expect(clean.keyframeSec).toBe(4);
    expect(clean.encoderPreset).toBe("quality");
  });

  test("caps values a platform does not accept", () => {
    const clean = clampProfile("twitch", { ...base, videoBitrateKbps: 9000, audioBitrateKbps: 320, keyframeSec: 4 });
    expect(clean.videoBitrateKbps).toBe(6000);
    expect(clean.audioBitrateKbps).toBe(160);
    expect(clean.keyframeSec).toBe(2);
  });

  test("profiles saved before the new fields get safe defaults", () => {
    const legacy = { ...base, encoderPreset: undefined, audioBitrateKbps: Number.NaN };
    const clean = clampProfile("youtube", legacy);
    expect(clean.encoderPreset).toBe("balanced");
    expect(clean.audioBitrateKbps).toBe(160);
    const tampered = clampProfile("youtube", { ...base, encoderPreset: "turbo" as never, audioBitrateKbps: 1000 });
    expect(tampered.encoderPreset).toBe("balanced");
    expect(tampered.audioBitrateKbps).toBe(320);
  });
});

describe("encoder presets", () => {
  test("balanced keeps the encoder default", () => {
    expect(encoderPresetSettings("x264", "balanced")).toEqual({});
    expect(encoderPresetSettings("nvenc", undefined)).toEqual({});
  });

  test("maps to each encoder's own setting", () => {
    expect(encoderPresetSettings("x264", "performance")).toEqual({ preset: "superfast" });
    expect(encoderPresetSettings("nvenc", "quality")).toEqual({ preset2: "p7" });
    expect(encoderPresetSettings("amd", "performance")).toEqual({ preset: "speed" });
    expect(encoderPresetSettings("qsv", "quality")).toEqual({ target_usage: "TU1" });
  });

  test("encoders without a speed preset ignore the choice", () => {
    expect(supportsEncoderPreset("apple_h264")).toBe(false);
    expect(encoderPresetSettings("apple_h264", "quality")).toEqual({});
    expect(encoderPresetSettings("toString", "quality")).toEqual({});
  });

  test("a different preset needs its own encode", () => {
    const destination = (id: string, profile: DestinationProfile): DestinationConfig => ({
      id, platform: "youtube", name: id, enabled: true, mode: "manual", server: "", hasStreamKey: true, profile,
    });
    expect(planEncoders([destination("a", base), destination("b", { ...base, encoderPreset: "quality" })]).groups).toHaveLength(2);
    // A legacy profile without a preset matches "balanced".
    expect(planEncoders([destination("a", { ...base, encoderPreset: undefined }), destination("b", base)]).groups).toHaveLength(1);
  });

  test("the shared audio track uses the lowest requested bitrate", () => {
    expect(sharedAudioBitrateKbps([{ ...base, audioBitrateKbps: 320 }, { ...base, audioBitrateKbps: 160 }])).toBe(160);
    expect(sharedAudioBitrateKbps([])).toBe(160);
  });
});

describe("first-run setup", () => {
  test("prefers a hardware encoder", () => {
    expect(recommendEncoder([{ id: "x264", hardware: false }, { id: "nvenc", hardware: true }])?.id).toBe("nvenc");
    expect(recommendEncoder([{ id: "x264", hardware: false }])?.id).toBe("x264");
    expect(recommendEncoder([])).toBeUndefined();
  });

  test("canvas follows the screen, streams stay at or below 1080p", () => {
    const retina = recommendVideo({ screenWidth: 3024, screenHeight: 1964, goal: "stream", hardware: true });
    expect([retina.baseWidth, retina.baseHeight, retina.outputHeight, retina.fps]).toEqual([2560, 1440, 1080, 30]);
    const small = recommendVideo({ screenWidth: 1366, screenHeight: 768, goal: "both", hardware: true });
    expect([small.baseHeight, small.outputHeight]).toEqual([720, 720]);
  });

  test("recording only keeps the canvas size and uses 60 fps on hardware", () => {
    const video = recommendVideo({ screenWidth: 2560, screenHeight: 1440, goal: "record", hardware: true });
    expect([video.outputHeight, video.fps]).toEqual([1440, 60]);
  });

  test("a software encoder drops to 720p30", () => {
    const video = recommendVideo({ screenWidth: 1920, screenHeight: 1080, goal: "stream", hardware: false });
    expect([video.baseHeight, video.outputWidth, video.outputHeight, video.fps]).toEqual([1080, 1280, 720, 30]);
  });

  test("overlapping ranges share one bitrate so one encode serves both", () => {
    expect(suggestBitrates(["youtube", "twitch"], 1080, 60)).toEqual({ youtube: 6000, twitch: 6000 });
    expect(suggestBitrates(["youtube", "twitch"], 1080, 30)).toEqual({ youtube: 4500, twitch: 4500 });
    expect(suggestBitrates(["youtube"], 1080, 60)).toEqual({ youtube: 9000 });
    expect(suggestBitrates([], 1080, 30)).toEqual({});
  });

  test("ranges that do not overlap use each platform's own recommendation", () => {
    expect(suggestBitrates(["youtube", "twitch"], 2160, 60)).toEqual({ youtube: 35000, twitch: 6000 });
  });

  test("setup profiles follow the output size and platform limits", () => {
    const video = recommendVideo({ screenWidth: 1920, screenHeight: 1080, goal: "stream", hardware: true });
    const profile = setupProfile("twitch", video, 9000);
    expect([profile.width, profile.height, profile.videoBitrateKbps, profile.keyframeSec]).toEqual([1920, 1080, 6000, 2]);
  });

  test("screen and camera layout puts the camera bottom right inside the canvas", () => {
    const sources = layoutSources("screenCamera", 1920, 1080);
    expect(sources.map((source) => source.kind)).toEqual(["display", "camera"]);
    const camera = sources[1].transform;
    expect(camera?.anchor).toBe("bottomRight");
    expect(camera && camera.x <= 1920 && camera.y <= 1080 && camera.x - camera.width >= 0).toBe(true);
    expect(layoutSources("cameraOnly", 1920, 1080)).toEqual([{ kind: "camera" }]);
  });

  test("scene names never collide", () => {
    expect(uniqueSceneName("Screen", ["Scene"])).toBe("Screen");
    expect(uniqueSceneName("Screen", ["Screen", "Screen 2"])).toBe("Screen 3");
  });
});
