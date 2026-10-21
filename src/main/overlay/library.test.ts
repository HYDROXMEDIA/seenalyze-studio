import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildOverlayDocument, OVERLAY_CSP } from "./document";
import type { OverlayField } from "../../shared/overlays";
import { OverlayLibrary } from "./library";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const fields: OverlayField[] = [{ key: "label", label: "Label", type: "text", default: "Hi" }];

let dir = "";
const realError = console.error;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "studio-overlays-"));
  // Skipped files are logged; the expected ones would only clutter the output.
  console.error = () => undefined;
});
afterEach(() => {
  console.error = realError;
  rmSync(dir, { recursive: true, force: true });
});

function writeOverlay(file: string, value: unknown): void {
  writeFileSync(path.join(dir, file), typeof value === "string" ? value : JSON.stringify(value));
}

describe("overlay library loading", () => {
  test("skips unreadable, foreign and malformed files without failing", () => {
    writeOverlay("broken.json", "{not json");
    writeOverlay("array.json", [1, 2]);
    writeOverlay(`${ID_A}.json`, { id: ID_A, html: "<p></p>", fields: [null] });
    writeOverlay("notes.txt", "ignored");
    expect(new OverlayLibrary(dir).list()).toEqual([]);
  });

  test("ignores an overlay whose id does not match its file, so deleting never removes another file", () => {
    writeOverlay(`${ID_B}.json`, { id: ID_B, name: "B", html: "<p></p>", fields, values: {}, width: 100, height: 100, origin: "preset", createdAt: 1, updatedAt: 1 });
    writeOverlay("copy.json", { id: ID_B, name: "Copy", html: "<p></p>", fields, values: {}, width: 100, height: 100, origin: "preset", createdAt: 2, updatedAt: 2 });
    const library = new OverlayLibrary(dir);
    expect(library.list().map((overlay) => overlay.name)).toEqual(["B"]);
    library.remove(ID_B);
    expect(existsSync(path.join(dir, "copy.json"))).toBe(true);
  });

  test("an older file without settings or size still loads and can be edited", () => {
    writeOverlay(`${ID_A}.json`, { id: ID_A, html: "<p></p>", fields, kind: "nonsense" });
    const library = new OverlayLibrary(dir);
    const overlay = library.require(ID_A);
    expect(overlay).toMatchObject({ name: "Overlay", kind: "custom", values: {}, width: 800, height: 600 });
    expect(library.update(ID_A, { values: { label: "Hello" } }).values).toEqual({ label: "Hello" });
    expect(library.replaceDesign(ID_A, { name: "New", html: "<b></b>", fields }).values).toEqual({ label: "Hello" });
  });

  test("rejects lookups that are not overlay ids", () => {
    const library = new OverlayLibrary(dir);
    expect(library.get("../secrets")).toBeUndefined();
    expect(() => library.remove("../secrets")).toThrow("overlay-not-found");
    expect(() => library.createFromPreset("missing")).toThrow("overlay-not-found");
  });

  test("a failed save keeps the previous file and no temp file is loaded later", () => {
    writeOverlay(`${ID_A}.json`, { id: ID_A, name: "A", html: "<p></p>", fields, values: {}, width: 100, height: 100, origin: "preset", createdAt: 1, updatedAt: 1 });
    writeOverlay(`${ID_A}.json.tmp`, "{half");
    const library = new OverlayLibrary(dir);
    expect(library.list()).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
    expect(() => library.update(ID_A, { name: "Renamed" })).toThrow();
    expect(library.require(ID_A).name).toBe("A");
  });
});

describe("overlay document", () => {
  test("the content policy blocks external scripts, requests and framing tricks", () => {
    expect(OVERLAY_CSP).toContain("default-src 'none'");
    expect(OVERLAY_CSP).toContain("script-src 'unsafe-inline'");
    expect(OVERLAY_CSP).not.toMatch(/script-src[^;]*(https?:|\*)/u);
    expect(OVERLAY_CSP).not.toMatch(/connect-src[^;]*(https?:|\*)/u);
    expect(OVERLAY_CSP).toContain("base-uri 'none'");
    expect(OVERLAY_CSP).toContain("form-action 'none'");
  });

  test("setting values cannot close the style or script element they are placed in", () => {
    const hostile = "</style></script><script>alert(1)</script>";
    const doc = buildOverlayDocument({ html: "<div></div>", fields, values: { label: hostile } }, false, null);
    // Only closing tags end raw-text elements; an opening tag inside the style is inert text.
    expect(doc.match(/<\/script/giu)).toHaveLength(1);
    expect(doc.match(/<\/style/giu)).toHaveLength(2);
  });

  test("the runtime goes into the overlay's own head and a doctype is never duplicated", () => {
    const doc = buildOverlayDocument({ html: "<!DOCTYPE html><html><head><title>x</title></head><body></body></html>", fields, values: {} }, true, null);
    expect(doc.match(/<!doctype/giu)).toHaveLength(1);
    expect(doc.indexOf("<script>")).toBeLessThan(doc.indexOf("<title>"));
    expect(readdirSync(dir)).toEqual([]);
  });
});
