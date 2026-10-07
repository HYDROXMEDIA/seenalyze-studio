import path from "node:path";
import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from "electron";
import { IPC, STUDIO_ERROR_PREFIX, STUDIO_METHODS, type StudioMethod } from "../shared/ipc";
import { setVendorRoot } from "./engine/osn";
import { appendLog, installAppLog } from "./log";
import { PREVIEW_EDITOR_HASH, PREVIEW_EDITOR_METHODS, PreviewEditorWindow } from "./preview-editor-window";
import { registerMediaScheme } from "./screen-recording";
import { STUDIO_SCHEME } from "./seenalyze/account";
import { errorKey, Studio, vendorRoot } from "./studio";

installAppLog();

let mainWindow: BrowserWindow | null = null;
let previewEditor: PreviewEditorWindow | null = null;
let studio: Studio | null = null;
let quitting = false;
let shutdownStarted = false;

const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const PRELOAD = path.join(__dirname, "../preload/index.js");

function loadRenderer(window: BrowserWindow, hash?: string): void {
  if (DEV_URL) window.loadURL(hash ? `${DEV_URL}#${hash}` : DEV_URL);
  else window.loadFile(path.join(__dirname, "../renderer/index.html"), hash ? { hash } : undefined);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: "SEENALYZE STUDIO",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#000000" : "#ffffff",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  // The app never navigates away from its own UI and never opens child windows.
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url).catch((error: unknown) => console.error(error));
    return { action: "deny" };
  });

  // Renderer errors go to the app log; a broken screen otherwise leaves no trace.
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") appendLog("error", `[renderer] ${event.message}`);
  });
  if (DEV_URL) {
    // Surface renderer logs in the terminal during development.
    window.webContents.on("console-message", (event) => console.log(`[renderer] ${event.message}`));
  }
  loadRenderer(window);
  return window;
}

function isAppUrl(url: string): boolean {
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url.startsWith("file://");
}

function registerIpc(): void {
  const allowed = new Set<string>(STUDIO_METHODS);
  ipcMain.handle(IPC.invoke, async (event, method: unknown, args: unknown) => {
    const fromMain = Boolean(mainWindow && event.sender === mainWindow.webContents);
    // The macOS preview editor window may only read state and edit the selection/transforms.
    const fromEditor = Boolean(previewEditor && event.sender === previewEditor.webContents);
    if ((!fromMain && !fromEditor) || !isAppUrl(event.senderFrame?.url ?? "")) {
      throw new Error(`${STUDIO_ERROR_PREFIX}forbidden`);
    }
    if (typeof method !== "string" || !allowed.has(method) || !Array.isArray(args)) {
      throw new Error(`${STUDIO_ERROR_PREFIX}invalid-request`);
    }
    if (fromEditor && !PREVIEW_EDITOR_METHODS.has(method)) {
      throw new Error(`${STUDIO_ERROR_PREFIX}forbidden`);
    }
    if (!studio) throw new Error(`${STUDIO_ERROR_PREFIX}engine-not-ready`);
    const handler = studio.api[method as StudioMethod] as (...params: unknown[]) => Promise<unknown>;
    try {
      return await handler(...args);
    } catch (error) {
      console.error(`[ipc] ${method} failed`, error);
      throw new Error(`${STUDIO_ERROR_PREFIX}${errorKey(error)}`, { cause: error });
    }
  });
}

function lockDownPermissions(): void {
  // Capture devices are opened by the engine, never by the studio UI. The
  // screen-recording picker, camera bubble and built-in recorder are the only
  // pages that may use the camera, microphone or screen directly.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media" && studio?.screenRecorder.allowsMedia(webContents) === true);
  });
}

// The recording editor reads its videos through a private scheme.
registerMediaScheme();

// One app instance: a second launch focuses the existing window instead.
// App links (seenalyze-studio://…) bring account sign-in back from the browser.
// In development the Electron binary needs the app path to relaunch correctly.
if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(STUDIO_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient(STUDIO_SCHEME);

const pendingLinks: string[] = [];
function handleAppLink(link: string): void {
  if (!studio) {
    pendingLinks.push(link);
    return;
  }
  studio.account.handleCallback(link);
}

// macOS delivers links through open-url (also before the app is ready).
app.on("open-url", (event, link) => {
  event.preventDefault();
  handleAppLink(link);
});

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  // Windows/Linux pass the link as an argument when it starts the app.
  const launchLink = process.argv.find((arg) => arg.startsWith(`${STUDIO_SCHEME}://`));
  if (launchLink) pendingLinks.push(launchLink);
  // Windows delivers links as an argument to a second launch.
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith(`${STUDIO_SCHEME}://`));
    if (link) handleAppLink(link);
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (!hasInstanceLock) return;
  setVendorRoot(vendorRoot());
  lockDownPermissions();
  registerIpc();
  mainWindow = createWindow();
  if (process.platform === "darwin") {
    previewEditor = new PreviewEditorWindow(mainWindow, {
      preload: PRELOAD,
      load: (window) => {
        window.webContents.on("console-message", (event) => {
          if (event.level === "error") appendLog("error", `[preview-editor] ${event.message}`);
        });
        loadRenderer(window, PREVIEW_EDITOR_HASH);
      },
    });
  }
  studio = new Studio(
    mainWindow,
    () => {
      quitting = true;
      app.quit();
    },
    previewEditor,
  );
  mainWindow.webContents.once("did-finish-load", () => void studio?.start());
  for (const link of pendingLinks.splice(0)) handleAppLink(link);

  mainWindow.on("close", (event) => {
    appendLog("info", `window close requested (quitting=${quitting}, busy=${studio?.busy ?? false})`);
    if (quitting || !studio?.busy) return;
    event.preventDefault();
    studio.requestQuitConfirmation();
  });
  // Recording editors may still be open; the studio window going away ends the app.
  mainWindow.on("closed", () => app.quit());
});

app.on("before-quit", (event) => {
  if (!quitting && studio?.busy) {
    event.preventDefault();
    studio.requestQuitConfirmation();
    return;
  }
  quitting = true;
  if (!studio || shutdownStarted) return;
  // Engine teardown is asynchronous; finish it (bounded) before exiting.
  event.preventDefault();
  shutdownStarted = true;
  const current = studio;
  studio = null;
  current
    .shutdown()
    .catch((error: unknown) => console.error("[app] shutdown failed", error))
    .finally(() => app.exit(0));
});

app.on("window-all-closed", () => {
  app.quit();
});
