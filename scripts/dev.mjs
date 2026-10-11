// `bun run dev`: builds the native helpers, then runs electron-vite dev.
// On macOS, Electron is started through bin/dev-launcher (native/dev_launcher.c)
// so macOS asks for camera/microphone/screen access for the dev app itself
// instead of judging it by the terminal or editor that ran this script.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const native = spawnSync(process.execPath, [path.join(root, "scripts", "build-native.mjs")], { stdio: "inherit" });
if (native.status !== 0) {
  console.error(`[dev] native helper build failed (${native.error?.message ?? `exit ${native.status ?? native.signal}`})`);
  process.exit(native.status || 1);
}

const env = { ...process.env };
if (process.platform === "darwin" && !env.ELECTRON_EXEC_PATH) {
  const launcher = path.join(root, "bin", "dev-launcher");
  if (!existsSync(launcher)) {
    console.error(`[dev] ${launcher} is missing; run \`bun run build:native\``);
    process.exit(1);
  }
  // The electron package's main export is the path of its executable.
  env.SEENALYZE_DEV_ELECTRON = createRequire(import.meta.url)("electron");
  env.ELECTRON_EXEC_PATH = launcher;
}

const cli = path.join(root, "node_modules", "electron-vite", "bin", "electron-vite.js");
const child = spawn(process.execPath, [cli, "dev", ...process.argv.slice(2)], { stdio: "inherit", env, cwd: root });
child.on("error", (error) => {
  console.error("[dev] could not start electron-vite", error);
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
