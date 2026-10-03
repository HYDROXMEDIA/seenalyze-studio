import type { AbstractIntlMessages } from "use-intl";
import en from "./messages/en.json";

const CATALOG: Record<string, AbstractIntlMessages> = { en };

/** Picks the best available catalog for the OS language, falling back to English. */
export function loadMessages(language: string): { locale: string; messages: AbstractIntlMessages } {
  const base = language.toLowerCase().split("-")[0];
  const locale = base in CATALOG ? base : "en";
  return { locale, messages: CATALOG[locale] };
}
