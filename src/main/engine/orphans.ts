// The libobs host process outlives the app if the app is force-killed. Each
// host is started with a pipe name that embeds the owning app's PID, so on
// startup we stop any host whose owner is no longer running.

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PIPE_PREFIX = "seenalyze-studio-";

export function pipeName(id: string): string {
  return `${PIPE_PREFIX}${process.pid}-${id}`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

type HostProcess = { pid: number; commandLine: string };

const WINDOWS_LIST: [string, string[]] = [
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='obs64.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }",
  ],
];
const POSIX_LIST: [string, string[]] = ["ps", ["-A", "-o", "pid=,stat=,command="]];
const LIST_TIMEOUT_MS = 10_000;

function parseHostProcesses(output: string): HostProcess[] {
  if (process.platform === "win32") {
    return output
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        const [pid, ...rest] = line.split("\t");
        return { pid: Number(pid), commandLine: rest.join("\t") };
      });
  }
  return (
    output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(`obs64 ${PIPE_PREFIX}`))
      .map((line) => {
        const [pid, stat, ...rest] = line.split(/\s+/u);
        return { pid: Number(pid), stat: stat ?? "", commandLine: rest.join(" ") };
      })
      // On macOS the engine starts the host as its own child; once the host
      // exits it stays a zombie until the (blocked) worker reaps it.
      .filter((host) => !host.stat.startsWith("Z"))
      .map(({ pid, commandLine }) => ({ pid, commandLine }))
  );
}

/** Blocks synchronously; only for the engine worker. */
function listHostProcesses(): HostProcess[] {
  const [command, args] = process.platform === "win32" ? WINDOWS_LIST : POSIX_LIST;
  const output = execFileSync(command, args, { encoding: "utf8", windowsHide: true, timeout: LIST_TIMEOUT_MS });
  return parseHostProcesses(output);
}

/** Non-blocking variant for the main process. */
async function listHostProcessesAsync(): Promise<HostProcess[]> {
  const [command, args] = process.platform === "win32" ? WINDOWS_LIST : POSIX_LIST;
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: LIST_TIMEOUT_MS,
  });
  return parseHostProcesses(stdout);
}

function stopHostsWithoutOwner(hosts: HostProcess[]): number {
  let stopped = 0;
  const pattern = new RegExp(`${PIPE_PREFIX}(\\d+)-`, "u");
  for (const host of hosts) {
    const owner = Number(pattern.exec(host.commandLine)?.[1]);
    if (!Number.isFinite(host.pid) || !owner || owner === process.pid || isAlive(owner)) continue;
    try {
      process.kill(host.pid);
      stopped += 1;
    } catch (error) {
      console.warn(`[engine] could not stop leftover engine process ${host.pid}`, error);
    }
  }
  return stopped;
}

/**
 * Stops engine hosts left behind by app instances that are no longer running.
 * Blocks synchronously; only call it from the engine worker (the main process
 * uses stopOrphanedHostsAsync).
 */
export function stopOrphanedHosts(): number {
  let hosts: HostProcess[];
  try {
    hosts = listHostProcesses();
  } catch (error) {
    console.warn("[engine] could not check for leftover engine processes", error);
    return 0;
  }
  return stopHostsWithoutOwner(hosts);
}

/** Same as stopOrphanedHosts without blocking the calling thread; for the main process. */
export async function stopOrphanedHostsAsync(): Promise<number> {
  let hosts: HostProcess[];
  try {
    hosts = await listHostProcessesAsync();
  } catch (error) {
    console.warn("[engine] could not check for leftover engine processes", error);
    return 0;
  }
  return stopHostsWithoutOwner(hosts);
}

/**
 * Waits up to `graceMs` for this app's own engine host to exit after
 * disconnecting (it tears itself down first), then stops it if still running.
 * Blocks synchronously; only call it from the engine worker.
 */
export function stopHost(pipe: string, graceMs: number): void {
  // The process list, not isAlive: an exited host stays a zombie of this
  // process until it is reaped, and signal 0 still reports it as alive
  // (listHostProcesses skips zombies).
  const running = () => listHostProcesses().filter((host) => host.commandLine.includes(pipe));
  let hosts: HostProcess[];
  try {
    hosts = running();
    const pause = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + graceMs;
    while (hosts.length > 0 && Date.now() < deadline) {
      Atomics.wait(pause, 0, 0, 100);
      hosts = running();
    }
  } catch (error) {
    console.warn("[engine] could not look up the engine process", error);
    return;
  }
  for (const host of hosts) {
    console.warn(`[engine] engine process ${host.pid} did not exit on its own; stopping it`);
    try {
      process.kill(host.pid);
    } catch (error) {
      console.warn(`[engine] could not stop engine process ${host.pid}`, error);
    }
  }
}
