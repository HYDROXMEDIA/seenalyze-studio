// Advanced output formats (Settings › Video/Audio › Advanced): fractional
// frame rates, color format/space/range, audio sample rate and speaker
// layout, and which audio tracks a recording keeps. Pure data and validation;
// absent values keep the engine defaults (integer FPS, NV12, Rec. 709,
// limited range), so existing setups are unchanged.

/**
 * Color formats offered. 10-bit formats (P010) and HDR color spaces need a
 * HEVC/AV1 encoder; outputs here are H.264, so they are not offered.
 */
export const COLOR_FORMATS = ["nv12", "i420", "i444"] as const;
export type ColorFormat = (typeof COLOR_FORMATS)[number];

export const COLOR_SPACES = ["709", "601", "srgb"] as const;
export type ColorSpace = (typeof COLOR_SPACES)[number];

export const COLOR_RANGES = ["partial", "full"] as const;
export type ColorRange = (typeof COLOR_RANGES)[number];

export const DEFAULT_COLOR = { colorFormat: "nv12", colorSpace: "709", colorRange: "partial" } as const satisfies {
  colorFormat: ColorFormat;
  colorSpace: ColorSpace;
  colorRange: ColorRange;
};

/** Hardware encoders take 4:2:0 input only; full-chroma 4:4:4 needs the software encoder. */
export function colorFormatsFor(encoderId: string): ColorFormat[] {
  return encoderId === "x264" ? [...COLOR_FORMATS] : COLOR_FORMATS.filter((format) => format !== "i444");
}

export interface FrameRate {
  num: number;
  den: number;
}

/** Frame rates offered in the picker, as exact fractions. */
export const FRAME_RATE_PRESETS: readonly FrameRate[] = [
  { num: 24000, den: 1001 },
  { num: 24, den: 1 },
  { num: 25, den: 1 },
  { num: 30000, den: 1001 },
  { num: 30, den: 1 },
  { num: 48, den: 1 },
  { num: 50, den: 1 },
  { num: 60000, den: 1001 },
  { num: 60, den: 1 },
];

export const FRAME_RATE_LIMITS = { min: 1, max: 240, maxTerm: 1_000_000 } as const;

