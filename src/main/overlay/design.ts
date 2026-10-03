// Validation for overlay designs that come from outside the app (AI designer).
// The server validates too; this is the client-side guard before anything is
// saved or rendered.

import { coerceValue, type OverlayField, type OverlayFieldGroup, type OverlayFieldType } from "../../shared/overlays";

const FIELD_TYPES: OverlayFieldType[] = ["color", "number", "range", "text", "textarea", "select", "toggle", "font"];
const FIELD_GROUPS: OverlayFieldGroup[] = ["Layout", "Colors", "Typography", "Animation", "Content", "Behavior"];
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/u;
const FORBIDDEN = [/<script[^>]*\ssrc\s*=/iu, /<link\b/iu, /<iframe\b/iu, /<object\b/iu, /<embed\b/iu, /@import/iu, /javascript:/iu, /<base\b/iu, /<meta[^>]*http-equiv/iu];

export const MAX_DESIGN_HTML = 120_000;
export const MAX_FIELDS = 40;

export interface ValidDesign {
  name: string;
  html: string;
  fields: OverlayField[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function validateField(raw: unknown): OverlayField | null {
  if (!isRecord(raw)) return null;
  const { key, label, type } = raw;
  if (typeof key !== "string" || !KEY.test(key)) return null;
  if (typeof label !== "string" || !label.trim()) return null;
  if (typeof type !== "string" || !FIELD_TYPES.includes(type as OverlayFieldType)) return null;
  const field: OverlayField = {
    key,
    label: label.trim().slice(0, 80),
    type: type as OverlayFieldType,
    default: "",
    min: finite(raw.min),
    max: finite(raw.max),
    step: finite(raw.step),
    unit: typeof raw.unit === "string" && /^(px|ms|s|%|deg|em|rem|vh|vw)?$/u.test(raw.unit) ? raw.unit : undefined,
    group: typeof raw.group === "string" && FIELD_GROUPS.includes(raw.group as OverlayFieldGroup) ? (raw.group as OverlayFieldGroup) : undefined,
  };
  if (field.type === "select" || field.type === "font") {
    const options = Array.isArray(raw.options) ? raw.options : [];
    field.options = options
      .filter(isRecord)
      .filter((option) => typeof option.value === "string" && typeof option.label === "string")
      .slice(0, 30)
      .map((option) => ({ value: String(option.value).slice(0, 80), label: String(option.label).slice(0, 80) }));
    if (field.type === "select" && field.options.length === 0) return null;
  }
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) return null;
  const fallback: Record<OverlayFieldType, string | number | boolean> = {
    color: "#ffffff",
    number: field.min ?? 0,
    range: field.min ?? 0,
    text: "",
    textarea: "",
    select: field.options?.[0]?.value ?? "",
    toggle: false,
    font: "system",
  };
  field.default = coerceValue({ ...field, default: fallback[field.type] }, raw.default ?? fallback[field.type]);
  // Drop undefined optional keys so saved JSON stays tidy.
  for (const optional of ["min", "max", "step", "unit", "group", "options"] as const) if (field[optional] === undefined) delete field[optional];
  return field;
}

/** Returns a safe design, or null when it must be rejected. */
export function validateDesign(raw: unknown): ValidDesign | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "";
  const html = typeof raw.html === "string" ? raw.html : "";
  if (!name || html.length < 50 || html.length > MAX_DESIGN_HTML) return null;
  if (FORBIDDEN.some((pattern) => pattern.test(html))) return null;
  if (!Array.isArray(raw.fields) || raw.fields.length > MAX_FIELDS) return null;
  const fields: OverlayField[] = [];
  const seen = new Set<string>();
  for (const entry of raw.fields) {
    const field = validateField(entry);
    if (!field || seen.has(field.key)) return null;
    seen.add(field.key);
    fields.push(field);
  }
  return { name, html, fields };
}
