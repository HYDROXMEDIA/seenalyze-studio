import { describe, expect, test } from "bun:test";
import { copyName } from "./naming";
import {
  availableEffectKinds,
  EFFECT_KINDS,
  EFFECT_SPECS,
  effectKindOf,
  effectName,
  resolveEffectType,
  sanitizeEffectSnapshots,
} from "./video-effects";

describe("effect catalog", () => {
  test("prefers the newest installed filter type and hides missing ones", () => {
    expect(resolveEffectType("chromaKey", ["chroma_key_filter", "chroma_key_filter_v2"])).toBe("chroma_key_filter_v2");
    expect(resolveEffectType("chromaKey", ["chroma_key_filter"])).toBe("chroma_key_filter");
    expect(resolveEffectType("lut", ["crop_filter"])).toBeNull();
    expect(availableEffectKinds(["crop_filter", "gpu_delay", "noise_suppress_filter_v2"])).toEqual(["crop", "renderDelay"]);
  });

  test("maps filter types back to effects and ignores audio filters", () => {
    for (const kind of EFFECT_KINDS) for (const id of EFFECT_SPECS[kind].engineIds) expect(effectKindOf(id)).toBe(kind);
    expect(effectKindOf("noise_suppress_filter_v2")).toBeNull();
  });

  test("keying effects start on a green screen", () => {
    expect(EFFECT_SPECS.chromaKey.defaults).toEqual({ key_color_type: "green" });
    expect(EFFECT_SPECS.colorKey.defaults).toEqual({ key_color_type: "green" });
  });

  test("filter names stay unique within a source", () => {
    expect(effectName("crop", [])).toBe("crop 1");
    expect(effectName("crop", ["crop 1", "crop 2", "lut 3"])).toBe("crop 3");
  });

  test("snapshots are validated and copied", () => {
    const settings = { similarity: 400 };
    const clean = sanitizeEffectSnapshots([
      { kind: "chromaKey", enabled: false, settings },
      { kind: "nope", enabled: true, settings: {} },
      { kind: "crop", settings: "bad" },
      null,
    ]);
    expect(clean).toEqual([
      { kind: "chromaKey", enabled: false, settings: { similarity: 400 } },
      { kind: "crop", enabled: true, settings: {} },
    ]);
    expect(clean[0].settings).not.toBe(settings);
    expect(sanitizeEffectSnapshots("x")).toEqual([]);
  });
});

describe("copy names", () => {
  test("numbers copies and continues an existing number", () => {
    const taken = new Set(["Camera", "Camera 2", "Scene 3"]);
    const has = (name: string) => taken.has(name);
    expect(copyName("Camera", has)).toBe("Camera 3");
    expect(copyName("Scene", has)).toBe("Scene 2");
    expect(copyName("Scene 3", has)).toBe("Scene 4");
    expect(copyName("Intro 1", () => false)).toBe("Intro 2");
    expect(copyName("2024", () => false)).toBe("2024 2");
  });
});
