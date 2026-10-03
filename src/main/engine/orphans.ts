// The libobs host process outlives the app if the app is force-killed. Each
// host is started with a pipe name that embeds the owning app's PID, so on
// startup we stop any host whose owner is no longer running.

import { execFileSync } from "node:child_process";

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

function listHostProcesses(): { pid: number; commandLine: string }[] {
  if (process.platform === "win32") {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='obs64.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10_000 },
    );
    return output
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        const [pid, ...rest] = line.split("\t");
        return { pid: Number(pid), commandLine: rest.join("\t") };
      });
  }
  const output = execFileSync("ps", ["-A", "-o", "pid=,command="], { encoding: "utf8", timeout: 10_000 });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(`obs64 ${PIPE_PREFIX}`))
    .map((line) => {
      const [pid, ...rest] = line.split(/\s+/u);
      return { pid: Number(pid), commandLine: rest.join(" ") };
    });
}

/** Stops engine hosts left behind by app instances that are no longer running. */
export function stopOrphanedHosts(): number {
  let stopped = 0;
  let hosts: { pid: number; commandLine: string }[];
  try {
    hosts = listHostProcesses();
  } catch (error) {
    console.warn("[engine] could not check for leftover engine processes", error);
    return 0;
  }
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

/** Stops this app's own engine host after teardown, if it is still running. */
export function stopHost(pipe: string): void {
  let hosts: { pid: number; commandLine: string }[];
  try {
    hosts = listHostProcesses();
  } catch (error) {
    console.warn("[engine] could not look up the engine process", error);
    return;
  }
  for (const host of hosts) {
    if (!host.commandLine.includes(pipe)) continue;
    try {
      process.kill(host.pid);
    } catch (error) {
      console.warn(`[engine] could not stop engine process ${host.pid}`, error);
    }
  }
}
