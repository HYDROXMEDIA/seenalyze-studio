import { STUDIO_ERROR_PREFIX, type StudioApi } from "../../shared/ipc";

declare global {
  interface Window {
    studio: StudioApi;
    platform: string;
  }
}

export const studio: StudioApi = window.studio;
export const isMac = window.platform === "darwin";

/**
 * Converts an error thrown across IPC into a translation key under `errors.codes`.
 * Electron wraps the message, so the code is extracted after the known prefix.
 */
export function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const index = message.indexOf(STUDIO_ERROR_PREFIX);
  return index >= 0 ? message.slice(index + STUDIO_ERROR_PREFIX.length).trim() : "generic";
}
