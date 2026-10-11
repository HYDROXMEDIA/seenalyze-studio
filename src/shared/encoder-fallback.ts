// When a graphics-card encoder is listed but cannot run on this machine (old
// driver, card busy or in use elsewhere), streams and recordings move to the
// software encoder instead of failing.

import type { EncoderOption } from "./types";

/**
 * The software encoder to switch to when `current` is a graphics-card encoder
 * that failed; null when `current` is already software, unknown, or no
 * software encoder is available (the failure is then shown as is).
 */
export function softwareFallback(encoders: readonly EncoderOption[], current: string | null | undefined): string | null {
  const active = encoders.find((encoder) => encoder.id === current);
  if (!active?.hardware) return null;
  return encoders.find((encoder) => !encoder.hardware)?.id ?? null;
}
