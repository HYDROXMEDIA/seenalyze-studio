// Audio mixer: one fader (volume) and one volume meter per audio source.

import type { AudioLevel, AudioSourceDTO } from "../../shared/types";
import type { IFader, IInput, IVolmeter, OSN } from "./osn";
import type { SceneGraph } from "./scenes";

const FADER_IEC = 1;

interface VolmeterReport {
  sourceName?: string;
  peak?: number[];
}

export class AudioMixer {
  private readonly faders = new Map<string, IFader>();
  private readonly meters = new Map<string, IVolmeter>();
  private readonly attached = new Map<string, IInput>();
  private levels = new Map<string, number[]>();
  private callbackRegistered = false;

  constructor(
    private readonly osn: OSN,
    private readonly scenes: SceneGraph,
  ) {}

  /** Re-attaches faders/meters so they match the current set of audio sources. */
  sync(): void {
    const current = new Map(this.scenes.audioInputs().map(({ name, input }) => [name, input]));
    for (const [name, input] of this.attached) {
      if (current.get(name) === input) continue;
      this.detach(name);
    }
    for (const [name, input] of current) {
      if (this.attached.has(name)) continue;
      const fader = this.osn.FaderFactory.create(FADER_IEC);
      fader.attach(input);
      const restored = this.scenes.takePendingVolume(name);
      if (restored !== undefined) fader.deflection = Math.min(1, Math.max(0, restored));
      const meter = this.osn.VolmeterFactory.create(FADER_IEC);
      meter.attach(input);
      this.faders.set(name, fader);
      this.meters.set(name, meter);
      this.attached.set(name, input);
    }
    if (!this.callbackRegistered && this.attached.size > 0) {
      this.osn.NodeObs.RegisterVolmeterCallback((reports: VolmeterReport[]) => {
        for (const report of reports) {
          if (report.sourceName && Array.isArray(report.peak)) {
            this.levels.set(this.scenes.nameOf({ name: report.sourceName }), report.peak);
          }
        }
      });
      this.callbackRegistered = true;
    }
  }

  list(): AudioSourceDTO[] {
    return this.scenes.audioInputs().map(({ name, input, global }) => ({
      name,
      deflection: this.faders.get(name)?.deflection ?? 1,
      muted: input.muted,
      global,
    }));
  }

  /** Moves fader/meter bookkeeping to a source's new name so its volume is kept. */
  rename(name: string, nextName: string): void {
    if (!nextName || name === nextName) return;
    for (const map of [this.faders, this.meters, this.attached] as Map<string, unknown>[]) {
      const value = map.get(name);
      if (value === undefined) continue;
      map.delete(name);
      map.set(nextName, value);
    }
    this.levels.delete(name);
  }

  volumeOf(name: string): number | undefined {
    return this.faders.get(name)?.deflection;
  }

  setVolume(name: string, deflection: number): void {
    const fader = this.faders.get(name);
    if (!fader) throw new Error("source-not-found");
    fader.deflection = Math.min(1, Math.max(0, deflection));
  }

  setMuted(name: string, muted: boolean): void {
    this.scenes.input(name).muted = muted;
  }

  /** Latest peak levels since the previous call. */
  drainLevels(): AudioLevel[] {
    const result = [...this.levels.entries()].map(([name, peak]) => ({ name, peak }));
    this.levels = new Map();
    return result;
  }


  private detach(name: string): void {
    this.faders.get(name)?.detach();
    this.faders.get(name)?.destroy();
    this.meters.get(name)?.detach();
    this.meters.get(name)?.destroy();
    this.faders.delete(name);
    this.meters.delete(name);
    this.attached.delete(name);
    this.levels.delete(name);
  }
}
