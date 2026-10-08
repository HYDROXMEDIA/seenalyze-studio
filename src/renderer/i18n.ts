import type { AbstractIntlMessages } from "use-intl";
import ar from "./messages/ar-EG.json";
import cs from "./messages/cs.json";
import de from "./messages/de.json";
import en from "./messages/en.json";
import es from "./messages/es.json";
import esCL from "./messages/es-CL.json";
import filPH from "./messages/fil-PH.json";
import hr from "./messages/hr.json";
import hu from "./messages/hu.json";
import ptBR from "./messages/pt-BR.json";

/** Interface languages offered by the SEENALYZE dashboard, in picker order. */
export const UI_LOCALES = ["hu", "en", "de", "cs", "hr", "es", "pt-BR", "es-CL", "ar-EG", "fil-PH"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = "en";

/** Native names shown in the picker; never translated. */
export const LOCALE_NAMES: Record<UiLocale, string> = {
  hu: "Magyar",
  en: "English",
  de: "Deutsch",
  cs: "Čeština",
  hr: "Hrvatski",
  es: "Español",
  "pt-BR": "Português (Brasil)",
  "es-CL": "Español (Chile)",
  "ar-EG": "العربية (مصر)",
  "fil-PH": "Filipino",
};

const CATALOG: Record<UiLocale, AbstractIntlMessages> = {
  hu,
  en,
  de,
  cs,
  hr,
  es,
  "pt-BR": ptBR,
  "es-CL": esCL,
  "ar-EG": ar,
  "fil-PH": filPH,
};

const RTL_LOCALES = new Set<UiLocale>(["ar-EG"]);

/** Maps any language tag (for example `pt`, `es_cl`, `tl`) to a supported locale, or null. */
export function matchLocale(value: string | null | undefined): UiLocale | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  const exact = UI_LOCALES.find((locale) => locale.toLowerCase() === normalized);
  if (exact) return exact;
  const base = normalized.split("-")[0];
  if (base === "tl") return "fil-PH";
  return UI_LOCALES.find((locale) => locale.split("-")[0].toLowerCase() === base) ?? null;
}

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

export function directionFor(locale: UiLocale): "ltr" | "rtl" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

/** Catalog for a language tag, falling back to English when the tag is not supported. */
export function loadMessages(language: string | null | undefined): { locale: UiLocale; messages: AbstractIntlMessages } {
  const locale = matchLocale(language) ?? DEFAULT_UI_LOCALE;
  return { locale, messages: CATALOG[locale] };
}
