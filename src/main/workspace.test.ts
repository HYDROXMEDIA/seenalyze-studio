import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clampProfile } from "../shared/platforms";
import { DEFAULT_ADVANCED_STREAM, type StudioPreferences, type VideoSettings } from "../shared/types";
import { CollectionFiles, migrateWorkspace } from "./collections";
import type { SceneCollection } from "./engine/scenes";
import { convertObsCollection } from "./obs-import";
import { Workspace, type WorkspaceHost, type WorkspaceState } from "./workspace";

const FIXTURES = path.join(import.meta.dir, "import-fixtures");
const DEFAULT_VIDEO: VideoSettings = { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fps: 30, scaleFilter: "bicubic" };

function savedStudio(): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FIXTURES, "studio-before-collections.json"), "utf8")) as Record<string, unknown>;
}

/** A host whose "engine" holds a collection and counts restarts. */
function setup(dir: string) {
  let next = 0;
  const newId = () => `id-${++next}`;
  const saved = savedStudio();
  const state = { ...saved, ...migrateWorkspace(saved, newId) } as unknown as WorkspaceState;
  const engine = { running: true, collection: state.collection, starts: 0, stops: 0, video: state.video };
  const log = { writes: 0, live: false, applied: [] as VideoSettings[] };
  const host: WorkspaceHost = {
    state,
    files: new CollectionFiles(path.join(dir, "scene-collections")),
    locked: () => log.live,
    stopEngine: async () => {
      if (engine.running) state.collection = structuredClone(engine.collection);
      engine.running = false;
      engine.stops += 1;
    },
    startEngine: async () => {
      engine.collection = structuredClone(state.collection);
      engine.video = state.video;
      engine.running = true;
      engine.starts += 1;
    },
    captureCollection: async () => {
      state.collection = structuredClone(engine.collection);
    },
    applyVideo: async (video) => {
      log.applied.push(video);
      state.video = video;
    },
    writeState: () => {
      log.writes += 1;
    },
    settingsChanged: async () => undefined,
    pushSnapshot: () => undefined,
    sanitizeVideo: (video) => ({ ...DEFAULT_VIDEO, ...video }),
    sanitizePreferences: (preferences: StudioPreferences) => preferences,
    sanitizeAdvanced: (advanced) => advanced,
    sanitizeProfile: (platform, profile) => clampProfile(platform, profile),
    defaults: { video: DEFAULT_VIDEO, preferences: state.preferences, advanced: DEFAULT_ADVANCED_STREAM },
  };
  return { workspace: new Workspace(host, newId), state, engine, log, host };
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "seenalyze-workspace-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("scene collections", () => {
  test("a new collection starts empty and the old one is kept with its edits", async () => {
    const { workspace, state, engine } = setup(dir);
    const original = structuredClone(state.collection) as SceneCollection;
    // Edits made in the engine since the last save must survive the switch.
    (engine.collection as SceneCollection).sceneOrder.push("Edited");
    (engine.collection as SceneCollection).scenes.Edited = [];
    const firstId = state.collections.activeId;

    await workspace.createCollection("Second");
    expect(state.collections.items.map((entry) => entry.name)).toEqual(["", "Second"]);
    expect(state.collections.activeId).not.toBe(firstId);
    expect(state.collection).toBeNull();
    expect(engine.starts).toBe(1);

    await workspace.switchCollection(firstId);
    expect(state.collections.activeId).toBe(firstId);
    expect(state.collection?.sceneOrder).toEqual([...original.sceneOrder, "Edited"]);
    expect(state.collection?.sources).toEqual(original.sources);
    expect(engine.starts).toBe(2);
  });

  test("switching back rescales a collection saved at another canvas", async () => {
    const { workspace, state, host } = setup(dir);
    const firstId = state.collections.activeId;
    await workspace.createCollection("Second");
    await host.applyVideo({ ...state.video, baseWidth: 1280, baseHeight: 720 });
    await workspace.switchCollection(firstId);
    expect(state.collection?.scenes.Main[1].position.x).toBe(960);
    expect(state.collection?.scenes.Main[1].position.y).toBeCloseTo(1600 / 3, 6);
  });

  test("is refused while live and leaves everything as it was", async () => {
    const { workspace, state, engine, log } = setup(dir);
    log.live = true;
    await expect(workspace.createCollection("Second")).rejects.toThrow("workspace-locked");
    expect(state.collections.items).toHaveLength(1);
    expect(engine.stops).toBe(0);
  });

  test("rename, duplicate and remove", async () => {
    const { workspace, state, engine } = setup(dir);
    const firstId = state.collections.activeId;
    await workspace.renameCollection(firstId, "  Main  ");
    expect(state.collections.items[0].name).toBe("Main");
    await expect(workspace.renameCollection(firstId, "   ")).rejects.toThrow("invalid-request");
    await workspace.duplicateCollection(firstId, "Copy");
    await expect(workspace.duplicateCollection(firstId, "copy")).rejects.toThrow("name-taken");
    expect(engine.starts).toBe(0);
    const copy = state.collections.items.find((entry) => entry.name === "Copy")?.id as string;

    await workspace.switchCollection(copy);
    expect(state.collection).toEqual(engine.collection);
    expect(state.collection?.sceneOrder).toEqual(["Main", "BRB"]);

    // Removing the active collection switches to another one first.
    await workspace.removeCollection(copy);
    expect(state.collections).toEqual({ activeId: firstId, items: [{ id: firstId, name: "Main" }] });
    expect(state.collection?.sceneOrder).toEqual(["Main", "BRB"]);
    await expect(workspace.removeCollection(firstId)).rejects.toThrow("last-collection");
  });

  test("a damaged collection file does not cost the collection in use", async () => {
    const { workspace, state, engine, host } = setup(dir);
    const firstId = state.collections.activeId;
    await workspace.duplicateCollection(firstId, "Copy");
    const copy = state.collections.items[1].id;
    host.files.remove(copy);
    await expect(workspace.switchCollection(copy)).rejects.toThrow("collection-unreadable");
    expect(state.collections.activeId).toBe(firstId);
    expect(engine.running).toBe(true);
    expect(engine.stops).toBe(0);
  });

  test("an imported collection is added and switched to", async () => {
    const { workspace, state } = setup(dir);
    const json = JSON.parse(readFileSync(path.join(FIXTURES, "obs-collection.json"), "utf8")) as unknown;
    const converted = convertObsCollection(json, "x", { platform: "darwin" });
    const result = await workspace.importCollection(converted, true);
    expect(result).toMatchObject({ name: "Gaming setup", scenes: 3, switched: true });
    expect(state.collections.activeId).toBe(result.collectionId);
    expect(state.collection?.sceneOrder).toEqual(converted.collection.sceneOrder);
    expect(state.transition).toEqual({ id: "slideUp", durationMs: 450 });
    const again = await workspace.importCollection(converted, false);
    expect(again).toMatchObject({ name: "Gaming setup 2", switched: false });
    expect(state.collections.activeId).toBe(result.collectionId);
  });
});

