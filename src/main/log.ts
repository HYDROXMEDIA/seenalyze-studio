// Persistent app log so an installed copy keeps a record of errors after a
// crash or unexpected quit (packaged apps have no terminal). Lives in the OS
// logs folder (macOS: ~/Library/Logs/SEENALYZE STUDIO/main.log); the previous
// file is kept as main.old.log once it grows past the size limit.

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { format } from "node:util";
import { app } from "electron";

const MAX_BYTES = 5 * 1024 * 1024;

let file: string | null = null;

/** Never persist credentials: stream URLs can carry keys, and tokens may appear in errors. */
export function redact(text: string): string {
  return text
    .replace(/"(stream_?key|streamKey|key|token|access_?token|accessToken|refresh_?token|refreshToken|client_?secret|password|secret)"\s*:\s*"[^"]*"/giu, '"$1":"[redacted]"')
    .replace(/\b(rtmps?|srt):\/\/[^\s"'<>]+/giu, "$1://[redacted]")
    .replace(/\b(Bearer)\s+[\w.~+/=-]+/giu, "$1 [redacted]")
    .replace(/\b(access_token|refresh_token|client_secret|code|key|token)=[^\s&"']+/giu, "$1=[redacted]");
}

let size = 0;
/** Lines waiting for the next asynchronous write; warnings during a stream must not block the main thread. */
let pending: string[] = [];
let writing = false;

function rotateIfLarge(target: string): void {
  if (size <= MAX_BYTES) return;
  try {
    renameSync(target, path.join(path.dirname(target), "main.old.log"));
  } catch (error) {
    // Keep appending to the current file; the console still has every message.
    process.stderr.write(`[log] could not rotate the app log: ${error instanceof Error ? error.message : "unknown error"}\n`);
  }
  size = 0;
}

function flush(): void {
  if (writing || !file || pending.length === 0) return;
  const target = file;
  const chunk = pending.join("");
  pending = [];
  writing = true;
  appendFile(target, chunk)
    .then(() => {
      size += Buffer.byteLength(chunk);
      rotateIfLarge(target);
    })
    .catch((error: unknown) => {
      // Logging must never take the app down; the console still has the message.
      process.stderr.write(`[log] could not write the app log: ${error instanceof Error ? error.message : "unknown error"}\n`);
    })
    .finally(() => {
      writing = false;
      flush();
    });
}

/** Writes whatever is still queued; used when the process exits or crashes. */
export function flushAppLog(): void {
  if (!file || pending.length === 0) return;
  const chunk = pending.join("");
  pending = [];
  try {
    appendFileSync(file, chunk);
  } catch (error) {
    process.stderr.write(`[log] could not write the app log: ${error instanceof Error ? error.message : "unknown error"}\n`);
  }
}

export function appendLog(level: string, text: string): void {
  if (!file) return;
  pending.push(`${new Date().toISOString()} [${level}] ${redact(text.trimEnd())}\n`);
  // A crash may end the process before an asynchronous write finishes.
  if (level === "fatal") flushAppLog();
  else if (!writing) setImmediate(flush);
}

/** Mirrors console warnings and errors into the log file. Call once, before anything else logs. */
export function installAppLog(): void {
  try {
    const dir = app.getPath("logs");
    mkdirSync(dir, { recursive: true });
    file = path.join(dir, "main.log");
    try {
      size = statSync(file).size;
      if (size > MAX_BYTES) {
        renameSync(file, path.join(dir, "main.old.log"));
        size = 0;
      }
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
      const text = format(...args);
      // The terminal copy is redacted too: development sessions may be shared or recorded.
      original(redact(text));
      appendLog(level, text);
    };
  }
  // The monitor variant records without changing how Electron handles the error.
  process.on("exit", flushAppLog);
  process.on("uncaughtExceptionMonitor", (error) => appendLog("fatal", format("uncaught exception", error)));
  process.on("unhandledRejection", (reason) => appendLog("error", format("unhandled rejection", reason)));
  app.on("render-process-gone", (_event, _contents, details) => appendLog("error", format("renderer process gone", details)));
  app.on("child-process-gone", (_event, details) => appendLog("error", format("child process gone", details)));
  appendLog("info", `started ${app.getName()} ${app.getVersion()} on ${process.platform} ${process.arch}`);
}
