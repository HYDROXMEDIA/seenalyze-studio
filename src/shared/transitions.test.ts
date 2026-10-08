import { describe, expect, test } from "bun:test";
import {
  availablePresets,
  DEFAULT_TRANSITION,
  defaultStinger,
  isStingerPath,
  parseTransition,
  resolveSceneTransition,
  sanitizeStinger,
  sanitizeTransition,
  sanitizeTransitionOverrides,
  stingerPointMs,
  stingerSettings,
  transitionKey,
  transitionSettings,
  type TransitionChoice,
} from "./transitions";
import { virtualCameraAvailability, virtualCameraScene } from "./virtual-camera";

const stinger = (extra: Record<string, unknown> = {}) => ({ path: "/Users/me/Movies/intro.webm", videoMs: 2000, ...extra });

describe("stinger options", () => {
  test("accepts absolute paths to supported videos only", () => {
    expect(isStingerPath("/a/b/clip.MOV")).toBe(true);
    expect(isStingerPath("C:\\clips\\intro.webm")).toBe(true);
    expect(isStingerPath("\\\\server\\share\\intro.mp4")).toBe(true);
    expect(isStingerPath("relative/intro.webm")).toBe(false);
    expect(isStingerPath("/a/b/picture.png")).toBe(false);
    expect(isStingerPath("/a/b/.webm")).toBe(false);
    expect(isStingerPath("/a/b/clip\0.webm")).toBe(false);
    expect(isStingerPath(42)).toBe(false);
  });

  test("defaults and clamps the transition point", () => {
    expect(defaultStinger("/x/intro.webm", 2000)?.point).toEqual({ unit: "percent", value: 50 });
    // Without a known length, a percentage is not possible.
    expect(defaultStinger("/x/intro.webm", 0)?.point).toEqual({ unit: "ms", value: 500 });
    expect(sanitizeStinger(stinger({ point: { unit: "ms", value: 9000 } }))?.point).toEqual({ unit: "ms", value: 2000 });
    expect(sanitizeStinger(stinger({ point: { unit: "percent", value: -5 } }))?.point).toEqual({ unit: "percent", value: 0 });
    expect(sanitizeStinger(stinger({ videoMs: -1 }))?.videoMs).toBe(0);
    expect(sanitizeStinger({ path: "intro.webm" })).toBeNull();
    expect(sanitizeStinger(null)).toBeNull();
  });

  test("unknown option values fall back to defaults", () => {
    expect(sanitizeStinger(stinger({ matte: "weird", audio: 3, audioFade: "x", invertMatte: "yes" }))).toMatchObject({
      matte: "none",
      audio: "stream",
      audioFade: "fadeOutIn",
      invertMatte: false,
    });
  });

  test("maps to engine settings", () => {
    const options = sanitizeStinger(stinger({ point: { unit: "percent", value: 25 }, matte: "stacked", invertMatte: true, audio: "both", audioFade: "crossfade" }));
    if (!options) throw new Error("expected options");
    expect(stingerPointMs(options)).toBe(500);
    expect(stingerSettings(options)).toEqual({
      path: "/Users/me/Movies/intro.webm",
      tp_type: 0,
      transition_point: 500,
      track_matte_enabled: true,
      track_matte_layout: 1,
      invert_matte: true,
      audio_monitoring: 2,
      audio_fade_style: 1,
      hw_decode: true,
    });
    const mask = sanitizeStinger(stinger({ matte: "mask" }));
    if (!mask) throw new Error("expected options");
    expect(stingerSettings(mask)).toMatchObject({ track_matte_enabled: true, track_matte_layout: 3 });
  });
});

describe("transition choices", () => {
  test("a stinger needs a usable file", () => {
    expect(parseTransition({ id: "stinger", durationMs: 1 })).toBeNull();
    expect(sanitizeTransition({ id: "stinger" })).toEqual(DEFAULT_TRANSITION);
    const parsed = parseTransition({ id: "stinger", durationMs: 5, stinger: stinger() });
    expect(parsed?.durationMs).toBe(2000);
    expect(parsed?.stinger?.path).toBe("/Users/me/Movies/intro.webm");
  });

  test("other presets drop stinger data and keep clamped durations", () => {
    expect(parseTransition({ id: "fade", durationMs: 99999, stinger: stinger() })).toEqual({ id: "fade", durationMs: 5000 });
    expect(parseTransition({ id: "cut", durationMs: 400 })).toEqual({ id: "cut", durationMs: 0 });
    expect(parseTransition({ id: "nope", durationMs: 400 })).toBeNull();
  });

  test("engine settings and keys", () => {
    const choice = parseTransition({ id: "stinger", durationMs: 0, stinger: stinger() }) as TransitionChoice;
    expect(transitionSettings(choice)).toMatchObject({ path: "/Users/me/Movies/intro.webm" });
    expect(transitionKey(choice)).not.toBe(transitionKey({ ...choice, stinger: { ...choice.stinger!, path: "/other.webm" } }));
    expect(transitionKey({ id: "slideLeft", durationMs: 500 })).toBe(transitionKey({ id: "slideRight", durationMs: 500 }));
    expect(transitionSettings({ id: "slideUp", durationMs: 500 })).toEqual({ direction: "up" });
  });

  test("only installed presets are offered", () => {
    const ids = availablePresets(["fade_transition", "cut_transition", "obs_stinger_transition"]).map((preset) => preset.id);
    expect(ids).toEqual(["fade", "cut", "stinger"]);
  });
});

describe("per-scene overrides", () => {
  test("sanitizing drops invalid entries", () => {
    expect(
      sanitizeTransitionOverrides({ Intro: { id: "slideLeft", durationMs: 700 }, Bad: { id: "x" }, "": { id: "fade", durationMs: 300 }, Stinger: { id: "stinger" } }),
    ).toEqual({ Intro: { id: "slideLeft", durationMs: 700 } });
    expect(sanitizeTransitionOverrides(["fade"])).toEqual({});
    expect(sanitizeTransitionOverrides(undefined)).toEqual({});
  });

  test("resolution prefers the override, then the default, skipping missing stinger files", () => {
    const fallback: TransitionChoice = { id: "slideUp", durationMs: 500 };
    const sting = parseTransition({ id: "stinger", durationMs: 0, stinger: stinger() }) as TransitionChoice;
    expect(resolveSceneTransition(fallback, undefined, () => true)).toBe(fallback);
    expect(resolveSceneTransition(fallback, sting, () => true)).toBe(sting);
    expect(resolveSceneTransition(fallback, sting, () => false)).toBe(fallback);
    expect(resolveSceneTransition(sting, undefined, () => false)).toEqual(DEFAULT_TRANSITION);
  });
});

describe("virtual camera", () => {
  test("availability from the engine check", () => {
    expect(virtualCameraAvailability(null)).toBe("unknown");
    expect(virtualCameraAvailability({ supported: false, installed: false, canInstall: true })).toBe("unsupported");
    expect(virtualCameraAvailability({ supported: true, installed: true, canInstall: false })).toBe("ready");
    expect(virtualCameraAvailability({ supported: true, installed: false, canInstall: true })).toBe("installable");
    expect(virtualCameraAvailability({ supported: true, installed: false, canInstall: false })).toBe("missing");
  });

  test("a saved scene that no longer exists falls back to the program output", () => {
    expect(virtualCameraScene("Talk", ["Talk", "Game"])).toBe("Talk");
    expect(virtualCameraScene("Gone", ["Talk"])).toBeNull();
    expect(virtualCameraScene(7, ["7"])).toBeNull();
  });
});
