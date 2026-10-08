// Engine values for the advanced output formats (shared/formats.ts): libobs
// enum numbers for the video context and the audio context setup.

import { DEFAULT_AUDIO_FORMAT, frameRateOf, SPEAKER_LAYOUTS, type AudioFormat, type ColorFormat, type ColorRange, type ColorSpace, type SpeakerLayout } from "../../shared/formats";
import type { VideoSettings } from "../../shared/types";
import type { OSN } from "./osn";

// libobs enum values (const enums cannot be imported across isolated modules).
const VIDEO_FORMATS: Record<ColorFormat, number> = { i420: 1, nv12: 2, i444: 10 };
const COLOR_SPACES: Record<ColorSpace, number> = { "601": 1, "709": 2, srgb: 3 };
const COLOR_RANGES: Record<ColorRange, number> = { partial: 1, full: 2 };
const SPEAKERS: Record<SpeakerLayout, number> = { mono: 1, stereo: 2, "2.1": 3, "4.0": 4, "4.1": 5, "5.1": 6, "7.1": 8 };

/** Frame rate and color fields of the engine's video info for these settings. */
export function videoFormatInfo(settings: VideoSettings): { fpsNum: number; fpsDen: number; outputFormat: number; colorspace: number; range: number } {
  const rate = frameRateOf(settings);
  return {
    fpsNum: rate.num,
    fpsDen: rate.den,
    outputFormat: VIDEO_FORMATS[settings.colorFormat ?? "nv12"] ?? VIDEO_FORMATS.nv12,
    colorspace: COLOR_SPACES[settings.colorSpace ?? "709"] ?? COLOR_SPACES["709"],
    range: COLOR_RANGES[settings.colorRange ?? "partial"] ?? COLOR_RANGES.partial,
  };
}

/** Sets the audio context. Only valid before any source exists (engine start). */
export function applyAudioFormat(osn: OSN, format: AudioFormat): void {
  osn.AudioFactory.audioContext = { sampleRate: format.sampleRate, speakers: SPEAKERS[format.speakers] } as typeof osn.AudioFactory.audioContext;
}

/** The audio format the engine runs with. */
export function readAudioFormat(osn: OSN): AudioFormat {
  try {
    const context = osn.AudioFactory.audioContext;
    const rate = Number(context?.sampleRate);
    const speakers = SPEAKER_LAYOUTS.find((layout) => SPEAKERS[layout] === Number(context?.speakers));
    return {
      sampleRate: rate === 44100 ? 44100 : rate === 48000 ? 48000 : DEFAULT_AUDIO_FORMAT.sampleRate,
      speakers: speakers ?? DEFAULT_AUDIO_FORMAT.speakers,
    };
  } catch (error) {
    console.warn("[engine] could not read the audio format", error);
    return { ...DEFAULT_AUDIO_FORMAT };
  }
}
