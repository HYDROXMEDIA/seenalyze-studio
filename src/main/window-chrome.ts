import type { BrowserWindow } from "electron";
import { FULL_SCREEN_TITLE_BAR_CSS } from "../shared/window-chrome";

/**
 * macOS hides the window buttons in full screen, so the title bar gives their
 * room back (`--traffic-light-reserve: 0`) until the window leaves full screen.
 * A reload drops inserted styles, so the state is applied again after each load.
 */
export function releaseTrafficLightRoomInFullScreen(window: BrowserWindow): void {
  if (process.platform !== "darwin") return;
  const contents = window.webContents;
  let inserted: string | null = null;
  // Inserting and removing are asynchronous; running them in order keeps the last state.
  let queue: Promise<void> = Promise.resolve();
  const sync = () => {
    queue = queue
      .then(async () => {
        if (window.isDestroyed() || contents.isDestroyed()) return;
        const fullScreen = window.isFullScreen();
        if (fullScreen && inserted === null) inserted = await contents.insertCSS(FULL_SCREEN_TITLE_BAR_CSS);
        else if (!fullScreen && inserted !== null) {
          const key = inserted;
          inserted = null;
          await contents.removeInsertedCSS(key);
        }
      })
      .catch((error: unknown) => {
        // The title bar keeps its previous spacing; nothing else depends on it.
        console.error(`[window] full-screen title bar spacing could not be updated: ${error instanceof Error ? error.message : String(error)}`);
      });
  };
  window.on("enter-full-screen", sync);
  window.on("leave-full-screen", sync);
  contents.on("did-finish-load", () => {
    inserted = null;
    sync();
  });
}
