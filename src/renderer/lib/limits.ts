// Limits the main process enforces on values from the window. Checking them
// here first keeps an out-of-range value from becoming a generic
// "invalid request" error, and lets the form say what is wrong.

import type { BroadcastInfo } from "../../shared/types";

export type BroadcastPrivacy = NonNullable<BroadcastInfo["privacy"]>;
export const BROADCAST_PRIVACY: readonly BroadcastPrivacy[] = ["public", "unlisted", "private"];

/** The privacy the form shows and sends: anything unknown (an older or damaged save) reads as public. */
export function broadcastPrivacy(value: unknown): BroadcastPrivacy {
  return BROADCAST_PRIVACY.find((privacy) => privacy === value) ?? "public";
}

/** A volume fader position for the engine: 0 (silent) to 1 (full), or null when it is not a number. */
export function clampVolume(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/** Source kinds that are web pages; their `url` setting must be an http(s) address. */
export const WEB_PAGE_KINDS: ReadonlySet<string> = new Set(["browser", "chatOverlay", "overlay"]);
export const WEB_PAGE_URL_SETTING = "url";

/** True for an absolute http:// or https:// address with a host. */
export function isWebUrl(value: unknown): boolean {
  if (typeof value !== "string" || !URL.canParse(value.trim())) return false;
  const url = new URL(value.trim());
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
}

/** Overlay width and height range, as the overlay library clamps them. */
export const OVERLAY_SIZE = { min: 40, max: 3840 } as const;

/**
 * An overlay width or height typed in the editor, rounded and kept in range,
 * or null when the field is empty or not a number (the saved size stays).
 */
export function overlaySize(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Math.round(Number(text));
  if (!Number.isFinite(value)) return null;
  return Math.min(OVERLAY_SIZE.max, Math.max(OVERLAY_SIZE.min, value));
}
