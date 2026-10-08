import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CollectionFiles, migrateWorkspace, rescaleCollection, sanitizeCollection, sanitizeStoredCollection } from "./collections";
import type { SceneCollection } from "./engine/scenes";

const FIXTURE = path.join(import.meta.dir, "import-fixtures", "studio-before-collections.json");
const saved = () => JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
const ids = () => {
  let next = 0;
  return () => `id-${++next}`;
};

describe("migration of a studio.json from before collections and profiles", () => {
  test("adds one collection and one profile, and leaves the saved data untouched", () => {
    const before = saved();
    const snapshot = JSON.stringify(before);
    const fields = migrateWorkspace(before, ids());
    expect(fields.collections).toEqual({ activeId: "id-1", items: [{ id: "id-1", name: "" }] });
    expect(fields.profiles).toEqual({ activeId: "id-2", items: [{ id: "id-2", name: "" }] });
    expect(fields.profileData).toEqual({});
    expect(fields.audioFormat).toBeNull();
    expect(fields.recordingTracks).toBe(1);
    // The migration only reads; the collection and settings stay where they are.
    expect(JSON.stringify(before)).toBe(snapshot);
    const merged: Record<string, unknown> = { ...before, ...fields };
    expect(merged.collection).toEqual(saved().collection);
    expect(merged.video).toEqual(saved().video);
    expect(merged.destinations).toEqual(saved().destinations);
    expect(sanitizeCollection(merged.collection)).toEqual(saved().collection as SceneCollection);
  });

  test("a migrated file reads back the same after it is saved once", () => {
    const first = { ...saved(), ...migrateWorkspace(saved(), ids()) };
    const reread = JSON.parse(JSON.stringify(first)) as Record<string, unknown>;
    const second = migrateWorkspace(reread, () => "never-used");
    expect(second.collections).toEqual(first.collections);
    expect(second.profiles).toEqual(first.profiles);
  });

  test("keeps saved lists, drops broken entries and repairs a missing active entry", () => {
    const fields = migrateWorkspace(
      {
        collections: { activeId: "b", items: [{ id: "a", name: " Main " }, { id: "b", name: "Games" }, { id: "a", name: "dupe" }, { id: "../x", name: "bad" }, "junk"] },
        profiles: { activeId: "missing", items: [{ id: "p1", name: "Stream" }, { id: "p2", name: "Record" }] },
        profileData: { p1: { video: {} }, p2: { video: { fps: 30 } }, p3: { video: {} }, p4: "junk" },
        audioFormat: { sampleRate: 44100, speakers: "mono" },
        recordingTracks: 5,
      },
      ids(),
    );
    expect(fields.collections).toEqual({ activeId: "b", items: [{ id: "a", name: "Main" }, { id: "b", name: "Games" }] });
    expect(fields.profiles.activeId).toBe("p1");
    // Data of the active profile lives in the main settings, not in profileData.
    expect(Object.keys(fields.profileData)).toEqual(["p2"]);
    expect(fields.audioFormat).toEqual({ sampleRate: 44100, speakers: "mono" });
    expect(fields.recordingTracks).toBe(5);
  });
});

describe("collection data", () => {
  const collection = saved().collection as SceneCollection;

  test("rescales positions, scales and bounds to a new canvas", () => {
    const scaled = rescaleCollection(collection, { width: 1920, height: 1080 }, { width: 1280, height: 720 });
    const [screen, camera] = scaled.scenes.Main;
    expect(screen.bounds).toEqual({ x: 1280, y: 720 });
    expect(screen.scale).toEqual({ x: 1, y: 1 });
    expect(camera.position.x).toBe(960);
    expect(camera.position.y).toBeCloseTo(1600 / 3, 6);
    expect(camera.scale.x).toBeCloseTo(1 / 6, 6);
    expect(rescaleCollection(collection, { width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(collection);
    // The original is not changed.
    expect(collection.scenes.Main[1].position).toEqual({ x: 1440, y: 800 });
  });

  test("stored collections are validated", () => {
    expect(sanitizeStoredCollection({ canvas: { width: 1920, height: 1080 }, collection })?.collection).toEqual(collection);
    expect(sanitizeStoredCollection({ canvas: { width: 1920, height: 1080 }, collection: null })).toEqual({ canvas: { width: 1920, height: 1080 }, transition: undefined, collection: null });
    expect(sanitizeStoredCollection({ canvas: { width: 0, height: 1080 }, collection })).toBeNull();
    expect(sanitizeStoredCollection({ canvas: { width: 1920, height: 1080 }, collection: { sceneOrder: "x" } })).toBeNull();
    expect(sanitizeStoredCollection({ canvas: { width: 1920, height: 1080 }, transition: { id: "nope" }, collection: null })?.transition).toEqual({ id: "fade", durationMs: 300 });
  });

  test("files are written atomically, copied, read back and removed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "seenalyze-collections-"));
    try {
      const files = new CollectionFiles(path.join(dir, "scene-collections"));
      files.write("one", { canvas: { width: 1920, height: 1080 }, collection });
      expect(files.read("one").collection).toEqual(collection);
      files.copy("one", "two");
      expect(files.read("two").collection).toEqual(collection);
      files.remove("one");
      expect(files.has("one")).toBe(false);
      expect(() => files.read("one")).toThrow("collection-unreadable");
      writeFileSync(path.join(dir, "scene-collections", "bad.json"), "{");
      expect(() => files.read("bad")).toThrow("collection-unreadable");
      expect(() => files.write("../escape", { canvas: { width: 1, height: 1 }, collection: null })).toThrow("invalid-request");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
