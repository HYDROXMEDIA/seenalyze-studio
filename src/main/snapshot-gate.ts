/**
 * Drops snapshot pushes identical to the last one sent. While live the engine
 * reports stats every second and each report schedules a push; IPC
 * structured-clones the whole snapshot and the renderer re-renders, so an
 * unchanged tick should send nothing. Comparing one serialised string is far
 * cheaper than the clone plus render it avoids.
 */
export class SnapshotGate {
  private last: string | null = null;

  /** True when `snapshot` differs from the last one let through (and records it). */
  changed(snapshot: unknown): boolean {
    const serialised = JSON.stringify(snapshot);
    if (serialised === this.last) return false;
    this.last = serialised;
    return true;
  }

  /** The next snapshot goes out even if unchanged (a receiver reloaded and lost its copy). */
  reset(): void {
    this.last = null;
  }
}
