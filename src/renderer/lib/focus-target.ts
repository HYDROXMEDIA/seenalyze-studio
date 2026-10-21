// Kept free of DOM types so it can be tested on its own.

/** The control that takes over from one at `lostIndex`: the one now in its place, or the last one. */
export function rescueTarget<T>(candidates: readonly T[], lostIndex: number): T | undefined {
  if (candidates.length === 0) return undefined;
  return candidates[Math.min(Math.max(lostIndex, 0), candidates.length - 1)];
}
