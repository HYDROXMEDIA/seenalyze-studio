// Kept free of DOM types so it can be tested on its own.

/** The control that takes over from one at `lostIndex`: the one now in its place, or the last one. */
export function rescueTarget<T>(candidates: readonly T[], lostIndex: number): T | undefined {
  if (candidates.length === 0) return undefined;
  return candidates[Math.min(Math.max(lostIndex, 0), candidates.length - 1)];
}

export type MoveDirection = "up" | "down";

/**
 * After an item moved to `index` of `count`, the Move button that keeps focus:
 * the one that was pressed, or the other one when the pressed one is now
 * disabled at the end of the list. None when neither is enabled.
 */
export function moveButtonAfterMove(pressed: MoveDirection, index: number, count: number): MoveDirection | undefined {
  if (index < 0 || index >= count) return undefined;
  const enabled = { up: index > 0, down: index < count - 1 };
  const other: MoveDirection = pressed === "up" ? "down" : "up";
  return enabled[pressed] ? pressed : enabled[other] ? other : undefined;
}
