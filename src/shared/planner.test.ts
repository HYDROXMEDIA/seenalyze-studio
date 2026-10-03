import { describe, expect, test } from "bun:test";
import { estimateUploadKbps, planEncoders, recommendedUploadKbps } from "./planner";
import type { DestinationConfig, DestinationProfile } from "./types";

const profile: DestinationProfile = {
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitrateKbps: 6000,
  audioBitrateKbps: 160,
  keyframeSec: 2,
  codec: "h264",
};

function destination(id: string, overrides: Partial<DestinationProfile> = {}): DestinationConfig {
  return {
    id,
    platform: "twitch",
    name: id,
    enabled: true,
    mode: "manual",
    server: "rtmp://example.invalid/live",
    hasStreamKey: true,
    profile: { ...profile, ...overrides },
  };
}

describe("planEncoders", () => {
  test("identical profiles share one encoder", () => {
    const plan = planEncoders([destination("a"), destination("b"), destination("c")]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].destinationIds).toEqual(["a", "b", "c"]);
  });

  test("different bitrate needs its own encoder", () => {
    const plan = planEncoders([destination("a"), destination("b", { videoBitrateKbps: 4500 })]);
    expect(plan.groups).toHaveLength(2);
    expect(plan.assignment.a).not.toBe(plan.assignment.b);
  });

  test("different resolution, fps or keyframe interval split groups", () => {
    const plan = planEncoders([
      destination("a"),
      destination("b", { width: 1280, height: 720 }),
      destination("c", { fps: 60 }),
      destination("d", { keyframeSec: 3 }),
    ]);
    expect(plan.groups).toHaveLength(4);
  });

  test("audio bitrate alone does not force a second video encode", () => {
    const plan = planEncoders([destination("a"), destination("b", { audioBitrateKbps: 128 })]);
    expect(plan.groups).toHaveLength(1);
  });

  test("empty input produces an empty plan", () => {
    const plan = planEncoders([]);
    expect(plan.groups).toHaveLength(0);
    expect(plan.uploadKbps).toBe(0);
  });
});

describe("upload estimate", () => {
  test("every destination is a separate network copy", () => {
    expect(estimateUploadKbps([destination("a"), destination("b"), destination("c")])).toBe(18480);
  });

  test("recommended upload adds overhead and headroom", () => {
    expect(recommendedUploadKbps(18480)).toBe(25872);
  });
});
