// Reads a video file's length through the engine's media decoder, for the
// stinger transition picker. One private media source is reused for every
// probe and kept until engine shutdown (teardown rules: no early release).

import type { IInput, OSN } from "./osn";

const MEDIA_INPUT = "ffmpeg_source";
const WAIT_STEP_MS = 50;
const WAIT_LIMIT_MS = 1500;

export class MediaProbe {
  private input: IInput | null = null;

  constructor(private readonly osn: OSN) {}

  /** Length in milliseconds, or 0 when the engine cannot tell. */
  durationMs(file: string): number {
    if (!this.osn.InputFactory.types().includes(MEDIA_INPUT)) return 0;
    const settings = { local_file: file, is_local_file: true, looping: false, restart_on_activate: false, close_when_inactive: false, hw_decode: false };
    if (!this.input) this.input = this.osn.InputFactory.createPrivate(MEDIA_INPUT, "seenalyze-media-probe", settings);
    else this.input.update(settings);
    const input = this.input;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    let duration = 0;
    try {
      // The decoder opens the file in the background; its length appears shortly after.
      for (let waited = 0; waited <= WAIT_LIMIT_MS; waited += WAIT_STEP_MS) {
        duration = Number(input.getDuration());
        if (Number.isFinite(duration) && duration > 0) break;
        Atomics.wait(pause, 0, 0, WAIT_STEP_MS);
      }
    } finally {
      // Close the file again.
      input.update({ local_file: "" });
    }
    return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
  }
}
