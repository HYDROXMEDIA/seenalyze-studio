// Loads the prebuilt libobs binding (obs-studio-node) from the vendored native
// folder. Everything else in the app talks to libobs only through the engine
// modules in this folder.

import { createRequire } from "node:module";
import path from "node:path";
import type * as OSNModule from "../../../vendor/obs-studio-node/module";

export type OSN = typeof OSNModule;
export type {
  IAdvancedRecording,
  IAdvancedReplayBuffer,
  IAdvancedStreaming,
  IFader,
  IFilter,
  IInput,
  IProperties,
  IProperty,
  IScene,
  ISceneItem,
  ITransition,
  IVideo,
  IVideoEncoder,
  IVolmeter,
  EOutputSignal,
} from "../../../vendor/obs-studio-node/module";

// The main bundle is CommonJS, so __filename is defined at runtime.
const nativeRequire = createRequire(__filename);

let configuredVendorRoot: string | null = null;

/** Set once per process: the main process and the engine worker resolve it differently. */
export function setVendorRoot(root: string): void {
  configuredVendorRoot = root;
}

export function vendorRoot(): string {
  if (!configuredVendorRoot) throw new Error("engine-not-ready");
  return configuredVendorRoot;
}

export function osnRoot(): string {
  return path.join(vendorRoot(), "obs-studio-node");
}

let osn: OSN | null = null;

export function loadOsn(): OSN {
  if (!osn) osn = nativeRequire(osnRoot()) as OSN;
  return osn;
}
