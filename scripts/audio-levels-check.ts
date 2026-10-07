// Headless check that audio level meters deliver non-silent levels to the
// main process: adds a media source looping a generated tone and waits for
// its levels. Uses a hidden window and the "Electron" user-data folder.
//   bun run check:audio

import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { IPC } from "../src/shared/ipc";
import type { AudioLevel } from "../src/shared/types";
import { Studio } from "../src/main/studio";

const t0 = Date.now();
const log = (message: string) => console.log(`[check] +${Date.now() - t0}ms ${message}`);

/** 2s, 440Hz, half-scale mono 16-bit WAV. */
function toneFile(): string {
  const rate = 48000;
  const samples = rate * 2;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 16000), 44 + i * 2);
  const path = join(mkdtempSync(join(tmpdir(), "seenalyze-audio-check-")), "tone.wav");
  writeFileSync(path, buffer);
  return path;
}

app.whenReady().then(async () => {
  let failed = false;
  const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { sandbox: true } });
  const received = new Map<string, number>();
  const originalSend = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel: string, ...args: unknown[]) => {
    if (channel === IPC.audioLevels) {
      for (const level of args[0] as AudioLevel[]) {
        const loudest = Math.max(-Infinity, ...level.peak);
        received.set(level.name, Math.max(received.get(level.name) ?? -Infinity, loudest));
      }
    }
    originalSend(channel, ...args);
  };
  const studio = new Studio(window, () => undefined);
  try {
    await studio.start();
    const snapshot = await studio.api.getSnapshot();
    log(`started ready=${snapshot.ready} error=${snapshot.engineErrorKey ?? "none"} audio=${snapshot.audio.map((a) => a.name).join(",")}`);
    if (!snapshot.ready) failed = true;

    await studio.api.createScene("Audio check scene");
    await studio.api.setActiveScene("Audio check scene");
    const name = await studio.api.addSource("Audio check scene", "media", "Check tone");
    await studio.api.updateSourceSettings(name, { is_local_file: true, local_file: toneFile(), looping: true, restart_on_activate: true });
    log(`tone source added (${name})`);

    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !((received.get(name) ?? -Infinity) > -40)) await new Promise((resolve) => setTimeout(resolve, 100));
    log(`levels received: ${[...received.entries()].map(([key, db]) => `${key}=${db.toFixed(1)}dB`).join(", ") || "none"}`);
    if (!((received.get(name) ?? -Infinity) > -40)) failed = true;

    // A muted microphone must not keep its input device open: no meter, no levels.
    const mic = (await studio.api.getSnapshot()).audio.find((entry) => entry.microphone);
    if (mic) {
      await studio.api.setMuted(mic.name, true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      received.clear();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const listed = (await studio.api.getSnapshot()).audio.find((entry) => entry.name === mic.name);
      log(`muted microphone: listed=${Boolean(listed)} muted=${listed?.muted} levels=${received.has(mic.name)}`);
      if (!listed?.muted || received.has(mic.name)) failed = true;
      if (!mic.muted) await studio.api.setMuted(mic.name, false); // Restore the check profile's state.
    }

    await studio.api.removeScene("Audio check scene");
  } catch (error) {
    console.error("[check] error", error);
    failed = true;
  }

  await studio.shutdown();
  let leftover = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    leftover = execSync("pgrep -f 'obs64 seenalyze-studio-' | xargs -r ps -o pid=,command= -p 2>/dev/null | grep -v '/Applications/' || true").toString().trim();
    if (!leftover) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (leftover) failed = true;
  console.log(failed ? "[check] RESULT: FAIL" : "[check] RESULT: PASS");
  app.exit(failed ? 1 : 0);
});
