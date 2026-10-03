// Renders every built-in overlay preset in a hidden window with demo data and
// fails on script errors or empty output.  bun run check:presets
import { app, BrowserWindow } from "electron";
import { OVERLAY_PRESETS, findPreset } from "../src/main/overlay/presets";
import { OverlayServer } from "../src/main/overlay/server";
app.whenReady().then(async () => {
  const server = new OverlayServer(
    { state: () => ({ messages: [], sources: [] }), subscribe: () => () => undefined },
    { get: () => undefined, preset: findPreset, subscribe: () => () => undefined },
  );
  await server.start(0);
  let failures = 0;
  const win = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { sandbox: true } });
  let errors: string[] = [];
  win.webContents.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
  for (const preset of OVERLAY_PRESETS) {
    errors = [];
    win.setContentSize(preset.width, preset.height);
    await win.loadURL(server.presetUrl(preset.id)).catch((error: unknown) => errors.push(String(error)));
    await new Promise((r) => setTimeout(r, preset.kind === "alert" ? 8500 : 3500));
    // Trigger a test event through the same channel the editor uses.
    await win.webContents.executeJavaScript(`window.postMessage({source:"seenalyze-editor",kind:"event",eventType:"superChat"},"*"); window.postMessage({source:"seenalyze-editor",kind:"chat"},"*");`);
    await new Promise((r) => setTimeout(r, 800));
    const info = await win.webContents.executeJavaScript(`({ elements: document.body.querySelectorAll("*").length, text: document.body.innerText.trim().slice(0, 60).replace(/\\s+/g, " "), hasApi: !!window.SEENALYZE })`);
    const ok = errors.length === 0 && info.hasApi && info.elements > 2;
    if (!ok) failures += 1;
    console.log(`[check] ${ok ? "OK  " : "FAIL"} ${preset.id.padEnd(22)} elements=${String(info.elements).padEnd(4)} text="${info.text}" ${errors.length ? "errors=" + JSON.stringify(errors.slice(0, 2)) : ""}`);
  }
  win.destroy();
  console.log(`[check] ${OVERLAY_PRESETS.length - failures}/${OVERLAY_PRESETS.length} presets OK`);
  server.stop();
  app.exit(failures === 0 ? 0 : 1);
});
