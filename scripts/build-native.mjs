// Builds the macOS screen-recording helpers into bin/. Windows uses the
// PowerShell scripts in native/ and needs no build step.
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
if (built > 0) console.log(`[build-native] built ${built} helper(s) into bin/`);
