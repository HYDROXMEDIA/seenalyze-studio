// Builds the macOS screen-recording helpers and the preview presenter into
// bin/. Windows uses the PowerShell scripts in native/ and needs no build step.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

if (process.platform !== "darwin") process.exit(0);

const root = path.resolve(import.meta.dirname, "..");
const bin = path.join(root, "bin");
mkdirSync(bin, { recursive: true });

// Built for the app's minimum macOS so newer SDK deprecations do not apply.
const target = ["-target", `${process.arch === "x64" ? "x86_64" : "arm64"}-apple-macos13.0`];
const helpers = [
  { source: "screen_recorder.swift", output: "screen-recorder", frameworks: ["ScreenCaptureKit", "AVFoundation", "CoreMedia", "AppKit"] },
  { source: "video_muxer.swift", output: "video-muxer", frameworks: ["AVFoundation", "CoreMedia"] },
  { source: "media_tools.swift", output: "media-tools", frameworks: ["AVFoundation"] },
  { source: "window_list.swift", output: "window-list", frameworks: ["AppKit"] },
  { source: "audio_inputs.swift", output: "audio-inputs", frameworks: ["CoreAudio"] },
];

let built = 0;
for (const helper of helpers) {
  const source = path.join(root, "native", helper.source);
  const output = path.join(bin, helper.output);
  // Up-to-date helpers are kept, so starting the app stays fast.
  if (existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs) continue;
  const args = [source, "-O", ...target, ...helper.frameworks.flatMap((name) => ["-framework", name]), "-o", output];
  const result = spawnSync("swiftc", args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[build-native] ${helper.source} failed`);
    process.exit(result.status ?? 1);
  }
  built += 1;
}

// The preview presenter is a Node-API addon (stable ABI, so it does not depend
// on the Electron version); Node-API's headers ship with Node itself.
const presenterSource = path.join(root, "native", "preview_presenter.mm");
const presenterOutput = path.join(bin, "preview-presenter.node");
if (!existsSync(presenterOutput) || statSync(presenterOutput).mtimeMs < statSync(presenterSource).mtimeMs) {
  const headers = path.resolve(path.dirname(process.execPath), "..", "include", "node");
  if (!existsSync(path.join(headers, "node_api.h"))) {
    console.error(`[build-native] Node-API headers not found in ${headers}; run this script with a Node.js install that includes them`);
    process.exit(1);
  }
  const args = [
    "-std=c++17", "-fobjc-arc", "-O2", "-Wall", "-Wextra", "-Werror", ...target,
    "-bundle", "-undefined", "dynamic_lookup", "-I", headers, presenterSource,
    ...["AppKit", "QuartzCore", "Metal", "IOSurface"].flatMap((name) => ["-framework", name]),
    "-o", presenterOutput,
  ];
  const result = spawnSync("clang++", args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("[build-native] preview_presenter.mm failed");
    process.exit(result.status ?? 1);
  }
  built += 1;
}
// Development-only launcher used by scripts/dev.mjs so macOS treats the dev
// app as its own app for camera/microphone/screen access. Not shipped.
const launcherSource = path.join(root, "native", "dev_launcher.c");
const launcherOutput = path.join(bin, "dev-launcher");
if (!existsSync(launcherOutput) || statSync(launcherOutput).mtimeMs < statSync(launcherSource).mtimeMs) {
  const result = spawnSync("clang", ["-O2", "-Wall", "-Wextra", "-Werror", ...target, launcherSource, "-o", launcherOutput], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("[build-native] dev_launcher.c failed");
    process.exit(result.status ?? 1);
  }
  built += 1;
}
if (built > 0) console.log(`[build-native] built ${built} helper(s) into bin/`);
