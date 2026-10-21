import { useEffect, type RefObject } from "react";
import { rescueTarget } from "./focus-target";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Keeps keyboard focus inside `container` when the focused control disappears
 * (a removed scene, source or destination, or the menu button of a row a dialog
 * just removed, which is where the dialog returned focus). Without this, focus
 * falls back to the page and the next Tab starts over from the top.
 */
export function useFocusRescue(container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let last: { element: HTMLElement; index: number } | null = null;
    const focusables = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      last = { element: event.target, index: focusables().indexOf(event.target) };
    };
    const observer = new MutationObserver(() => {
      if (!last || last.element.isConnected) return;
      const lost = last;
      last = null;
      // Only when focus really fell to the page; focus the user moved elsewhere stays there.
      const active = document.activeElement;
      if (active && active !== document.body) return;
      rescueTarget(focusables(), lost.index)?.focus();
    });
    root.addEventListener("focusin", onFocusIn);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      root.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
    };
  }, [container]);
}
