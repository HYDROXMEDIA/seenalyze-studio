// Virtual camera: lets video-call and other camera apps use the studio output.
// No Electron/Node imports: the renderer uses this too.

/**
 * - unknown: not checked yet.
 * - unsupported: the engine has no virtual camera on this system.
 * - missing: the system camera component is not installed and this app cannot install it.
 * - installable: a one-time install (with the system's approval) is needed.
 * - ready: the camera can start.
 */
export type VirtualCameraAvailability = "unknown" | "unsupported" | "missing" | "installable" | "ready";

export interface VirtualCameraStatus {
  availability: VirtualCameraAvailability;
  active: boolean;
  /** Scene sent to the camera; null sends the program output. */
  scene: string | null;
}

/** What the engine reports about the camera component. */
export interface VirtualCameraProbe {
  /** The engine exposes a virtual camera output on this platform. */
  supported: boolean;
  /** The system camera component is installed. */
  installed: boolean;
  /** This app can install the component (the system still asks for approval). */
  canInstall: boolean;
}

export function virtualCameraAvailability(probe: VirtualCameraProbe | null): VirtualCameraAvailability {
  if (!probe) return "unknown";
  if (!probe.supported) return "unsupported";
  if (probe.installed) return "ready";
  return probe.canInstall ? "installable" : "missing";
}

/** Keeps a saved scene choice only when it still names a scene; otherwise the program output. */
export function virtualCameraScene(value: unknown, scenes: readonly string[]): string | null {
  return typeof value === "string" && scenes.includes(value) ? value : null;
}
