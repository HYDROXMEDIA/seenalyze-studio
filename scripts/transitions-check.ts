// Headless check for scene transitions: applies every transition preset,
// switches scenes with each, and verifies the program output ends on the new
// scene; then quits and checks no engine host is left over.
// Uses a hidden window and a throwaway user-data folder (not real app data).
//   bun run check:transitions

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { Studio } from "../src/main/studio";
import { TRANSITION_PRESETS } from "../src/shared/transitions";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "seenalyze-transitions-check-"));
app.setPath("userData", dataDir);

const t0 = Date.now();
const log = (message: string) => console.log(`[check] +${Date.now() - t0}ms ${message}`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let failed = false;
  const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { sandbox: true } });
  const studio = new Studio(window, () => undefined);
  // Test-only access to the engine client for the program-output source.
  const engine = (studio as unknown as { engine: { call(method: "programSource"): Promise<string | null> } }).engine;
  try {
    await studio.start();
    const snapshot = await studio.api.getSnapshot();
    if (!snapshot.ready) throw new Error(`engine not ready: ${snapshot.engineErrorKey ?? "unknown"}`);
    log(`default transition: ${snapshot.transition.id} ${snapshot.transition.durationMs}ms, program=${await engine.call("programSource")}`);
    if (snapshot.transition.id !== "fade" || snapshot.transition.durationMs !== 300) failed = true;
    const first = snapshot.activeScene as string;
    if ((await engine.call("programSource")) !== first) failed = true;
    await studio.api.createScene("Check B");
    await studio.api.addSource("Check B", "color", "Check color");

    let target = "Check B";
    for (const preset of TRANSITION_PRESETS) {
      // The stinger plays a video the user picks; it has no file to play here.
      if (preset.id === "stinger") {
        log("stinger skipped (needs a video file)");
        continue;
      }
      await studio.api.setTransition({ id: preset.id, durationMs: preset.defaultDurationMs });
      const duration = (await studio.api.getSnapshot()).transition.durationMs;
      await studio.api.setActiveScene(target);
      const during = await engine.call("programSource");
      await wait(duration + 250);
      const after = await engine.call("programSource");
      const ok = after === target;
      log(`${preset.id} (${preset.engineId}, ${duration}ms): during=${during} after=${after} ${ok ? "ok" : "FAIL"}`);
      if (!ok) failed = true;
      target = target === first ? "Check B" : first;
    }

    // Rename then remove the active scene: output must cut to the remaining one.
    await studio.api.setTransition({ id: "fade", durationMs: 300 });
    await studio.api.setActiveScene("Check B");
    await wait(500);
    await studio.api.renameScene("Check B", "Check C");
    await studio.api.removeScene("Check C");
    const remaining = (await studio.api.getSnapshot()).activeScene;
    const program = await engine.call("programSource");
    log(`after removing active scene: active=${remaining} program=${program}`);
    if (remaining !== first || program !== first) failed = true;
  } catch (error) {
    console.error("[check] error", error);
    failed = true;
  }

  const quitStart = Date.now();
  await studio.shutdown();
  log(`quit took ${Date.now() - quitStart}ms`);
  let leftover = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    leftover = execSync("pgrep -f 'obs64 seenalyze-studio-' || true").toString().trim();
    if (!leftover) break;
    await wait(250);
  }
  if (leftover) {
    log(`leftover engine host: ${leftover.replace(/\s+/g, ",")}`);
    failed = true;
  }
  window.destroy();
  rmSync(dataDir, { recursive: true, force: true });
  console.log(failed ? "[check] RESULT: FAIL" : "[check] RESULT: PASS");
  app.exit(failed ? 1 : 0);
});
