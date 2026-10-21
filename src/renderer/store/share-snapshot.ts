/**
 * Keeps the previous snapshot's unchanged top-level parts by reference. Main pushes a full
 * snapshot every second while live; with this, selectors such as `snapshot.accounts` keep their
 * reference and the components reading them skip re-rendering. Returns `previous` itself when
 * nothing changed at all.
 */
export function shareUnchanged<T extends object>(previous: T | null, next: T): T {
  if (previous === null) return next;
  const keys = Object.keys(next) as (keyof T)[];
  let changed = keys.length !== Object.keys(previous).length;
  const shared = { ...next };
  for (const key of keys) {
    const before = previous[key];
    // A different key order only counts as a change, which is safe.
    if (before === next[key] || JSON.stringify(before) === JSON.stringify(next[key])) shared[key] = before;
    else changed = true;
  }
  return changed ? shared : previous;
}
