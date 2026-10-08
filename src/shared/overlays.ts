// Overlay library model shared by the main process (server, storage) and the
// renderer (library + editor). Overlays are self-contained HTML documents
// rendered by the engine's built-in browser; settings are exposed to them as
// CSS custom properties (`--s-<key>`) and through the SEENALYZE runtime API.

import type { Platform } from "./types";

export type OverlayKind =
  | "chat"
  | "alert"
  | "goal"
  | "eventList"
  | "viewerCount"
  | "label"
  | "ticker"
  | "countdown"
  | "timer"
  | "socials"
  | "scene"
  | "custom";

export const OVERLAY_KINDS: OverlayKind[] = [
  "chat",
  "alert",
  "goal",
  "eventList",
  "viewerCount",
  "label",
  "ticker",
  "countdown",
  "timer",
  "socials",
  "scene",
  "custom",
];

export type OverlayFieldType = "color" | "number" | "range" | "text" | "textarea" | "select" | "toggle" | "font";

export type OverlayFieldGroup = "Layout" | "Colors" | "Typography" | "Animation" | "Content" | "Behavior";

export const OVERLAY_FIELD_GROUPS: OverlayFieldGroup[] = ["Content", "Layout", "Colors", "Typography", "Animation", "Behavior"];

export type OverlayValue = string | number | boolean;

export interface OverlayField {
  key: string;
  label: string;
  type: OverlayFieldType;
  default: OverlayValue;
  min?: number;
  max?: number;
  step?: number;
  /** Appended to numeric CSS variables, e.g. "px", "ms", "s", "%". */
  unit?: string;
  options?: { label: string; value: string }[];
  group?: OverlayFieldGroup;
}

export type OverlayOrigin = "preset" | "ai" | "custom";

export interface OverlayDefinition {
  id: string;
  name: string;
  kind: OverlayKind;
  html: string;
  fields: OverlayField[];
  values: Record<string, OverlayValue>;
  /** Browser source size in canvas pixels (at 1080p). */
  width: number;
  height: number;
  origin: OverlayOrigin;
  presetId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OverlayPreset {
  id: string;
  name: string;
  kind: OverlayKind;
  /** Short plain-language description shown in the gallery. */
  description: string;
  /** Accent used for the gallery card. */
  accent: string;
  html: string;
  fields: OverlayField[];
  width: number;
  height: number;
}

export interface OverlaySummary {
  id: string;
  name: string;
  kind: OverlayKind;
  origin: OverlayOrigin;
  width: number;
  height: number;
  updatedAt: number;
}

export interface PresetSummary {
  id: string;
  name: string;
  kind: OverlayKind;
  description: string;
  accent: string;
  width: number;
  height: number;
}

export interface OverlayPatch {
  name?: string;
  values?: Record<string, OverlayValue>;
  width?: number;
  height?: number;
}

/** Live data overlays receive (mirrors the documented runtime API). */
export type StreamEventType =
  | "follow"
  | "subscription"
  | "resub"
  | "giftSub"
  | "cheer"
  | "raid"
  | "superChat"
  | "superSticker"
  | "membership"
  | "memberMilestone"
  | "giftMembership"
  | "redemption";

export interface StreamEvent {
  id: string;
  platform: Platform;
  type: StreamEventType;
  userName: string;
  amount?: number;
  amountLabel?: string;
  count?: number;
  months?: number;
  message?: string;
  tier?: string;
  timestamp: number;
}

export interface StreamStats {
  viewers: { youtube?: number; twitch?: number; total: number };
  followers?: number;
  subscribers?: number;
  members?: number;
  sessionFollows: number;
  sessionSubs: number;
  sessionBits: number;
  sessionSuperChatTotalLabel?: string;
  uptimeSeconds?: number;
  live: boolean;
}

export interface SeenalyzeAccount {
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  canUseDesigner: boolean;
  /** Interface language saved on the account, or null when none is set. */
  language?: string | null;
}

export interface DesignRequest {
  prompt: string;
  kind: OverlayKind;
  /** Present when modifying an existing overlay. */
  overlayId?: string;
}

export interface DesignResult {
  overlay: OverlaySummary;
  creditsCharged: number | null;
}

/** Resolves the effective value of every field (saved value or default). */
export function resolveValues(fields: OverlayField[], values: Record<string, OverlayValue>): Record<string, OverlayValue> {
  const resolved: Record<string, OverlayValue> = {};
  for (const field of fields) {
    const value = values[field.key];
    resolved[field.key] = coerceValue(field, value === undefined ? field.default : value);
  }
  return resolved;
}

/** Brings a value into the field's type and range; falls back to the default. */
export function coerceValue(field: OverlayField, value: unknown): OverlayValue {
  switch (field.type) {
    case "number":
    case "range": {
      const n = typeof value === "number" ? value : Number(value);
      const fallback = Number(field.default) || 0;
      if (!Number.isFinite(n)) return fallback;
      const min = field.min ?? -Infinity;
      const max = field.max ?? Infinity;
      return Math.min(max, Math.max(min, n));
    }
    case "toggle":
      return typeof value === "boolean" ? value : value === "true" || value === 1;
    case "select": {
      const options = field.options ?? [];
      const text = String(value);
      return options.some((option) => option.value === text) ? text : String(field.default);
    }
    case "color": {
      const text = String(value).trim();
      return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/iu.test(text) ? text : String(field.default);
    }
    default:
      return String(value ?? "").slice(0, 2000);
  }
}

/** CSS custom property declarations for the resolved settings. */
export function settingsToCss(fields: OverlayField[], values: Record<string, OverlayValue>): string {
  const resolved = resolveValues(fields, values);
  const lines: string[] = [];
  for (const field of fields) {
    const value = resolved[field.key];
    let css: string;
    if (typeof value === "boolean") css = value ? "1" : "0";
    else if (typeof value === "number") css = `${value}${field.unit ?? ""}`;
    else if (field.type === "font") css = fontStack(value);
    else if (field.type === "color") css = value;
    // Select values are usable as CSS keywords when they are plain identifiers.
    else if (field.type === "select" && /^[a-zA-Z0-9_-]+$/u.test(value)) css = value;
    else css = JSON.stringify(value);
    lines.push(`--s-${field.key}: ${css};`);
  }
  return `:root{${lines.join("")}}`;
}

/** Font choices map to safe local stacks (overlays cannot load web fonts). */
export const FONT_CHOICES: { label: string; value: string }[] = [
  { label: "Inter / System", value: "system" },
  { label: "Rounded", value: "rounded" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "mono" },
  { label: "Condensed", value: "condensed" },
  { label: "Display", value: "display" },
];

export function fontStack(value: string): string {
  switch (value) {
    case "rounded":
      return `"SF Pro Rounded", "Nunito", "Varela Round", ui-rounded, system-ui, sans-serif`;
    case "serif":
      return `"New York", "Iowan Old Style", Georgia, "Times New Roman", serif`;
    case "mono":
      return `"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`;
    case "condensed":
      return `"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", sans-serif-condensed, sans-serif`;
    case "display":
      return `"Futura", "Century Gothic", "Avenir Next", "Segoe UI", sans-serif`;
    default:
      return `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  }
}