describe("profiles", () => {
  test("switching stores the current settings and applies the other profile", async () => {
    const { workspace, state, log } = setup(dir);
    const firstId = state.profiles.activeId;
    const original = structuredClone({ video: state.video, preferences: state.preferences, profile: state.destinations[0].profile });

    await workspace.createProfile("Recording");
    expect(state.profiles.items.map((entry) => entry.name)).toEqual(["", "Recording"]);
    expect(log.applied.at(-1)).toEqual(DEFAULT_VIDEO);
    expect(state.preferences.recordingFormat).toBe(original.preferences.recordingFormat);
    // Behaviour settings are not part of a profile.
    expect(state.preferences.autoRecord).toBe(true);

    await workspace.switchProfile(firstId);
    expect(state.video).toEqual(original.video);
    expect(state.destinations[0].profile).toMatchObject(original.profile);
    expect(state.profileData[firstId]).toBeUndefined();
  });

  test("duplicate, rename and remove", async () => {
    const { workspace, state } = setup(dir);
    const firstId = state.profiles.activeId;
    await workspace.duplicateProfile(firstId, "Copy");
    const copy = state.profiles.items[1].id;
    expect(state.profileData[copy].video).toEqual(state.video);
    await workspace.renameProfile(copy, "Backup");
    expect(state.profiles.items[1].name).toBe("Backup");
    await workspace.removeProfile(copy);
    expect(state.profiles.items).toHaveLength(1);
    expect(state.profileData[copy]).toBeUndefined();
    await expect(workspace.removeProfile(firstId)).rejects.toThrow("last-profile");
  });

  test("a different audio format restarts the engine; the same one does not", async () => {
    const { workspace, state, engine } = setup(dir);
    await workspace.setFormats({ audio: { sampleRate: 48000, speakers: "stereo" } });
    expect(engine.starts).toBe(1);
    await workspace.setFormats({ audio: { sampleRate: 48000, speakers: "stereo" }, recordingTracks: 0b11 });
    expect(engine.starts).toBe(1);
    expect(state.recordingTracks).toBe(3);
    await expect(workspace.setFormats({ audio: { sampleRate: 1, speakers: "stereo" } })).rejects.toThrow("invalid-request");
  });
});
