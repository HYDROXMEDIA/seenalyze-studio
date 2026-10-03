// Camera, microphone and screen-recording access. The engine opens devices in
// its own processes, but the OS attributes those processes to this app, so the
// app itself requests access before a capture source is created.

import { desktopCapturer, shell, systemPreferences } from "electron";
import type { PermissionKind, PermissionState } from "../shared/types";

const IS_MAC = process.platform === "darwin";
const IS_WINDOWS = process.platform === "win32";

const MAC_SETTINGS: Record<PermissionKind, string> = {
  camera: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

const WINDOWS_SETTINGS: Partial<Record<PermissionKind, string>> = {
  camera: "ms-settings:privacy-webcam",
  microphone: "ms-settings:privacy-microphone",
};

function normalize(status: string): PermissionState {
  switch (status) {
    case "granted":
    case "denied":
    case "not-determined":
    case "restricted":
      return status;
    default:
      return "not-determined";
  }
}

export function permissionStatus(kind: PermissionKind): PermissionState {
  if (IS_MAC) return normalize(systemPreferences.getMediaAccessStatus(kind));
  // Windows has per-app privacy switches for camera and microphone only;
  // screen capture needs no permission there.
  if (IS_WINDOWS && kind !== "screen") return normalize(systemPreferences.getMediaAccessStatus(kind));
  return "unsupported";
}

export function permissionSnapshot(): Record<PermissionKind, PermissionState> {
  return {
    camera: permissionStatus("camera"),
    microphone: permissionStatus("microphone"),
    screen: permissionStatus("screen"),
  };
}

/** Shows the system prompt when the OS allows it, then returns the resulting state. */
export async function requestPermission(kind: PermissionKind): Promise<PermissionState> {
  const current = permissionStatus(kind);
  if (current === "granted" || current === "unsupported" || !IS_MAC) return current;

  if (kind === "camera" || kind === "microphone") {
    if (current === "not-determined") await systemPreferences.askForMediaAccess(kind);
    return permissionStatus(kind);
  }

  // Screen recording has no request API; asking for capture sources makes
  // macOS show its prompt the first time and register the app in Settings.
  try {
    await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
  } catch (error) {
    console.warn("[permissions] screen capture request failed", error);
  }
  return permissionStatus("screen");
}

export async function openPermissionSettings(kind: PermissionKind): Promise<void> {
  const url = IS_MAC ? MAC_SETTINGS[kind] : IS_WINDOWS ? WINDOWS_SETTINGS[kind] : undefined;
  if (url) await shell.openExternal(url);
}
