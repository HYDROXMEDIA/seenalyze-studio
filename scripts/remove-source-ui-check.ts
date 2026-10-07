// Headless UI check for removing a source through the real renderer: opens the
// row's "more" menu, picks Remove, confirms, and verifies the item is gone, no
// overlay is left blocking the window, and the app did not try to quit.
// Uses a hidden window and a throwaway user-data folder (not real app data).
//   bun run check:remove-source

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { IPC, STUDIO_METHODS, type StudioMethod } from "../src/shared/ipc";
import { Studio } from "../src/main/studio";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "seenalyze-remove-check-"));
app.setPath("userData", dataDir);

const t0 = Date.now();
const log = (message: string) => console.log(`[check] +${Date.now() - t0}ms ${message}`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let failed = false;
  let quitRequested = false;
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(__dirname, "out/preload/index.js"), contextIsolation: true, sandbox: true },
  });
  window.on("close", () => {
    quitRequested = true;
  });
  const studio = new Studio(window, () => {
    quitRequested = true;
  });
  const calls: string[] = [];
  ipcMain.handle(IPC.invoke, async (_event, method: StudioMethod, args: unknown[]) => {
    if (!STUDIO_METHODS.includes(method)) throw new Error("invalid-request");
    if (method !== "setPreviewBounds") calls.push(method);
    const handler = studio.api[method] as (...params: unknown[]) => Promise<unknown>;
    return handler(...args);
  });
  window.webContents.on("console-message", (event) => {
    if (event.level === "error" || event.level === "warning") log(`[renderer ${event.level}] ${event.message}`);
  });

  const js = <T>(code: string) => window.webContents.executeJavaScript(code) as Promise<T>;
  const waitFor = async (description: string, code: string, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await js<boolean>(code)) return true;
      await wait(50);
    }
    log(`timed out waiting for ${description}`);
    return false;
  };
  const click = async (description: string, selectorCode: string) => {
    const box = await js<{ x: number; y: number } | null>(`(() => {
      const el = ${selectorCode};
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!box) throw new Error(`not found: ${description}`);
    const hit = await js<string>(`(() => { const el = document.elementFromPoint(${box.x}, ${box.y}); return el ? el.outerHTML.slice(0, 120) : "nothing"; })()`);
    log(`click ${description} at ${box.x},${box.y} -> hits ${hit}`);
    for (const type of ["mouseDown", "mouseUp"] as const) {
      window.webContents.sendInputEvent({ type, x: box.x, y: box.y, button: "left", clickCount: 1 });
      await wait(30);
    }
  };

  try {
    await window.loadFile(path.join(__dirname, "out/renderer/index.html"));
    await studio.start();
    const snapshot = await studio.api.getSnapshot();
    if (!snapshot.ready) throw new Error(`engine not ready: ${snapshot.engineErrorKey ?? "unknown"}`);
    const scene = snapshot.activeScene ?? snapshot.scenes[0]?.name;
    if (!scene) throw new Error("no scene");
    const kind = process.env.CHECK_SOURCE_KIND === "display" ? "display" : "color";
    const name = await studio.api.addSource(scene, kind, "Check source");
    log(`added ${kind} source "${name}" to "${scene}"`);
    await waitFor("source row", `[...document.querySelectorAll("span")].some((s) => s.textContent === ${JSON.stringify(name)})`);

    const row = `[...document.querySelectorAll("span")].find((s) => s.textContent === ${JSON.stringify(name)}).parentElement`;
    await click("more button", `${row}.querySelector('button[aria-haspopup="menu"]')`);
    if (!(await waitFor("menu", `!!document.querySelector('[role="menu"]')`))) failed = true;
    await click("Remove menu item", `[...document.querySelectorAll('[role="menuitem"]')].at(-1)`);
    if (!(await waitFor("confirm dialog", `!!document.querySelector('[role="alertdialog"]')`))) failed = true;
    await wait(300);
    const before = await js<string>(`document.body.style.pointerEvents || "auto"`);
    log(`body pointer-events while dialog open: ${before}`);
    await click("confirm Remove", `[...document.querySelectorAll('[role="alertdialog"] button')].at(-1)`);
    await wait(1500);

    const after = await studio.api.getSnapshot();
    const items = after.scenes.find((entry) => entry.name === scene)?.items.map((item) => item.sourceName) ?? [];
    const dialogOpen = await js<boolean>(`!!document.querySelector('[role="alertdialog"], [role="menu"]')`);
    const pointerEvents = await js<string>(`document.body.style.pointerEvents || "auto"`);
    const blocker = await js<string>(`(() => { const el = document.elementFromPoint(200, 200); return el ? el.outerHTML.slice(0, 120) : "nothing"; })()`);
    log(`calls: ${calls.join(", ")}`);
    log(`items after: ${items.join(", ")} | overlay still open: ${dialogOpen} | body pointer-events: ${pointerEvents}`);
    log(`element at 200,200 after close: ${blocker}`);
    log(`quit requested: ${quitRequested}`);
    if (items.includes(name) || dialogOpen || pointerEvents === "none" || quitRequested || !calls.includes("removeSceneItem")) failed = true;
  } catch (error) {
    console.error("[check] error", error);
    failed = true;
  }

  await studio.shutdown();
  window.destroy();
  rmSync(dataDir, { recursive: true, force: true });
  console.log(failed ? "[check] RESULT: FAIL" : "[check] RESULT: PASS");
  app.exit(failed ? 1 : 0);
});
