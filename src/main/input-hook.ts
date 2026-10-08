// The system-wide input hook is one shared native listener. Screen recording
// (click timing) and held hotkeys (push-to-talk) both use it, so it starts with
// the first user and stops after the last one; one user stopping never cuts
// off the other.

import { uIOhook } from "uiohook-napi";

let users = 0;

/** Starts the hook for one more user. Throws when the OS denies input access. */
export function acquireInputHook(): void {
  if (users === 0) uIOhook.start();
  users += 1;
}

export function releaseInputHook(): void {
  if (users === 0) return;
  users -= 1;
  if (users === 0) uIOhook.stop();
}

export { uIOhook };
