import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPendingErase, categoryFolders, isStorageCategory, pathsSize, recordingsSize, removePaths, requestErase } from "./storage";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "studio-storage-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("storage sizes", () => {
  test("sums nested files and treats missing folders as empty", async () => {
    mkdirSync(path.join(root, "a", "b"), { recursive: true });
    writeFileSync(path.join(root, "a", "one"), "12345");
    writeFileSync(path.join(root, "a", "b", "two"), "123");
    expect(await pathsSize([path.join(root, "a"), path.join(root, "missing")])).toBe(8);
  });

  test("counts only video files directly in the recordings folder", async () => {
    mkdirSync(path.join(root, "nested"));
    writeFileSync(path.join(root, "take.MKV"), "1234");
    writeFileSync(path.join(root, "notes.txt"), "123456");
    writeFileSync(path.join(root, "nested", "other.mp4"), "123456");
    expect(await recordingsSize(root)).toBe(4);
    expect(await recordingsSize(path.join(root, "missing"))).toBe(0);
  });

  test("only known categories are accepted", () => {
    expect(isStorageCategory("logs")).toBe(true);
    expect(isStorageCategory("recordings")).toBe(false);
    expect(isStorageCategory("../x")).toBe(false);
    expect(Object.keys(categoryFolders(root))).toEqual(["editorData", "captionModels"]);
  });
});

describe("cleaning", () => {
  test("removes folders and ignores ones that are already gone", async () => {
    mkdirSync(path.join(root, "models"));
    writeFileSync(path.join(root, "models", "m.bin"), "x");
    await removePaths([path.join(root, "models"), path.join(root, "tools")]);
    expect(existsSync(path.join(root, "models"))).toBe(false);
  });
});

describe("erase local data", () => {
  test("does nothing without a request", async () => {
    writeFileSync(path.join(root, "studio.json"), "{}");
    expect(await applyPendingErase(root)).toEqual({ erased: false, failed: [] });
    expect(existsSync(path.join(root, "studio.json"))).toBe(true);
  });

  test("removes app data and keeps configuration and recordings", async () => {
    writeFileSync(path.join(root, "studio.json"), "{}");
    writeFileSync(path.join(root, "studio.json.before-collections-2026"), "{}");
    writeFileSync(path.join(root, "secrets.json"), "{}");
    writeFileSync(path.join(root, "studio.config.json"), "{}");
    mkdirSync(path.join(root, "overlays"));
    writeFileSync(path.join(root, "overlays", "a.json"), "{}");
    await requestErase(root);
    expect(await applyPendingErase(root)).toEqual({ erased: true, failed: [] });
    for (const name of ["studio.json", "studio.json.before-collections-2026", "secrets.json", "overlays", "erase-local-data.pending"]) {
      expect(existsSync(path.join(root, name))).toBe(false);
    }
    expect(existsSync(path.join(root, "studio.config.json"))).toBe(true);
    // The request is finished: a later start leaves new data alone.
    writeFileSync(path.join(root, "studio.json"), "{}");
    expect((await applyPendingErase(root)).erased).toBe(false);
    expect(existsSync(path.join(root, "studio.json"))).toBe(true);
  });
});
