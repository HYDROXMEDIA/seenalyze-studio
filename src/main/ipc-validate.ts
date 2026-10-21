// Argument checks for StudioApi calls coming from the renderer. Each check
// returns the clean value or throws a stable kebab-case error code
// (mapped under errors.codes.* in the renderer catalogs).

import type { BroadcastInfo, DestinationDraft, SourceKind } from "../shared/types";

const INVALID = "invalid-request";

/** Longest scene, source, effect or destination name/ID accepted from the renderer. */
export const MAX_NAME_LENGTH = 512;
const MAX_SETTINGS_KEYS = 256;
const MAX_SETTINGS_BYTES = 1_000_000;
const MAX_ID_LIST = 64;

const SOURCE_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>([
  "display",
  "window",
  "application",
  "game",
  "camera",
  "captureCard",
  "microphone",
  "desktopAudio",
  "applicationAudio",
  "image",
  "slideshow",
  "media",
  "playlist",
  "scene",
  "syphon",
  "blackmagic",
  "text",
  "color",
  "browser",
  "chatOverlay",
  "overlay",
]);

/** A scene, source, effect or destination name/ID: a non-empty bounded string without NUL. */
export function requireName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NAME_LENGTH || value.includes("\u0000")) throw new Error(INVALID);
  return value;
}

/** A scene item ID: a non-negative integer. */
export function requireItemId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(INVALID);
  return value;
}

export function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error(INVALID);
  return value;
}

/** A list position: a non-negative integer. */
export function requireIndex(value: unknown): number {
  return requireItemId(value);
}

export function requireSourceKind(value: unknown): SourceKind {
  if (typeof value !== "string" || !SOURCE_KINDS.has(value as SourceKind)) throw new Error(INVALID);
  return value as SourceKind;
}

/** Mixer fader position, 0 (silent) to 1 (full). */
export function requireDeflection(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(INVALID);
  return value;
}

/** A plain object (not an array or null), for patches and settings. */
export function requireObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID);
  return value as Record<string, unknown>;
}

/** A unique list of destination IDs. */
export function requireIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ID_LIST) throw new Error(INVALID);
  return [...new Set(value.map(requireName))];
}

/** Web pages a browser source may load: http(s) only (the local overlay server is http on 127.0.0.1). */
export function isBrowserSourceUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 8192) return false;
  if (value === "") return true; // An empty address shows nothing; the dialog allows clearing it.
  if (value === "about:blank") return true; // The engine's own default for a new browser source.
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
  } catch {
    // Not parseable as a URL, so it is rejected by the caller with invalid-url.
    return false;
  }
}

/**
 * Source settings from the properties dialog: a bounded plain object with
 * JSON-safe values. A `url` (browser sources) must be http(s).
 */
export function requireSourceSettings(value: unknown): Record<string, unknown> {
  const settings = requireObject(value);
  const keys = Object.keys(settings);
  if (keys.length > MAX_SETTINGS_KEYS || keys.some((key) => key.length === 0 || key.length > 256)) throw new Error(INVALID);
  let size: number;
  try {
    size = JSON.stringify(settings).length;
  } catch {
    // Cycles or BigInt values cannot be source settings.
    throw new Error(INVALID);
  }
  if (size > MAX_SETTINGS_BYTES) throw new Error(INVALID);
  for (const key of keys) {
    const entry = settings[key];
    if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error(INVALID);
  }
  if (Object.hasOwn(settings, "url") && !isBrowserSourceUrl(settings.url)) throw new Error("invalid-url");
  return settings;
}

/** A destination draft: platform/mode enums, strings, and a profile object. Ranges are clamped later. */
export function requireDestinationDraft(value: unknown): DestinationDraft {
  const draft = requireObject(value);
  if (draft.id !== undefined) requireName(draft.id);
  if (draft.platform !== "youtube" && draft.platform !== "twitch") throw new Error("invalid-platform");
  if (draft.mode !== "account" && draft.mode !== "manual") throw new Error(INVALID);
  if (typeof draft.name !== "string" || draft.name.length > 1000) throw new Error(INVALID);
  if (typeof draft.enabled !== "boolean") throw new Error(INVALID);
  if (typeof draft.server !== "string" || draft.server.length > 2048) throw new Error("invalid-server");
  if (draft.streamKey !== undefined && (typeof draft.streamKey !== "string" || draft.streamKey.length > 4096)) throw new Error(INVALID);
  if (draft.accountId !== undefined) requireName(draft.accountId);
  requireObject(draft.profile);
  return draft as unknown as DestinationDraft;
}

/** Title, Twitch category and YouTube privacy/broadcast for a destination. */
export function requireBroadcastInfo(value: unknown): BroadcastInfo {
  const info = requireObject(value);
  // Optional text fields may come back as null from a platform; null means unset.
  const optional = (entry: unknown) => entry === undefined || entry === null || (typeof entry === "string" && entry.length <= MAX_NAME_LENGTH);
  const text = (entry: unknown) => (typeof entry === "string" ? entry : undefined);
  if (typeof info.title !== "string" || info.title.length > 1000) throw new Error(INVALID);
  if (!optional(info.categoryId) || !optional(info.categoryName) || !optional(info.youtubeBroadcastId)) throw new Error(INVALID);
  if (info.privacy !== undefined && info.privacy !== null && info.privacy !== "public" && info.privacy !== "unlisted" && info.privacy !== "private") throw new Error(INVALID);
  return {
    title: info.title,
    categoryId: text(info.categoryId),
    categoryName: text(info.categoryName),
    privacy: info.privacy === null ? undefined : (info.privacy as BroadcastInfo["privacy"]),
    youtubeBroadcastId: text(info.youtubeBroadcastId),
  };
}

/** An address opened in the user's browser: https only. */
export function requireExternalUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw new Error("invalid-url");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Not a URL: reported as invalid-url instead of a generic failure.
    throw new Error("invalid-url");
  }
  if (parsed.protocol !== "https:") throw new Error("invalid-url");
  return parsed.toString();
}
