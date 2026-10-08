import type { ProjectorApi } from "../../shared/projector";

declare global {
  interface Window {
    /** Only in projector windows (src/preload/projector.ts). */
    projector?: ProjectorApi;
  }
}

/** The projector bridge; projector pages only. */
export function projectorApi(): ProjectorApi {
  if (!window.projector) throw new Error("projector bridge missing");
  return window.projector;
}
