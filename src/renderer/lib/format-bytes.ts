const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte", "petabyte"] as const;

/** A size in the reader's language, in decimal units like the system file manager (1 GB = 1000 MB). */
export function formatBytes(bytes: number, locale: string): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const exponent = Math.min(UNITS.length - 1, safe < 1000 ? 0 : Math.floor(Math.log10(safe) / 3));
  const value = safe / 1000 ** exponent;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: UNITS[exponent],
    unitDisplay: "short",
    maximumFractionDigits: exponent === 0 || value >= 100 ? 0 : 1,
  }).format(value);
}
