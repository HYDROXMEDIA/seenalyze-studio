// Maps the user's "Performance ↔ Quality" choice to each engine encoder's own
// speed preset setting. "balanced" sends nothing, so the encoder keeps its
// default (what every stream used before the setting existed). Encoders
// without a speed preset (Apple VideoToolbox) ignore the choice.

import type { EncoderPreset } from "./types";

const PRESET_SETTINGS: Record<string, { key: string; performance: string; quality: string }> = {
  x264: { key: "preset", performance: "superfast", quality: "faster" },
  // The engine's "nvenc" is obs_nvenc_h264_tex, which reads "preset" (p1–p7);
  // "preset2" is only the legacy key it migrates from for older encoder ids.
  nvenc: { key: "preset", performance: "p2", quality: "p7" },
  amd: { key: "preset", performance: "speed", quality: "quality" },
  qsv: { key: "target_usage", performance: "TU7", quality: "TU1" },
};

export function supportsEncoderPreset(encoderId: string): boolean {
  return Object.hasOwn(PRESET_SETTINGS, encoderId);
}

/** Encoder settings for a preset; empty for "balanced" or encoders without presets. */
export function encoderPresetSettings(encoderId: string, preset: EncoderPreset | undefined): Record<string, string> {
  const entry = Object.hasOwn(PRESET_SETTINGS, encoderId) ? PRESET_SETTINGS[encoderId] : undefined;
  if (!entry || !preset || preset === "balanced") return {};
  return { [entry.key]: entry[preset] };
}
