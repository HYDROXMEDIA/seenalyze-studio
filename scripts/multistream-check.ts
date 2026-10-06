// End-to-end multistream check against local RTMP receivers, using the app's
// real engine modules (no UI). Build with electron-vite, then run under Electron:
//   bun run check:multistream
// Requires two local receivers, e.g.:
//   ffmpeg -listen 1 -i rtmp://127.0.0.1:1935/live/test-a -c copy -f flv a.flv
//   ffmpeg -listen 1 -i rtmp://127.0.0.1:1936/live/test-b -c copy -f flv b.flv

import { app } from "electron";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { DestinationConfig, DestinationStatus } from "../src/shared/types";
import { EngineSession } from "../src/main/engine/engine";
import { setVendorRoot } from "../src/main/engine/osn";
import path from "node:path";
import { OutputManager } from "../src/main/engine/outputs";
import { SceneGraph } from "../src/main/engine/scenes";

const PROFILE = { width: 1280, height: 720, fps: 30, videoBitrateKbps: 2500, audioBitrateKbps: 160, keyframeSec: 2, codec: "h264" as const };
const testData = path.join(app.getAppPath(), ".multistream-check-data");
mkdirSync(testData, { recursive: true });
app.setPath("userData", testData);
const toneFile = path.join(testData, "tone.wav");
const samples = 48000 * 3;
const wave = Buffer.alloc(44 + samples * 4);
wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(2, 22);
wave.writeUInt32LE(48000, 24); wave.writeUInt32LE(192000, 28); wave.writeUInt16LE(4, 32); wave.writeUInt16LE(16, 34);
wave.write("data", 36); wave.writeUInt32LE(samples * 4, 40);
for (let i = 0; i < samples; i += 1) {
  const sample = Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 2000);
  wave.writeInt16LE(sample, 44 + i * 4); wave.writeInt16LE(sample, 46 + i * 4);
}
writeFileSync(toneFile, wave);

function destination(id: string, port: number): { config: DestinationConfig; server: string; streamKey: string } {
  return {
    config: { id, platform: "twitch", name: id, enabled: true, mode: "manual", server: "", hasStreamKey: true, profile: PROFILE },
    server: `rtmp://127.0.0.1:${port}/live`,
    streamKey: id,
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  setVendorRoot(path.join(app.getAppPath(), "vendor"));
  const engine = new EngineSession(
    { baseWidth: 1280, baseHeight: 720, outputWidth: 1280, outputHeight: 720, fps: 30 },
    { dataDir: app.getPath("userData"), appVersion: app.getVersion() },
  );
  let failed = false;
  try {
    engine.start();
    const scenes = new SceneGraph(engine);
    scenes.createScene("Scene");
    scenes.addSource("Scene", "color", "Background");
    // Synthetic audio only: checks must not open the user's microphone.
    scenes.addSource("Scene", "media", "Test tone", { is_local_file: true, local_file: toneFile, looping: true, close_when_inactive: false });
    const outputs = new OutputManager(engine);
    const log: string[] = [];
    outputs.on("status", (status: DestinationStatus) => log.push(`${status.id}:${status.state}${status.errorKey ? `(${status.errorKey})` : ""}`));

    const encoder = engine.availableEncoders()[0]?.id;
    if (!encoder) throw new Error("no encoder");
    console.log(`[check] encoder ${encoder}`);
    outputs.start([destination("test-a", 1935), destination("test-b", 1936)], encoder);
    // Bitrate is measured between samples, so take a warm-up sample first.
    await wait(7000);
    outputs.refreshStats();
    await wait(1500);
    outputs.refreshStats();
    const live = outputs.statuses();
    console.log(`[check] after 8s: ${JSON.stringify(live.map(({ id, state, kbps, encoderGroup }) => ({ id, state, kbps, encoderGroup })))}`);
    const groups = new Set(live.map((status) => status.encoderGroup));
    if (live.length !== 2 || live.some((status) => status.state !== "live" || status.kbps <= 0)) failed = true;
    if (groups.size !== 1) {
      console.log("[check] FAIL: destinations did not share one encoder");
      failed = true;
    }

    console.log("[check] stopping test-b only");
    outputs.stop(["test-b"]);
    await wait(3000);
    outputs.refreshStats();
    await wait(1500);
    outputs.refreshStats();
    const after = outputs.statuses();
    console.log(`[check] after stop: ${JSON.stringify(after.map(({ id, state, kbps }) => ({ id, state, kbps })))}`);
    if (after.length !== 1 || after[0].id !== "test-a" || after[0].state !== "live" || after[0].kbps <= 0) {
      console.log("[check] FAIL: test-a was affected by stopping test-b");
      failed = true;
    }

    outputs.stopAll();
    await wait(2000);
    console.log(`[check] status log: ${log.join(" ")}`);
  } catch (error) {
    console.error("[check] error", error);
    failed = true;
  } finally {
    // Never let a stuck engine shutdown keep the check alive.
    setTimeout(() => app.exit(failed ? 1 : 0), 10_000).unref();
    engine.shutdown();
    rmSync(testData, { recursive: true, force: true });
  }
  console.log(failed ? "[check] RESULT: FAIL" : "[check] RESULT: PASS");
  app.exit(failed ? 1 : 0);
});
