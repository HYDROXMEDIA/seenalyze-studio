// Headless check of the recording editor: generates a short video with
// ffmpeg, opens it in a hidden editor window from the built app (out/), and
// verifies the page loads the video through the private media scheme, shows
// translated text, saves edits, and exports a new video (checked with
// ffprobe). Nothing is shown on screen.
//   bun run check:screen-recording   (needs ffmpeg)

import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { app, BrowserWindow, dialog } from "electron";
import { EditorWindows } from "../src/main/screen-recording/editor";
import { handleMediaScheme, registerMediaScheme } from "../src/main/screen-recording/media-protocol";

const t0 = Date.now();
const log = (message: string) => console.log(`[check] +${Date.now() - t0}ms ${message}`);

registerMediaScheme();
// Windows stay hidden: the check never takes focus or draws on screen.
BrowserWindow.prototype.show = function show() {};
app.focus = () => undefined;

async function waitFor(window: BrowserWindow, expression: string, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await window.webContents.executeJavaScript(expression).catch(() => null);
    if (value || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

app.whenReady().then(async () => {
  let failed = false;
  const directory = mkdtempSync(path.join(tmpdir(), "studio-editor-check-"));
  try {
    handleMediaScheme();
    const video = path.join(directory, "Screen Recording check.mp4");
    execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video]);
    log("video generated");

    const exported = path.join(directory, "Screen Recording check (Edited).mp4");
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: exported })) as typeof dialog.showSaveDialog;
    // Run from the repository root, where scripts/build-native.mjs puts the helpers.
    const muxer = path.join(process.cwd(), "bin", "video-muxer");

    const editors = new EditorWindows({
      log: (line) => log(line),
      theme: () => "dark",
      openAfterRecording: () => true,
      setOpenAfterRecording: () => undefined,
      onExported: () => undefined,
      transcribe: async () => ({ captions: [] }),
      cancelTranscription: () => undefined,
      muxerPath: () => (process.platform === "darwin" && existsSync(muxer) ? muxer : null),
    });
    editors.registerIpc();
    if (!(await editors.open(video))) throw new Error("editor did not open");
    const window = BrowserWindow.getAllWindows().at(-1);
    if (!window) throw new Error("no editor window");
    window.webContents.on("console-message", (event) => log(`[editor] ${event.message}`));

    const state = await waitFor(window, `document.body.dataset.state === 'ready' || document.body.dataset.state === 'error' ? document.body.dataset.state : null`, 20000);
    log(`editor state: ${String(state)}`);
    if (state !== "ready") failed = true;

    const page = (await window.webContents.executeJavaScript(`({
      title: document.getElementById('title').textContent,
      untranslated: [...document.querySelectorAll('[data-i18n]')].filter((node) => node.textContent.startsWith('screenRecording.')).length,
      exportLabel: document.getElementById('export').textContent,
      size: [document.getElementById('canvas').width, document.getElementById('canvas').height]
    })`)) as { title: string; untranslated: number; exportLabel: string; size: [number, number] };
    log(`title="${page.title}" export="${page.exportLabel}" untranslated=${page.untranslated} canvas=${page.size.join("x")}`);
    if (page.title !== "Screen Recording check" || page.untranslated > 0 || page.exportLabel !== "Export" || page.size[0] === 0) failed = true;

    // A style change is an edit; it must be saved for the recording.
    const before = await window.webContents.executeJavaScript(`document.getElementById('motion-blur').checked`);
    await window.webContents.executeJavaScript(`document.getElementById('motion-blur').click()`);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const saved = await window.webContents.executeJavaScript(`window.recordingEditor.init().then((init) => init?.project?.look?.motionBlur)`);
    log(`motion blur saved: ${String(saved)} (was ${String(before)})`);
    if (saved !== !before) failed = true;

    // Export through the dialog's default choices, then read the file back.
    await window.webContents.executeJavaScript(`document.getElementById('export').click()`);
    await waitFor(window, `document.getElementById('export-dialog').open`, 3000);
    await window.webContents.executeJavaScript(`document.getElementById('export-confirm').click()`);
    const started = await waitFor(window, `document.body.dataset.state === 'exporting'`, 5000);
    const finished = started && (await waitFor(window, `document.body.dataset.state === 'ready'`, 60000));
    const toast = await window.webContents.executeJavaScript(`document.getElementById('toast')?.textContent ?? ''`);
    const probe = existsSync(exported)
      ? execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", exported]).toString()
      : "{}";
    const info = JSON.parse(probe) as { streams?: Array<{ codec_type: string; width?: number }>; format?: { duration?: string } };
    const duration = Number(info.format?.duration ?? 0);
    log(`export started=${String(started)} finished=${String(finished)} toast="${String(toast).trim()}" bytes=${existsSync(exported) ? statSync(exported).size : 0} streams=${(info.streams ?? []).map((stream) => stream.codec_type).join(",")} duration=${duration.toFixed(2)}s`);
    if (!info.streams?.some((stream) => stream.codec_type === "video") || Math.abs(duration - 2) > 0.3) failed = true;

    window.destroy();
    await editors.shutdown();
  } catch (error) {
    console.error("[check] error", error);
    failed = true;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  console.log(failed ? "[check] RESULT: FAIL" : "[check] RESULT: PASS");
  app.exit(failed ? 1 : 0);
});
