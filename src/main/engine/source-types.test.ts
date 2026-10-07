import { describe, expect, test } from "bun:test";
import { availableSourceKinds, resolveSourceType } from "./source-types";

describe("installed capture sources", () => {
  test("macOS application capture needs modern screen capture", () => {
    expect(availableSourceKinds(["display_capture", "window_capture"], "darwin")).not.toContain("application");
    expect(availableSourceKinds(["screen_capture", "sck_audio_capture"], "darwin")).toEqual(["display", "window", "application", "desktopAudio", "applicationAudio", "scene"]);
  });
  test("Windows exposes game, camera and application audio only when installed", () => {
    const kinds = availableSourceKinds(["game_capture", "dshow_input", "wasapi_process_output_capture"], "win32");
    expect(kinds).toEqual(["game", "camera", "captureCard", "applicationAudio", "scene"]);
    expect(kinds).not.toContain("syphon");
  });
  test("optional media and hardware modules are not advertised without support", () => {
    expect(availableSourceKinds([], "darwin")).toEqual(["scene"]);
    expect(availableSourceKinds(["vlc_source", "decklink-input", "syphon-input"], "darwin")).toEqual(["playlist", "syphon", "blackmagic", "scene"]);
  });
  test("prefers current inputs and rejects unknown kinds", () => {
    expect(resolveSourceType("slideshow", ["slideshow", "slideshow_v2"], "darwin")).toBe("slideshow_v2");
    expect(resolveSourceType("scene", [], "darwin")).toBeUndefined();
    expect(resolveSourceType("__proto__" as never, [], "darwin")).toBeUndefined();
  });
});
