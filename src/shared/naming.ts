// Names for duplicated scenes and sources.

/**
 * Name for a copy of `name`: "Camera" → "Camera 2", and a copy of "Camera 2"
 * becomes "Camera 3" rather than "Camera 2 2". Picks the first free number.
 */
export function copyName(name: string, taken: (candidate: string) => boolean): string {
  const trimmed = name.trim();
  const match = /^(.*\S)\s+(\d+)$/u.exec(trimmed);
  const base = match ? match[1] : trimmed || "Copy";
  let index = match ? Math.max(2, Number(match[2]) + 1) : 2;
  while (taken(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
