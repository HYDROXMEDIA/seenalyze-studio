// Headless UI check for removing a source through the real renderer: opens the
// row's "more" menu, picks Remove, confirms, and verifies the item is gone, no
// overlay is left blocking the window, and the app did not try to quit.
// Uses a hidden window and a throwaway user-data folder (not real app data).
// The renderer and preload come from out/, which the package script rebuilds first.
//   bun run check:remove-source

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type { AbstractIntlMessages } from "use-intl";
import { IPC, STUDIO_METHODS, type StudioMethod } from "../src/shared/ipc";
import { Studio } from "../src/main/studio";
import { loadMessages } from "../src/renderer/i18n";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "seenalyze-remove-check-"));
app.setPath("userData", dataDir);

const t0 = Date.now();
const log = (message: string) => console.log(`[check] +${Date.now() - t0}ms ${message}`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A `common.*` label as the renderer shows it in its active language. */
function commonLabel(messages: AbstractIntlMessages, key: string): string {
  const common = messages.common;
  const value = typeof common === "object" ? common[key] : undefined;
  if (typeof value !== "string") throw new Error(`missing translation: common.${key}`);
  return value;
}

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
      // Long menus are capped to the window and scroll; bring the target into view like a user would.
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!box) throw new Error(`not found: ${description}`);
    const hit = await js<{ onTarget: boolean; html: string }>(`(() => {
      const target = ${selectorCode};
      const el = document.elementFromPoint(${box.x}, ${box.y});
      return { onTarget: !!el && !!target && target.contains(el), html: el ? el.outerHTML.slice(0, 120) : "nothing" };
    })()`);
    log(`click ${description} at ${box.x},${box.y} -> hits ${hit.html}`);
    // Clicking a covered target would act on whatever covers it instead.
    if (!hit.onTarget) throw new Error(`${description} is covered at ${box.x},${box.y}`);
    for (const type of ["mouseDown", "mouseUp"] as const) {
      window.webContents.sendInputEvent({ type, x: box.x, y: box.y, button: "left", clickCount: 1 });
      await wait(30);
    }
  };

  try {
    await window.loadFile(path.join(__dirname, "out/renderer/index.html"));
    await studio.start();
    // The throwaway profile is a first run; dismiss the setup guide so it does not cover the docks.
    await studio.api.completeSetup();
    const snapshot = await studio.api.getSnapshot();
    if (!snapshot.ready) throw new Error(`engine not ready: ${snapshot.engineErrorKey ?? "unknown"}`);
    const scene = snapshot.activeScene ?? snapshot.scenes[0]?.name;
    if (!scene) throw new Error("no scene");
    const kind = process.env.CHECK_SOURCE_KIND === "display" ? "display" : "color";
    const name = await studio.api.addSource(scene, kind, "Check source");
    log(`added ${kind} source "${name}" to "${scene}"`);
    const rowExists = `[...document.querySelectorAll("span")].some((s) => s.textContent === ${JSON.stringify(name)})`;
    if (!(await waitFor("source row", rowExists))) throw new Error("source row not shown");

    // Labels follow the renderer's language, which a fresh profile takes from the system.
    const { locale, messages } = loadMessages(await js<string>("document.documentElement.lang"));
    const more = commonLabel(messages, "more");
    const remove = commonLabel(messages, "remove");
    log(`renderer language: ${locale}`);

    // The row menu is an in-page menu: open it from the row's "more" button and pick Remove like a user.
    const row = `[...document.querySelectorAll("span")].find((s) => s.textContent === ${JSON.stringify(name)}).parentElement`;
    await click("more button", `[...${row}.querySelectorAll('button[aria-haspopup="menu"]')].find((el) => el.getAttribute("aria-label") === ${JSON.stringify(more)})`);
    if (!(await waitFor("row menu", `!!document.querySelector('[role="menu"]')`))) throw new Error("row menu was not opened");
    await wait(300); // let the menu's open animation finish so the item is where it will stay
    await click(
      "menu Remove",
      `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((el) => el.textContent.trim() === ${JSON.stringify(remove)} && !el.hasAttribute("data-disabled"))`,
    );
    if (!(await waitFor("confirm dialog", `!!document.querySelector('[role="alertdialog"]')`))) throw new Error("confirm dialog not shown");
    await wait(300);
    const menuOpenWithDialog = await js<boolean>(`!!document.querySelector('[role="menu"]')`);
    const before = await js<string>(`document.body.style.pointerEvents || "auto"`);
    log(`body pointer-events while dialog open: ${before} | menu still open: ${menuOpenWithDialog}`);
    if (menuOpenWithDialog) failed = true;
    await click("confirm Remove", `[...document.querySelectorAll('[role="alertdialog"] button')].find((el) => el.textContent.trim() === ${JSON.stringify(remove)})`);

    // Wait for the row to leave and every overlay (and the pointer lock it holds) to finish closing.
    const settled = await waitFor(
      "removal to settle",
      `!(${rowExists}) && !document.querySelector('[role="alertdialog"], [role="menu"]') && document.body.style.pointerEvents !== "none"`,
    );
    const after = await studio.api.getSnapshot();
    const items = after.scenes.find((entry) => entry.name === scene)?.items.map((item) => item.sourceName) ?? [];
    const rowShown = await js<boolean>(rowExists);
    const overlayOpen = await js<boolean>(`!!document.querySelector('[role="alertdialog"], [role="menu"]')`);
    const pointerEvents = await js<string>(`document.body.style.pointerEvents || "auto"`);
    const blocker = await js<string>(`(() => { const el = document.elementFromPoint(200, 200); return el ? el.outerHTML.slice(0, 120) : "nothing"; })()`);
    log(`calls: ${calls.join(", ")}`);
    log(`items after: ${items.join(", ")} | row still shown: ${rowShown} | overlay still open: ${overlayOpen} | body pointer-events: ${pointerEvents}`);
    log(`element at 200,200 after close: ${blocker}`);
    log(`quit requested: ${quitRequested}`);
    if (!settled || items.includes(name) || rowShown || overlayOpen || pointerEvents === "none" || quitRequested || !calls.includes("removeSceneItem")) failed = true;
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
