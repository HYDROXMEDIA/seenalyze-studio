// Native source/property/scene roundtrip check without opening capture devices.
// Uses isolated app data and never asks for screen/camera/microphone access.
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { EngineSession } from "../src/main/engine/engine";
import { setVendorRoot } from "../src/main/engine/osn";
import { SceneGraph } from "../src/main/engine/scenes";

const dataDir = path.join(app.getAppPath(), ".sources-check-data");
mkdirSync(dataDir, { recursive: true });
app.setPath("userData", dataDir);

app.whenReady().then(() => {
  setVendorRoot(path.join(app.getAppPath(), "vendor"));
  const engine = new EngineSession(
    { baseWidth: 640, baseHeight: 360, outputWidth: 640, outputHeight: 360, fps: 30 },
    { dataDir, appVersion: app.getVersion() },
  );
  let failed = false;
  let started = false;
  try {
    engine.start();
    started = true;
    const graph = new SceneGraph(engine);
    graph.createScene("Program");
    graph.createScene("Camera layout");
    const kinds = graph.availableKinds();
    console.log(`[sources] installed kinds: ${kinds.join(", ")}`);
    const text = graph.addSource("Camera layout", "text", "Caption");
    const properties = graph.getProperties(text);
    assert(properties.some((property) => property.kind === "font"));
    graph.updateSettings(text, { text: "Source check" });
    assert.equal(graph.input(text).settings.text, "Source check");
    const backdrop = graph.addSource("Program", "color", "Backdrop");
    const item = graph.listScenes().find((scene) => scene.name === "Program")!.items.find((entry) => entry.sourceName === backdrop)!;
    assert(graph.getProperties(backdrop).find((property) => property.kind === "color")?.allowAlpha);
    const initial = graph.getItemTransform("Program", item.id);
    const layout = { ...initial, x: 42, y: 58, width: 320, height: 180, rotation: 15, crop: { left: 5, top: 3, right: 4, bottom: 2 } };
    graph.setItemTransform("Program", item.id, layout);
    assert.equal(graph.getItemTransform("Program", item.id).x, 42);
    assert.deepEqual(graph.getItemTransform("Program", item.id).crop, layout.crop);
    graph.setItemLocked("Program", item.id, true);
    assert.throws(() => graph.setItemTransform("Program", item.id, initial), /item-locked/u);
    graph.setItemLocked("Program", item.id, false);
    assert.throws(() => graph.setItemTransform("Program", item.id, { ...layout, width: NaN }), /invalid-transform/u);
    assert.equal(graph.getItemTransform("Program", item.id).width, 320);
    assert(graph.readiness(() => 1).pictureSources > 0);
    if (kinds.includes("slideshow")) {
      const slideshow = graph.addSource("Program", "slideshow", "Images");
      assert(graph.getProperties(slideshow).some((property) => property.kind === "editableList"));
    }
    graph.addExistingSource("Program", text);
    graph.addExistingSource("Program", "Camera layout");
    assert.throws(() => graph.addExistingSource("Camera layout", "Program"), /scene-cycle/u);
    assert.throws(() => graph.removeScene("Camera layout"), /scene-in-use/u);
    graph.renameScene("Camera layout", "Shared layout");
    assert(graph.listScenes().find((scene) => scene.name === "Program")?.items.some((item) => item.kind === "scene" && item.sourceName === "Shared layout"));
    const collection = graph.save();
    collection.sources.push({ name: "Unavailable device", kind: "camera", inputId: "synthetic_missing_source", settings: { device: "test-only" }, muted: false });
    collection.scenes.Program.push({ ...collection.scenes.Program[0], source: "Unavailable device" });
    engine.shutdown();
    started = false;
    engine.start();
    started = true;
    const restored = new SceneGraph(engine);
    restored.load(collection);
    const restoredItem = restored.listScenes().find((scene) => scene.name === "Program")!.items.find((entry) => entry.sourceName === backdrop)!;
    const restoredLayout = restored.getItemTransform("Program", restoredItem.id);
    assert.equal(restoredLayout.x, layout.x);
    assert.equal(restoredLayout.width, layout.width);
    assert.deepEqual(restoredLayout.crop, layout.crop);
    assert.equal(restored.readiness(() => 1).missingSources, 1);
    assert.equal(restored.unavailableSourceCount, 1);
    assert(restored.save().sources.some((source) => source.name === "Unavailable device"));
    assert(restored.save().scenes.Program.some((item) => item.source === "Unavailable device"));
    assert(restored.listScenes().find((scene) => scene.name === "Program")?.items.some((item) => item.kind === "scene" && item.sourceName === "Shared layout"));
    assert.equal(restored.input(text).settings.text, "Source check");
    console.log("[sources] properties, shared sources, nesting, cycle protection and persistence: PASS");
  } catch (error) {
    console.error("[sources] check failed", error);
    failed = true;
  } finally {
    if (started) engine.shutdown();
    rmSync(dataDir, { recursive: true, force: true });
  }
  app.exit(failed ? 1 : 0);
});
