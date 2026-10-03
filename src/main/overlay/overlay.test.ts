import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveValues, settingsToCss } from "../../shared/overlays";
import { validateDesign } from "./design";
import { buildOverlayDocument } from "./document";
import { OverlayLibrary } from "./library";
import { OVERLAY_PRESETS } from "./presets";
import { OverlayServer } from "./server";

const html = `<style>body{color:var(--s-textColor)}</style><div id="x"></div><script>SEENALYZE.onChat(() => {});</script>`;
const design = {
  name: "Test overlay",
  html,
  fields: [
    { key: "textColor", label: "Text", type: "color", default: "#ffffff", group: "Colors" },
    { key: "size", label: "Size", type: "range", default: 24, min: 10, max: 60, unit: "px" },
    { key: "mode", label: "Mode", type: "select", default: "a", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] },
  ],
};

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("design validation", () => {
  test("accepts a well-formed design", () => {
    expect(validateDesign(design)?.fields).toHaveLength(3);
  });

  test("rejects external code and unsafe markup", () => {
    for (const bad of ['<script src="https://x.test/a.js"></script>', "<iframe src=x>", "<link rel=stylesheet href=x>", "@import url(x);", "<a href='javascript:alert(1)'>"]) {
      expect(validateDesign({ ...design, html: html + bad })).toBeNull();
    }
  });

  test("rejects duplicate or malformed field keys", () => {
    expect(validateDesign({ ...design, fields: [design.fields[0], design.fields[0]] })).toBeNull();
    expect(validateDesign({ ...design, fields: [{ ...design.fields[0], key: "1bad" }] })).toBeNull();
  });

  test("coerces out-of-range defaults instead of trusting them", () => {
    const result = validateDesign({ ...design, fields: [{ ...design.fields[1], default: 999 }] });
    expect(result?.fields[0].default).toBe(60);
  });
});

describe("settings", () => {
  test("become CSS variables with units, and select keywords stay raw", () => {
    const valid = validateDesign(design);
    if (!valid) throw new Error("design should be valid");
    const css = settingsToCss(valid.fields, { size: 30, mode: "b" });
    expect(css).toContain("--s-size: 30px;");
    expect(css).toContain("--s-mode: b;");
    expect(css).toContain("--s-textColor: #ffffff;");
  });

  test("invalid saved values fall back to defaults", () => {
    const valid = validateDesign(design);
    if (!valid) throw new Error("design should be valid");
    expect(resolveValues(valid.fields, { textColor: "red; } body { display:none", size: "nope" })).toMatchObject({ textColor: "#ffffff", size: 24 });
  });

  test("closing tags in values cannot break out of the style element", () => {
    const valid = validateDesign({ ...design, fields: [{ key: "label", label: "Label", type: "text", default: "</style><script>x()</script>" }] });
    if (!valid) throw new Error("design should be valid");
    const doc = buildOverlayDocument({ html: valid.html, fields: valid.fields, values: {} }, false, null);
    expect(doc).not.toContain("</style><script>x()");
  });
});

describe("overlay library", () => {
  test("creates from presets, edits, duplicates, resets and deletes", () => {
    dir = mkdtempSync(path.join(tmpdir(), "overlays-"));
    const library = new OverlayLibrary(dir);
    const created = library.createFromPreset("goal-bar");
    expect(created.origin).toBe("preset");
    const edited = library.update(created.id, { values: { target: 100, title: "Sub goal" }, width: 10 });
    expect(edited.values).toMatchObject({ target: 100, title: "Sub goal" });
    expect(edited.width).toBe(40);
    const copy = library.duplicate(created.id);
    expect(copy.id).not.toBe(created.id);
    expect(library.reset(created.id).values).toEqual({});
    library.remove(copy.id);
    // A fresh instance reads what was saved to disk.
    expect(new OverlayLibrary(dir).list().map((entry) => entry.id)).toEqual([created.id]);
  });

  test("a redesign keeps values only for fields that still exist", () => {
    dir = mkdtempSync(path.join(tmpdir(), "overlays-"));
    const library = new OverlayLibrary(dir);
    const valid = validateDesign(design);
    if (!valid) throw new Error("design should be valid");
    const overlay = library.createFromDesign(valid, "custom", { width: 800, height: 600 });
    library.update(overlay.id, { values: { size: 40, mode: "b" } });
    const redesigned = library.replaceDesign(overlay.id, { ...valid, fields: valid.fields.filter((field) => field.key !== "mode") });
    expect(redesigned.values).toEqual({ size: 40 });
  });

  test("every preset has unique, valid fields", () => {
    for (const preset of OVERLAY_PRESETS) {
      expect(validateDesign({ name: preset.name, html: preset.html, fields: preset.fields })).not.toBeNull();
    }
  });
});

describe("live settings", () => {
  test("an edit is pushed to every open copy of the overlay", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "overlays-"));
    const library = new OverlayLibrary(dir);
    const overlay = library.createFromPreset("goal-bar");
    const server = new OverlayServer(
      { state: () => ({ messages: [], sources: [] }), subscribe: () => () => undefined },
      { get: (id) => library.get(id), subscribe: () => () => undefined },
    );
    await server.start(0);
    try {
      const page = await fetch(server.overlayUrl(overlay.id));
      expect(await page.text()).toContain("window.SEENALYZE = api");
      const controller = new AbortController();
      const events = await fetch(`${server.overlayUrl(overlay.id)}/events`, { signal: controller.signal });
      expect(events.headers.get("access-control-allow-origin")).toBe("*");
      const reader = events.body!.getReader();
      await new Promise((resolve) => setTimeout(resolve, 50));
      server.pushSettings(library.update(overlay.id, { values: { title: "Pushed" } }));
      let chunk = "";
      while (!chunk.includes('"type":"settings"')) chunk += new TextDecoder().decode((await reader.read()).value);
      expect(chunk).toContain('"type":"settings"');
      expect(chunk).toContain("Pushed");
      controller.abort();
    } finally {
      server.stop();
    }
  });
});
