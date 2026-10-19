import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { readPixelRatio, subscribePixelRatio } from "@/lib/pixel-ratio";
import { isMac, studio } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import type { DisplaySpec, Rect } from "../../shared/types";

/**
 * A live picture of a source or scene inside a dialog, so changes show as they
 * are made. The engine draws it in a native surface placed over this box.
 */
export function LivePreview({ spec, className }: { spec: Extract<DisplaySpec, { kind: "source" | "scene" }>; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const aspect = useStudio((state) => (state.snapshot?.video ? state.snapshot.video.baseWidth / state.snapshot.video.baseHeight : 16 / 9));
  const poppers = useStudio((state) => state.poppers + state.tooltips);
  const pixelRatio = useSyncExternalStore(subscribePixelRatio, readPixelRatio);
  const [rect, setRect] = useState<Rect | null>(null);
  const [covered, setCovered] = useState(false);
  const specKey = `${spec.kind}\u0000${spec.name}`;

  // Follow the box while the dialog opens (it animates in), resizes or scrolls.
  useEffect(() => {
    let raf = 0;
    let last = "";
    const track = () => {
      const box = boxRef.current?.getBoundingClientRect();
      const next = box && box.width >= 2 && box.height >= 2 ? { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) } : null;
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setRect(next);
      }
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Outside macOS a native surface cannot be cut around popups: step aside while one overlaps.
  useEffect(() => {
    if (isMac || poppers === 0) return;
    let raf = 0;
    const check = () => {
      const box = boxRef.current?.getBoundingClientRect();
      let hit = false;
      if (box) {
        for (const element of document.querySelectorAll("[data-radix-popper-content-wrapper], [role='menu'], [role='listbox']")) {
          const popper = element.getBoundingClientRect();
          if (popper.width > 0 && popper.left < box.right && popper.right > box.left && popper.top < box.bottom && popper.bottom > box.top) {
            hit = true;
            break;
          }
        }
      }
      setCovered(hit);
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => {
      cancelAnimationFrame(raf);
      setCovered(false);
    };
  }, [poppers]);

  const shown = covered ? null : rect;
  useEffect(() => {
    // Wait for the dialog's open animation and resizes to settle before a new surface is sized.
    const timer = window.setTimeout(() => {
      studio.setDialogPreview(spec, shown, pixelRatio).catch((error: unknown) => console.error("[preview] dialog preview failed", error));
    }, 60);
    return () => window.clearTimeout(timer);
    // spec is compared by value through specKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, shown?.x, shown?.y, shown?.width, shown?.height, pixelRatio]);

  useEffect(
    () => () => {
      studio.setDialogPreview(null, null).catch((error: unknown) => console.error("[preview] dialog preview could not be removed", error));
    },
    [],
  );

  return <div ref={boxRef} aria-hidden className={cn("w-full overflow-hidden rounded-md border bg-[var(--preview-surface)]", className)} style={{ aspectRatio: String(aspect) }} />;
}
