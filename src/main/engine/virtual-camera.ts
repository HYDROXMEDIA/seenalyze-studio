// Virtual camera output (engine side). The engine's virtual camera needs a
// system component: a camera system extension on macOS, a registered camera
// filter on Windows. Installing it always needs the user's approval, so it is
// only done when the user asks for it.

import { existsSync } from "node:fs";
import path from "node:path";
import type { VirtualCameraProbe } from "../../shared/virtual-camera";
import type { EngineSession } from "./engine";
import { osnRoot } from "./osn";

// VCamOutputType
const SCENE_OUTPUT = 1;
const PROGRAM_VIEW = 3;
// EVcamInstalledStatus
const INSTALLED = 2;

const REQUIRED = ["OBS_service_createVirtualCam", "OBS_service_updateVirtualCam", "OBS_service_startVirtualCam", "OBS_service_stopVirtualCam", "OBS_service_isVirtualCamPluginInstalled"];

/**
 * The macOS engine installs its camera extension through a separate installer
 * app. The extension and that app are not part of the bundled engine, so the
 * camera works only where a compatible extension is already installed.
 */
const MAC_INSTALLER = "slobs-virtual-cam-installer.app";

type NodeObsCalls = Record<string, ((...args: unknown[]) => unknown) | undefined>;

export class VirtualCamera {
  private created = false;
  private running = false;
  private scene: string | null = null;

  constructor(private readonly engine: EngineSession) {}

  private get calls(): NodeObsCalls {
    return this.engine.osn.NodeObs as NodeObsCalls;
  }

  private call(name: string, ...args: unknown[]): unknown {
    const fn = this.calls[name];
    if (typeof fn !== "function") throw new Error("virtual-camera-unavailable");
    return fn(...args);
  }

  get active(): boolean {
    return this.running;
  }

  probe(): VirtualCameraProbe {
    const supported = REQUIRED.every((name) => typeof this.calls[name] === "function") && pluginPresent();
    if (!supported) return { supported: false, installed: false, canInstall: false };
    let installed = false;
    try {
      installed = Number(this.call("OBS_service_isVirtualCamPluginInstalled")) === INSTALLED;
    } catch (error) {
      console.warn("[engine] virtual camera check failed", error);
    }
    return { supported, installed, canInstall: canInstall() };
  }

  /** Runs the system installer; the system asks the user to approve it. */
  install(): VirtualCameraProbe {
    if (!canInstall()) throw new Error("virtual-camera-unavailable");
    this.call("OBS_service_installVirtualCamPlugin");
    return this.probe();
  }

  /** Starts the camera with the program output, or one scene when `scene` is set. */
  start(scene: string | null): void {
    if (this.running) {
      this.setScene(scene);
      return;
    }
    if (!this.probe().installed) throw new Error("virtual-camera-not-installed");
    if (!this.created) {
      this.call("OBS_service_createVirtualCam");
      this.created = true;
    }
    this.applyScene(scene);
    this.call("OBS_service_startVirtualCam");
    this.running = true;
  }

  setScene(scene: string | null): void {
    if (scene === this.scene) return;
    if (!this.created) {
      this.scene = scene;
      return;
    }
    this.applyScene(scene);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.call("OBS_service_stopVirtualCam");
  }

  /** Starts again with the same scene after a stop (canvas changes). */
  restart(): void {
    if (this.running || !this.created) return;
    this.applyScene(this.scene);
    this.call("OBS_service_startVirtualCam");
    this.running = true;
  }

  private applyScene(scene: string | null): void {
    this.scene = scene;
    this.call("OBS_service_updateVirtualCam", scene ? SCENE_OUTPUT : PROGRAM_VIEW, scene ?? "");
  }
}

function pluginPresent(): boolean {
  const root = osnRoot();
  if (process.platform === "darwin") return existsSync(path.join(root, "PlugIns", "mac-virtualcam.plugin"));
  // Windows: the camera output ships with the engine; the install check reports the registered filter.
  return process.platform === "win32";
}

function canInstall(): boolean {
  if (process.platform === "win32") return true;
  if (process.platform !== "darwin") return false;
  const root = osnRoot();
  return [root, path.join(root, "bin")].some((dir) => existsSync(path.join(dir, MAC_INSTALLER)));
}
