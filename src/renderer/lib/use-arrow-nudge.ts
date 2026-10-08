import { useEffect } from "react";
import { studio } from "@/lib/studio";
import { useStudio } from "@/store/studio";
import { nudgeOffset, type Vec } from "../../shared/transform-geometry";

/** Controls that use the arrow keys themselves. */
function usesArrows(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return Boolean(target.closest('[role="slider"],[role="listbox"],[role="menu"],[role="radiogroup"],[role="tablist"],[role="option"],[role="combobox"]'));
}

/** After this long without a key press, positions are read from the scene again. */
const IDLE_MS = 600;

/**
 * Arrow keys move the selected source by one canvas pixel (Shift: ten), like
 * OBS. Held keys are coalesced: one engine update at a time, always to the
 * newest position, and each update is one undo step.
 */
export function useArrowNudge(): void {
  useEffect(() => {
    // The position the engine has (or is about to have), so fast repeats add up
    // even before the refreshed scene arrives.
    let tracked: { scene: string; itemId: number; position: Vec; at: number } | null = null;
    let queued: { scene: string; itemId: number; position: Vec } | null = null;
    let busy = false;

    const send = () => {
      if (busy || !queued) return;
      const next = queued;
      queued = null;
      busy = true;
      studio
        .patchItemTransform(next.scene, next.itemId, { position: next.position }, true)
        .catch((error: unknown) => {
          console.error(error);
          tracked = null;
        })
        .finally(() => {
          busy = false;
          send();
        });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const offset = nudgeOffset(event.key, event.shiftKey);
      if (!offset || usesArrows(event.target)) return;
      const { view, overlays, poppers, snapshot, selectedItemId } = useStudio.getState();
      if (view !== "studio" || overlays > 0 || poppers > 0 || !snapshot?.ready || selectedItemId === null) return;
      const scene = snapshot.scenes.find((entry) => entry.name === snapshot.activeScene);
      const item = scene?.items.find((entry) => entry.id === selectedItemId);
      if (!scene || !item?.transform || !item.visible || item.locked) return;
      event.preventDefault();
      const now = Date.now();
      const fresh = tracked && tracked.scene === scene.name && tracked.itemId === item.id && (busy || queued || now - tracked.at < IDLE_MS);
      const from = fresh && tracked ? tracked.position : item.transform.position;
      const position = { x: from.x + offset.x, y: from.y + offset.y };
      tracked = { scene: scene.name, itemId: item.id, position, at: now };
      queued = { scene: scene.name, itemId: item.id, position };
      send();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
