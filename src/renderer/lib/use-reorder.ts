import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

type Key = string | number;

/** Pointer travel, in pixels, before a press on a row starts dragging it. */
const DRAG_THRESHOLD = 4;
/** Distance from the list's top or bottom edge that scrolls it while dragging. */
const SCROLL_ZONE = 32;
const SCROLL_STEP = 8;
const SHIFT_TRANSITION = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";

interface Drag {
  key: Key;
  pointerId: number;
  startY: number;
  lastY: number;
  /** Index the row was picked up from, and the slot it would drop into. */
  from: number;
  target: number;
  /** Row tops (content coordinates of the scroll container) and heights at pickup. */
  tops: number[];
  heights: number[];
  scroller: HTMLElement | null;
  startScroll: number;
  active: boolean;
}

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** Controls inside a row (eye, menu buttons) keep their own clicks. */
function startsOnControl(event: PointerEvent<HTMLElement>): boolean {
  const target = event.target as Element | null;
  const control = target?.closest("button, a, input, select, textarea, [role='menuitem']");
  return Boolean(control && control !== event.currentTarget);
}

/**
 * Pointer and Alt+Arrow reordering for a vertical list. While dragging, the
 * row follows the pointer, the others slide aside to show where it lands, and
 * the list scrolls near its edges; Escape cancels. The new order is shown
 * right away and replaced by the real one once `onMove` settles (on failure
 * the list falls back to the unchanged order).
 *
 * `scope` identifies the list (e.g. the scene whose sources are shown) so a
 * pending order never shows on another list.
 */
export function useReorder<T>(scope: string, items: T[], keyOf: (item: T) => Key, onMove: (item: T, index: number) => Promise<unknown>) {
  const [pending, setPending] = useState<{ scope: string; items: T[] } | null>(null);
  const shown = pending?.scope === scope ? pending.items : items;
  const rows = useRef(new Map<Key, HTMLElement>());
  const dragRef = useRef<Drag | null>(null);
  const scrollFrame = useRef(0);
  /** What the rows need to render the drag: changes on every move. */
  const [view, setView] = useState<{ key: Key; from: number; target: number; offset: number; height: number } | null>(null);
  /** Row moved with Alt+Arrow. React may move its element in the page, which drops focus; it gets it back. */
  const refocus = useRef<Key | null>(null);

  useLayoutEffect(() => {
    const key = refocus.current;
    if (key === null) return;
    const row = rows.current.get(key);
    const active = document.activeElement;
    if (row && (!active || active === document.body)) row.focus();
    // Kept until the move settles: the real order may move the row again.
    if (!pending) refocus.current = null;
  });

  const move = (item: T, index: number) => {
    const from = shown.findIndex((entry) => keyOf(entry) === keyOf(item));
    if (from < 0 || index < 0 || index >= shown.length || index === from) return;
    const next = shown.filter((entry) => keyOf(entry) !== keyOf(item));
    next.splice(index, 0, item);
    setPending({ scope, items: next });
    void onMove(item, index).then(
      () => setPending(null),
      (error: unknown) => {
        console.error("[reorder] move failed", error);
        setPending(null);
      },
    );
  };

  const stopScrolling = () => {
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = 0;
  };

  const end = () => {
    stopScrolling();
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) {
      const row = rows.current.get(drag.key);
      if (row?.hasPointerCapture(drag.pointerId)) row.releasePointerCapture(drag.pointerId);
    }
    setView(null);
  };

  /** Recomputes the dragged row's offset and landing slot from the last pointer position. */
  const update = () => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    const offset = drag.lastY - drag.startY + (drag.scroller ? drag.scroller.scrollTop - drag.startScroll : 0);
    const centre = drag.tops[drag.from] + drag.heights[drag.from] / 2 + offset;
    let target = 0;
    drag.tops.forEach((top, index) => {
      if (index !== drag.from && top + drag.heights[index] / 2 < centre) target += 1;
    });
    drag.target = target;
    setView({ key: drag.key, from: drag.from, target, offset, height: drag.heights[drag.from] });
  };

  /** Scrolls the list while the pointer is near its top or bottom edge. */
  const autoScroll = () => {
    const drag = dragRef.current;
    const scroller = drag?.scroller;
    if (!drag?.active || !scroller) return stopScrolling();
    const box = scroller.getBoundingClientRect();
    const step = drag.lastY < box.top + SCROLL_ZONE ? -SCROLL_STEP : drag.lastY > box.bottom - SCROLL_ZONE ? SCROLL_STEP : 0;
    if (step === 0) return stopScrolling();
    scroller.scrollTop += step;
    update();
    scrollFrame.current = requestAnimationFrame(autoScroll);
  };

  const endRef = useRef(end);
  useEffect(() => {
    endRef.current = end;
  });

  // A drag never outlives the window's focus; Escape cancels it.
  useEffect(() => {
    const cancel = () => {
      if (dragRef.current) endRef.current();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current?.active) {
        event.preventDefault();
        endRef.current();
      }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(scrollFrame.current);
    };
  }, []);

  const rowProps = (item: T, index: number) => {
    const key = keyOf(item);
    let style: CSSProperties | undefined;
    if (view) {
      if (key === view.key) {
        style = { transform: `translateY(${view.offset}px)`, transition: "none", position: "relative", zIndex: 10 };
      } else {
        const shift =
          view.from < view.target && index > view.from && index <= view.target
            ? -view.height
            : view.from > view.target && index >= view.target && index < view.from
              ? view.height
              : 0;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        style = { transform: shift ? `translateY(${shift}px)` : undefined, transition: reduced ? undefined : SHIFT_TRANSITION };
      }
    }
    return {
      ref: (element: HTMLDivElement | null) => {
        if (element) rows.current.set(key, element);
        else rows.current.delete(key);
      },
      "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
      dragging: view?.key === key,
      style,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || startsOnControl(event) || dragRef.current) return;
        dragRef.current = {
          key,
          pointerId: event.pointerId,
          startY: event.clientY,
          lastY: event.clientY,
          from: index,
          target: index,
          tops: [],
          heights: [],
          scroller: null,
          startScroll: 0,
          active: false,
        };
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.key !== key || drag.pointerId !== event.pointerId) return;
        drag.lastY = event.clientY;
        if (!drag.active) {
          if (Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD) return;
          // Picked up: measure every row once, in scroll-content coordinates.
          const scroller = scrollParent(event.currentTarget);
          const base = scroller ? scroller.getBoundingClientRect().top - scroller.scrollTop : 0;
          drag.scroller = scroller;
          drag.startScroll = scroller?.scrollTop ?? 0;
          for (const entry of shown) {
            const box = rows.current.get(keyOf(entry))?.getBoundingClientRect();
            drag.tops.push((box?.top ?? 0) - base);
            drag.heights.push(box?.height ?? 0);
          }
          drag.active = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        update();
        if (!scrollFrame.current) scrollFrame.current = requestAnimationFrame(autoScroll);
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.key !== key) return;
        if (drag.active) {
          // The release ends a drag; the click it produces must not select or open the row.
          const swallow = (click: MouseEvent) => {
            click.stopPropagation();
            click.preventDefault();
          };
          window.addEventListener("click", swallow, true);
          window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
          const dragged = shown[drag.from];
          if (dragged !== undefined && drag.target !== drag.from) move(dragged, drag.target);
          event.preventDefault();
        }
        end();
      },
      onPointerCancel: () => {
        if (dragRef.current?.key === key) end();
      },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        refocus.current = key;
        move(item, event.key === "ArrowUp" ? index - 1 : index + 1);
      },
    };
  };

  return { items: shown, rowProps };
}
