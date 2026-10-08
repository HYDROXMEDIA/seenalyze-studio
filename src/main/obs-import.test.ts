import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeAudioProcessing } from "../shared/audio";
import {
  cleanSettings,
  convertObsCollection,
  convertStreamlabsCollection,
  findImportCandidates,
  iniValue,
  kindForInput,
  obsCanvas,
  readImportCandidate,
  volumeToDeflection,
} from "./obs-import";

const FIXTURES = path.join(import.meta.dir, "import-fixtures");
const obsJson = () => JSON.parse(readFileSync(path.join(FIXTURES, "obs-collection.json"), "utf8")) as unknown;
const slobsJson = () => JSON.parse(readFileSync(path.join(FIXTURES, "streamlabs-collection.json"), "utf8")) as unknown;
const SAME_CANVAS = { from: { width: 2560, height: 1440 }, to: { width: 2560, height: 1440 } };

describe("OBS Studio collection", () => {
  const converted = convertObsCollection(obsJson(), "fallback", { platform: "darwin", canvas: SAME_CANVAS });
  const { collection } = converted;
  const source = (name: string) => collection.sources.find((entry) => entry.name === name);

  test("keeps the name, scene order (groups last) and program scene", () => {
    expect(converted.name).toBe("Gaming setup");
    expect(collection.sceneOrder).toEqual(["Starting soon", "Gameplay", "Overlay group"]);
    expect(collection.activeScene).toBe("Gameplay");
  });

  test("maps transforms, crop, visibility, lock and nested scenes", () => {
    const items = collection.scenes.Gameplay;
    expect(items.map((item) => item.source)).toEqual(["Game capture", "Webcam", "Alerts", "Overlay group"]);
    expect(items[0]).toMatchObject({ boundsType: 2, bounds: { x: 2560, y: 1440 }, alignment: 5 });
    expect(items[1]).toMatchObject({ locked: true, position: { x: 2000, y: 1100 }, scale: { x: 0.5, y: 0.5 }, crop: { left: 10, top: 0, right: 10, bottom: 0 } });
    expect(items[2]).toMatchObject({ visible: false, rotation: 15, alignment: 0 });
    expect(collection.scenes["Starting soon"][0].source).toBe("Gameplay");
  });

  test("uses canvas-relative positions only when absolute ones are missing", () => {
    const title = collection.scenes["Starting soon"].find((item) => item.source === "Title");
    expect(title?.position).toEqual({ x: 1280, y: 720 });
  });

  test("drops items whose source does not exist", () => {
    expect(collection.scenes["Starting soon"].some((item) => item.source === "Deleted source")).toBe(false);
  });

  test("maps source kinds and keeps unknown types (shown as missing)", () => {
    expect(source("Game capture")?.kind).toBe("game");
    expect(source("Webcam")).toMatchObject({ kind: "camera", inputId: "av_capture_input_v2" });
    expect(source("Alerts")?.kind).toBe("browser");
    expect(source("Title")).toMatchObject({ kind: "text", inputId: "text_ft2_source_v2" });
    expect(source("Plugin widget")).toMatchObject({ kind: "other", inputId: "some_plugin_source", settings: { mode: 3 } });
    // Game capture is Windows-only and the plugin is unknown here.
    expect(converted.stats.unavailableSources).toBe(2);
    expect(converted.stats.sources).toBe(collection.sources.length);
  });

  test("never imports credential-like settings", () => {
    const alerts = source("Alerts");
    expect(alerts?.settings).toEqual({ url: "https://example.invalid/alerts", width: 800, height: 600 });
    expect(JSON.stringify(collection)).not.toContain("fixture-not-a-real-secret");
  });

  test("turns video filters into effects and counts the rest as skipped", () => {
    expect(source("Game capture")?.effects).toEqual([{ kind: "chromaKey", enabled: true, settings: { similarity: 420 } }]);
    expect(source("Webcam")?.effects).toEqual([{ kind: "crop", enabled: false, settings: { left: 20 } }]);
    // VST on the game, EQ on the mic, color filter on a scene.
    expect(converted.stats.skippedFilters).toBe(3);
  });

  test("maps global audio, volume, monitoring, sync, mono, tracks and audio filters", () => {
    expect(collection.globalAudio).toEqual([
      { channel: 1, source: "Desktop Audio" },
      { channel: 3, source: "Mic/Aux" },
    ]);
    const desktop = source("Desktop Audio");
    expect(desktop?.kind).toBe("desktopAudio");
    expect(desktop?.volume).toBeCloseTo(volumeToDeflection(0.5011872336272722), 5);
    expect(desktop?.audio).toBeUndefined();
    const mic = source("Mic/Aux");
    expect(mic?.muted).toBe(true);
    const audio = sanitizeAudioProcessing(mic?.audio);
    expect(audio).toMatchObject({ monitoring: "monitor", syncOffsetMs: 150, mono: true, tracks: 3 });
    expect(audio.filters.map((filter) => [filter.kind, filter.enabled])).toEqual([
      ["noiseSuppression", true],
      ["compressor", false],
    ]);
    expect(audio.filters[0].settings.suppress_level).toBe(-40);
    expect(audio.filters[1].settings).toMatchObject({ ratio: 4, sidechain_source: "Desktop Audio" });
    expect(new Set(audio.filters.map((filter) => filter.id)).size).toBe(2);
    expect(source("Alerts")?.audio?.tracks).toBe(1);
  });

  test("maps the current transition and its duration", () => {
    expect(converted.transition).toEqual({ id: "slideUp", durationMs: 450 });
  });

  test("scales positions to another canvas", () => {
    const scaled = convertObsCollection(obsJson(), "x", { platform: "darwin", canvas: { from: { width: 2560, height: 1440 }, to: { width: 1920, height: 1080 } } });
    const [game, webcam] = scaled.collection.scenes.Gameplay;
    expect(game.bounds).toEqual({ x: 1920, y: 1080 });
    expect(game.scale).toEqual({ x: 1, y: 1 });
    expect(webcam.position).toEqual({ x: 1500, y: 825 });
    expect(webcam.scale).toEqual({ x: 0.375, y: 0.375 });
  });

  test("rejects files that are not scene collections", () => {
    expect(() => convertObsCollection({ hello: 1 }, "x", { platform: "darwin" })).toThrow("import-invalid");
    expect(() => convertObsCollection({ sources: [] }, "x", { platform: "darwin" })).toThrow("import-invalid");
  });
});