function isWhole(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** A valid fraction within the supported rate range, or null. */
export function validFrameRate(num: unknown, den: unknown): FrameRate | null {
  if (!isWhole(num, 1, FRAME_RATE_LIMITS.maxTerm) || !isWhole(den, 1, FRAME_RATE_LIMITS.maxTerm)) return null;
  const rate = num / den;
  if (rate < FRAME_RATE_LIMITS.min || rate > FRAME_RATE_LIMITS.max) return null;
  return { num, den };
}

/**
 * Reads a frame rate typed by the user: "30", "29.97", "59.94", "30000/1001".
 * NTSC decimals (x.97, x.94, 23.976) map to their exact x000/1001 fraction.
 */
export function parseFrameRate(input: string): FrameRate | null {
  const text = input.trim().replace(",", ".");
  const fraction = /^(\d+)\s*\/\s*(\d+)$/u.exec(text);
  if (fraction) return validFrameRate(Number(fraction[1]), Number(fraction[2]));
  if (!/^\d+(\.\d+)?$/u.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return validFrameRate(value, 1);
  // A rate just under a whole number is the 1000/1001 variant of it.
  const whole = Math.round(value);
  const ntsc = (whole * 1000) / 1001;
  if (Math.abs(value - ntsc) < 0.01) return validFrameRate(whole * 1000, 1001);
  // Other decimals become an exact fraction over a power of ten.
  const decimals = text.split(".")[1]?.length ?? 0;
  const den = 10 ** Math.min(decimals, 3);
  const num = Math.round(value * den);
  const divisor = gcd(num, den);
  return validFrameRate(num / divisor, den / divisor);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** "29.97", "60", "23.976": the rate as people write it. */
export function formatFrameRate(rate: FrameRate): string {
  const value = rate.num / rate.den;
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}

/** The video fields that carry advanced formats (all optional on VideoSettings). */
export interface VideoFormatFields {
  fps: number;
  fpsNum?: number;
  fpsDen?: number;
  colorFormat?: ColorFormat;
  colorSpace?: ColorSpace;
  colorRange?: ColorRange;
}

/** The exact frame rate of video settings: the fraction when set, else the whole `fps`. */
export function frameRateOf(video: Pick<VideoFormatFields, "fps" | "fpsNum" | "fpsDen">): FrameRate {
  return validFrameRate(video.fpsNum, video.fpsDen) ?? { num: video.fps, den: 1 };
}

/**
 * Validated frame rate and advanced fields. A whole-number fraction collapses to `fps`, and
 * default color values are dropped, so a default setup stores nothing new.
 * `fps` is the rounded rate (used for bitrate guidance and encoder grouping).
 */
export function sanitizeVideoFormat(value: Partial<Record<keyof VideoFormatFields, unknown>>, fallbackFps: number): VideoFormatFields {
  // A custom whole rate (e.g. 120) is kept; anything else uses the caller's fallback.
  const result: VideoFormatFields = { fps: isWhole(value.fps, FRAME_RATE_LIMITS.min, FRAME_RATE_LIMITS.max) ? value.fps : fallbackFps };
  const rate = validFrameRate(value.fpsNum, value.fpsDen);
  if (rate) {
    const divisor = gcd(rate.num, rate.den);
    const num = rate.num / divisor;
    const den = rate.den / divisor;
    result.fps = Math.max(1, Math.round(num / den));
    if (den !== 1) {
      result.fpsNum = num;
      result.fpsDen = den;
    }
  }
  if ((COLOR_FORMATS as readonly unknown[]).includes(value.colorFormat) && value.colorFormat !== DEFAULT_COLOR.colorFormat) result.colorFormat = value.colorFormat as ColorFormat;
  if ((COLOR_SPACES as readonly unknown[]).includes(value.colorSpace) && value.colorSpace !== DEFAULT_COLOR.colorSpace) result.colorSpace = value.colorSpace as ColorSpace;
  if ((COLOR_RANGES as readonly unknown[]).includes(value.colorRange) && value.colorRange !== DEFAULT_COLOR.colorRange) result.colorRange = value.colorRange as ColorRange;
  return result;
}

// ----- audio -------------------------------------------------------------------

export const SAMPLE_RATES = [48000, 44100] as const;
export type SampleRate = (typeof SAMPLE_RATES)[number];

export const SPEAKER_LAYOUTS = ["mono", "stereo", "2.1", "4.0", "4.1", "5.1", "7.1"] as const;
export type SpeakerLayout = (typeof SPEAKER_LAYOUTS)[number];

export interface AudioFormat {
  sampleRate: SampleRate;
  speakers: SpeakerLayout;
}

export const DEFAULT_AUDIO_FORMAT: AudioFormat = { sampleRate: 48000, speakers: "stereo" };

/** A valid audio format, or null when the value is not one. */
export function sanitizeAudioFormat(value: unknown): AudioFormat | null {
  if (typeof value !== "object" || value === null) return null;
  const { sampleRate, speakers } = value as Record<string, unknown>;
  if (!(SAMPLE_RATES as readonly unknown[]).includes(sampleRate) || !(SPEAKER_LAYOUTS as readonly unknown[]).includes(speakers)) return null;
  return { sampleRate: sampleRate as SampleRate, speakers: speakers as SpeakerLayout };
}

// ----- audio tracks --------------------------------------------------------------

/** libobs mixes up to six audio tracks; track 1 is the one streams use. */
export const AUDIO_TRACK_COUNT = 6;
export const ALL_TRACKS = (1 << AUDIO_TRACK_COUNT) - 1;
/** Recordings keep track 1 only unless the user picks more. */
export const DEFAULT_RECORDING_TRACKS = 1;

/** Track numbers (1-based) contained in a bitmask. */
export function tracksOf(mask: number): number[] {
  return Array.from({ length: AUDIO_TRACK_COUNT }, (_, index) => index + 1).filter((track) => (mask & (1 << (track - 1))) !== 0);
}

export function toggleTrack(mask: number, track: number, on: boolean): number {
  if (!Number.isInteger(track) || track < 1 || track > AUDIO_TRACK_COUNT) return mask;
  const bit = 1 << (track - 1);
  return on ? mask | bit : mask & ~bit;
}

/** Tracks a recording keeps: at least one, only the six that exist. */
export function sanitizeRecordingTracks(value: unknown): number {
  const mask = typeof value === "number" && Number.isInteger(value) ? value & ALL_TRACKS : 0;
  return mask === 0 ? DEFAULT_RECORDING_TRACKS : mask;
}

/** Tracks a source plays into; a source may be left out of every track. Undefined = all. */
export function sanitizeSourceTracks(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  const mask = value & ALL_TRACKS;
  return mask === ALL_TRACKS ? undefined : mask;
}
