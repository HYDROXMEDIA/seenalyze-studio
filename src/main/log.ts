// Persistent app log so an installed copy keeps a record of errors after a
// crash or unexpected quit (packaged apps have no terminal). Lives in the OS
// logs folder (macOS: ~/Library/Logs/SEENALYZE STUDIO/main.log); the previous
// file is kept as main.old.log once it grows past the size limit.

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { format } from "node:util";
import { app } from "electron";

const MAX_BYTES = 5 * 1024 * 1024;

let file: string | null = null;

/** Never persist credentials: stream URLs can carry keys, and tokens may appear in errors. */
function redact(text: string): string {
  return text
    .replace(/\b(rtmps?|srt):\/\/[^\s"'<>]+/giu, "$1://[redacted]")
    .replace(/\b(Bearer)\s+[\w.~+/=-]+/giu, "$1 [redacted]")
    .replace(/\b(access_token|refresh_token|client_secret|code|key|token)=[^\s&"']+/giu, "$1=[redacted]");
}

export function appendLog(level: string, text: string): void {
  if (!file) return;
  try {
    appendFileSync(file, `${new Date().toISOString()} [${level}] ${redact(text.trimEnd())}\n`);
  } catch {
    // Logging must never take the app down; the console still has the message.
  }
}

/** Mirrors console warnings and errors into the log file. Call once, before anything else logs. */
export function installAppLog(): void {
  try {
    const dir = app.getPath("logs");
    mkdirSync(dir, { recursive: true });
    file = path.join(dir, "main.log");
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, path.join(dir, "main.old.log"));
    } catch {
      // No previous log yet.
    }
  } catch (error) {
    file = null;
    console.error("[log] could not open the app log", error);
    return;
  }
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      appendLog(level, format(...args));
    };
  }
  // The monitor variant records without changing how Electron handles the error.
  process.on("uncaughtExceptionMonitor", (error) => appendLog("fatal", format("uncaught exception", error)));
  process.on("unhandledRejection", (reason) => appendLog("error", format("unhandled rejection", reason)));
  app.on("render-process-gone", (_event, _contents, details) => appendLog("error", format("renderer process gone", details)));
  app.on("child-process-gone", (_event, details) => appendLog("error", format("child process gone", details)));
  appendLog("info", `started ${app.getName()} ${app.getVersion()} on ${process.platform} ${process.arch}`);
}
