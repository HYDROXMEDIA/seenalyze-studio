// Headless check that the main process stays responsive while the engine
// works, and that quitting finishes quickly with no engine process left over.
// Uses a hidden window and the "Electron" user-data folder (not real app data).
//   bun run check:responsiveness

import { execSync } from "node:child_process";
import { app, BrowserWindow } from "electron";
import { Studio } from "../src/main/studio";

const t0 = Date.now();
const log = (message: string) => console.log(`[check] +${Date.now() - t0}ms ${message}`);

// Main-thread lag monitor: a 20ms timer that records how late it fires.
let maxLag = 0;
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  maxLag = Math.max(maxLag, now - last - 20);
  last = now;
}, 20);

app.whenReady().then(async () => {
  let failed = false;
  const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { sandbox: true } });
  const studio = new Studio(window, () => undefined);
  try {
    await studio.start();
    const snapshot = await studio.api.getSnapshot();
    log(`started ready=${snapshot.ready} error=${snapshot.engineErrorKey ?? "none"} scenes=${snapshot.scenes.length} encoders=${snapshot.encoders.map((e) => e.id).join(",")}`);
    if (!snapshot.ready) failed = true;
    maxLag = 0; // Measure engine work only, not Electron's own startup.

    await studio.api.createScene("Check scene");
    await studio.api.setActiveScene("Check scene");
    const text = await studio.api.addSource("Check scene", "text", "Check text");
    await studio.api.addSource("Check scene", "color", "Check color");
    log(`sources added (${text})`);

    const properties = await studio.api.getSourceProperties(text);
    log(`text properties: ${properties.length}`);
    await studio.api.renameSource(text, "Renamed text");
    await studio.api.setVideoSettings({ baseWidth: 1280, baseHeight: 720, outputWidth: 1280, outputHeight: 720, fps: 30 });
    const after = await studio.api.getSnapshot();
    const scene = after.scenes.find((entry) => entry.name === "Check scene");
    log(`after edits: items=${scene?.items.map((item) => item.sourceName).join(",")} video=${after.video.baseWidth}x${after.video.baseHeight}`);
    if (!scene?.items.some((item) => item.sourceName === "Renamed text")) failed = true;

    await studio.api.removeScene("Check scene");
    await studio.api.setVideoSettings({ baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fps: 30 });
    log(`max main-thread lag during engine work: ${maxLag}ms`);
    if (maxLag > 250) failed = true;
  } catch (error) {
    console.error("[check] error", error);
    failed = true;
  }

  const quitStart = Date.now();
  await studio.shutdown();
  const quitMs = Date.now() - quitStart;
  // The stopped engine host may take a moment to exit.
  let leftover = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    leftover = execSync("pgrep -f 'obs64 seenalyze-studio-' || true").toString().trim();
    if (!leftover) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  log(`shutdown took ${quitMs}ms, leftover engine processes: ${leftover ? leftover.split("\n").length : 0}`);
  if (quitMs > 8000 || leftover) failed = true;
  console.log(failed ? "[check] RESULT: FAIL" : "[check] RESULT: PASS");
  app.exit(failed ? 1 : 0);
});
