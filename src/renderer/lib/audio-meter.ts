// Mixer math shared by the meters and the fader readout. Both use the IEC
// 60268-18 scale (the one OBS uses): quiet sounds stay low and only
// near-clipping levels fill the bar.

export const MIN_DB = -60;

/** Bar position (0..1) for a level in dBFS. */
export function meterDeflection(db: number): number {
  if (db >= 0) return 1;
  if (db >= -9) return ((db + 9) / 9) * 0.25 + 0.75;
  if (db >= -20) return ((db + 20) / 11) * 0.15 + 0.6;
  if (db >= -30) return ((db + 30) / 10) * 0.2 + 0.4;
  if (db >= -40) return ((db + 40) / 10) * 0.15 + 0.25;
  if (db >= -50) return ((db + 50) / 10) * 0.075 + 0.175;
  if (db >= MIN_DB) return ((db - MIN_DB) / 10) * 0.05 + 0.125;
  return 0;
}

/**
 * Gain in dB for a fader position (0..1), the inverse of the engine's IEC
 * fader curve. The bottom of the fader is silence (-Infinity).
 */
export function deflectionToDb(deflection: number): number {
  if (!Number.isFinite(deflection) || deflection <= 0) return Number.NEGATIVE_INFINITY;
  if (deflection >= 1) return 0;
  if (deflection >= 0.75) return ((deflection - 1) / 0.25) * 9;
  if (deflection >= 0.6) return ((deflection - 0.75) / 0.15) * 11 - 9;
  if (deflection >= 0.4) return ((deflection - 0.6) / 0.2) * 10 - 20;
  if (deflection >= 0.25) return ((deflection - 0.4) / 0.15) * 10 - 30;
  if (deflection >= 0.175) return ((deflection - 0.25) / 0.075) * 10 - 40;
  if (deflection >= 0.125) return ((deflection - 0.175) / 0.05) * 10 - 50;
  if (deflection >= 0.075) return ((deflection - 0.125) / 0.05) * 10 - 60;
  return (deflection / 0.075) * 20 - 90;
}

/** Fader gain as shown next to the slider, e.g. "-6.2 dB" or "-∞ dB". */
export function formatDb(db: number): string {
  if (!Number.isFinite(db)) return "-∞ dB";
  const rounded = Math.round(db * 10) / 10;
  return `${rounded === 0 ? "0.0" : rounded.toFixed(1)} dB`;
}

/** Up to two meter channels (left/right); mono and empty reports give one. */
export function meterChannels(peak: number[] | undefined): number[] {
  const values = (peak ?? []).map((value) => (Number.isFinite(value) ? value : MIN_DB));
  if (values.length === 0) return [MIN_DB];
  return values.slice(0, 2);
}