describe("Streamlabs Desktop collection", () => {
  const converted = convertStreamlabsCollection(slobsJson(), "Streamlabs", { platform: "win32" });
  const { collection } = converted;

  test("unwraps nodes and makes names unique", () => {
    expect(collection.sceneOrder).toEqual(["Intro", "Main"]);
    expect(collection.activeScene).toBe("Main");
    expect(collection.sources.map((source) => source.name)).toEqual(["Desktop Audio", "Logo", "Logo 2"]);
    expect(collection.globalAudio).toEqual([{ channel: 1, source: "Desktop Audio" }]);
  });

  test("orders items bottom to top and skips folders", () => {
    expect(collection.scenes.Intro.map((item) => item.source)).toEqual(["Logo 2", "Logo"]);
    expect(collection.scenes.Intro[1]).toMatchObject({ position: { x: 100, y: 50 }, scale: { x: 0.5, y: 0.5 }, alignment: 5 });
    expect(collection.scenes.Intro[0]).toMatchObject({ visible: false, locked: true, rotation: 90, crop: { top: 5 } });
    expect(collection.scenes.Main[0].source).toBe("Intro");
  });

  test("maps filters and audio properties", () => {
    const logo = collection.sources.find((source) => source.name === "Logo");
    expect(logo?.effects).toEqual([{ kind: "sharpen", enabled: true, settings: { sharpness: 0.2 } }]);
    const camera = collection.sources.find((source) => source.name === "Logo 2");
    expect(camera?.kind).toBe("camera");
    const audio = sanitizeAudioProcessing(camera?.audio);
    expect(audio).toMatchObject({ monitoring: "monitorAndOutput", syncOffsetMs: 250, mono: true, tracks: 1 });
    expect(audio.filters).toHaveLength(1);
    expect(audio.filters[0]).toMatchObject({ kind: "noiseGate", enabled: false });
    expect(converted.transition).toBeNull();
  });
});

