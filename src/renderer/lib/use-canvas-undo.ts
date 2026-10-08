import { useEffect } from "react";
import { studio } from "@/lib/studio";
import { useStudio } from "@/store/studio";
import { useAction } from "./use-action";

/** Text fields keep Cmd/Ctrl+Z for their own text undo. */
function editsText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "submit", "reset", "color", "file"].includes(target.type);
}

/**
 * Cmd+Z (Ctrl+Z on Windows) undoes the last canvas edit; Shift+Cmd+Z and
 * Ctrl+Y redo. Only on the studio view, and not while a dialog is open.
 */
export function useCanvasUndo(): void {
  const run = useAction();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const redo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey);
      if (key !== "z" && !redo) return;
      if (editsText(event.target)) return;
      const { view, overlays, snapshot } = useStudio.getState();
      if (view !== "studio" || overlays > 0 || !snapshot?.ready) return;
      event.preventDefault();
      const history = snapshot.canvasHistory;
      if (redo ? !history?.canRedo : !history?.canUndo) return;
      void run(() => (redo ? studio.redoCanvas() : studio.undoCanvas()));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run]);
}
