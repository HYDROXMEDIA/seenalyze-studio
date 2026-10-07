// Loads the prebuilt libobs binding (obs-studio-node) and the macOS preview
// helper from the vendored native folder. Everything else in the app talks to
// libobs only through the engine modules in this folder.

import { createRequire } from "node:module";
import path from "node:path";
import type * as OSNModule from "../../../vendor/obs-studio-node/module";

export type OSN = typeof OSNModule;
export type {
  IAdvancedRecording,
  IAdvancedStreaming,
  IFader,
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

export interface NodeWindowRendering {
  createWindow(name: string, parentHandle: Buffer): void;
  destroyWindow(name: string): void;
  connectIOSurface(name: string, surface: number): void;
  destroyIOSurface(name: string): void;
  moveWindow(name: string, x: number, y: number): void;
}

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
let nwr: NodeWindowRendering | null = null;

export function loadOsn(): OSN {
  if (!osn) osn = nativeRequire(osnRoot()) as OSN;
  return osn;
}

export function loadNwr(): NodeWindowRendering {
  if (process.platform !== "darwin") throw new Error("node-window-rendering is macOS-only");
  if (!nwr) nwr = nativeRequire(path.join(vendorRoot(), "node-window-rendering")) as NodeWindowRendering;
  return nwr;
}