describe("helpers", () => {
  test("fader position follows the IEC curve", () => {
    expect(volumeToDeflection(1)).toBe(1);
    expect(volumeToDeflection(2)).toBe(1);
    expect(volumeToDeflection(0)).toBe(0);
    expect(volumeToDeflection(10 ** (-9 / 20))).toBeCloseTo(0.75, 4);
    expect(volumeToDeflection(10 ** (-20 / 20))).toBeCloseTo(0.5, 4);
  });

  test("screen capture kinds follow the capture type", () => {
    expect(kindForInput("screen_capture", { type: 0 })).toBe("display");
    expect(kindForInput("screen_capture", { type: 1 })).toBe("window");
    expect(kindForInput("screen_capture", { type: 2 })).toBe("application");
    expect(kindForInput("sck_audio_capture", { type: 1 })).toBe("applicationAudio");
    expect(kindForInput("monitor_capture", {})).toBe("display");
    expect(kindForInput("wasapi_input_capture", {})).toBe("microphone");
  });

  test("credential-like settings are removed at every depth", () => {
    expect(cleanSettings({ stream_key: "a", password: "b", nested: { access_token: "c", keep: 1 }, keyframe: 2, monkey: 3 })).toEqual({ nested: { keep: 1 }, keyframe: 2, monkey: 3 });
  });

  test("ini values are read per section", () => {
    const ini = "[General]\nName=x\n[Video]\nBaseCX=2560\nBaseCY = 1440\n";
    expect(iniValue(ini, "Video", "BaseCX")).toBe("2560");
    expect(iniValue(ini, "Video", "BaseCY")).toBe("1440");
    expect(iniValue(ini, "General", "BaseCX")).toBeUndefined();
  });
});

describe("discovery", () => {
  test("finds collections, reads the OBS canvas and resolves only listed files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "seenalyze-import-"));
    try {
      const obs = path.join(root, "obs-studio");
      mkdirSync(path.join(obs, "basic", "scenes"), { recursive: true });
      mkdirSync(path.join(obs, "basic", "profiles", "Main"), { recursive: true });
      writeFileSync(path.join(obs, "basic", "scenes", "Gaming.json"), readFileSync(path.join(FIXTURES, "obs-collection.json")));
      writeFileSync(path.join(obs, "basic", "scenes", "broken.json"), "{ not json");
      writeFileSync(path.join(obs, "user.ini"), "[Basic]\nProfile=Main\nProfileDir=Main\n");
      writeFileSync(path.join(obs, "basic", "profiles", "Main", "basic.ini"), "[Video]\nBaseCX=2560\nBaseCY=1440\n");
      const slobs = path.join(root, "slobs-client", "SceneCollections");
      mkdirSync(slobs, { recursive: true });
      writeFileSync(path.join(slobs, "abc.json"), readFileSync(path.join(FIXTURES, "streamlabs-collection.json")));
      writeFileSync(path.join(slobs, "gone.json"), readFileSync(path.join(FIXTURES, "streamlabs-collection.json")));
      writeFileSync(path.join(slobs, "manifest.json"), JSON.stringify({ collections: [{ id: "abc", name: "My SL scenes" }, { id: "gone", name: "Old", deleted: true }] }));
      const roots = { obs, streamlabs: path.join(root, "slobs-client") };

      const found = findImportCandidates(roots, "darwin");
      expect(found).toEqual([
        { id: "obs:Gaming.json", app: "obs", name: "Gaming setup", scenes: 3, sources: 7 },
        { id: "streamlabs:abc.json", app: "streamlabs", name: "My SL scenes", scenes: 2, sources: 3 },
      ]);
      expect(obsCanvas(obs)).toEqual({ width: 2560, height: 1440 });

      const converted = readImportCandidate("obs:Gaming.json", roots, "darwin", { width: 1280, height: 720 });
      expect(converted.collection.scenes.Gameplay[0].bounds).toEqual({ x: 1280, y: 720 });
      expect(() => readImportCandidate("obs:../secret.json", roots, "darwin", { width: 1280, height: 720 })).toThrow("invalid-request");
      expect(() => readImportCandidate("obs:missing.json", roots, "darwin", { width: 1280, height: 720 })).toThrow("import-not-found");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
