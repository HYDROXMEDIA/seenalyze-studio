import { useLayoutEffect, useRef, type RefObject } from "react";
import { moveButtonAfterMove, type MoveDirection } from "./focus-target";

/**
 * Keeps keyboard focus on Move up / Move down buttons after a move. The pressed
 * button can become disabled (the item reached an end of the list) and its row
 * can be moved in the page, and either drops focus to the page. Call `expect`
 * right before the new order is set; the next render focuses the matching
 * button of the moved item, or its sibling when that one is now disabled.
 * The buttons carry `data-move-key` (the item key) and `data-move` ("up" or
 * "down"); `order` lists the item keys as shown.
 */
export function useMoveFocus(root: RefObject<HTMLElement | null>, order: readonly string[]) {
  const pending = useRef<{ key: string; direction: MoveDirection } | null>(null);

  useLayoutEffect(() => {
    const request = pending.current;
    const container = root.current;
    if (!request || !container) return;
    pending.current = null;
    // Focus the user moved elsewhere stays there.
    const active = document.activeElement;
    const lost = !active || active === document.body || (active instanceof HTMLButtonElement && active.disabled);
    if (!lost) return;
    const target = moveButtonAfterMove(request.direction, order.indexOf(request.key), order.length);
    if (!target) return;
    container.querySelector<HTMLElement>(`[data-move-key="${CSS.escape(request.key)}"][data-move="${target}"]`)?.focus();
  });

  return {
    expect: (key: string, direction: MoveDirection) => {
      pending.current = { key, direction };
    },
  };
}
