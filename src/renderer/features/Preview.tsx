import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { isMac, studio } from "@/lib/studio";
import { useStudio } from "@/store/studio";
import { PreviewEditor } from "./PreviewEditor";

/**
 * Reserves the on-screen rectangle where the engine draws the program output.
 * The native surface follows this element. Modal overlays park it off-screen;
 * menus and selects do so only while they actually overlap it.
 */
export function Preview() {
  const t = useTranslations("preview");
  const areaRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const overlays = useStudio((state) => state.overlays);
  const poppers = useStudio((state) => state.poppers);
  const [popperCovers, setPopperCovers] = useState(false);
  const video = useStudio((state) => state.snapshot?.video);
  const aspect = video ? video.baseWidth / video.baseHeight : 16 / 9;
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Letterbox the canvas aspect ratio inside the available area.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const fit = () => {
      const { width, height } = area.getBoundingClientRect();
      const fittedWidth = Math.min(width, height * aspect);
      setSize({ width: Math.floor(fittedWidth), height: Math.floor(fittedWidth / aspect) });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    fit();
    return () => observer.disconnect();
  }, [aspect]);

  // While a menu or select is open, track whether it overlaps the preview
  // (it may move or animate, so check every frame until it closes).
  useEffect(() => {
    if (poppers === 0) return;
    let raf = 0;
    const check = () => {
      const frame = frameRef.current?.getBoundingClientRect();
      let covers = false;
      if (frame && frame.width > 0) {
        for (const element of document.querySelectorAll("[data-radix-popper-content-wrapper], [role='menu'], [role='listbox']")) {
          const box = element.getBoundingClientRect();
          if (box.width > 0 && box.height > 0 && box.left < frame.right && box.right > frame.left && box.top < frame.bottom && box.bottom > frame.top) {
            covers = true;
            break;
          }
        }
      }
      setPopperCovers(covers);
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => {
      cancelAnimationFrame(raf);
      setPopperCovers(false);
    };
  }, [poppers]);

  const hidden = overlays > 0 || (poppers > 0 && popperCovers);
  useEffect(() => {
    studio.setPreviewHidden(hidden).catch(console.error);
  }, [hidden]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (size.width < 2) {
      studio.setPreviewBounds(null).catch(console.error);
      return;
    }
    // Wait for resizing to settle: rebuilding the native surface on every frame
    // of a window drag is expensive (macOS recreates it per size).
    let timer = 0;
    const report = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const box = frame.getBoundingClientRect();
        studio
          .setPreviewBounds({
            x: Math.round(box.left),
            y: Math.round(box.top),
            width: Math.round(box.width),
            height: Math.round(box.height),
          })
          .catch(console.error);
      }, 80);
    };
    report();
    window.addEventListener("resize", report);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", report);
    };
  }, [size]);

  useEffect(() => () => void studio.setPreviewBounds(null).catch(console.error), []);

  return (
    <div ref={areaRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--preview-surface)]">
      <div className="relative" style={{ width: size.width, height: size.height }}>
        <div ref={frameRef} role="img" aria-label={t("label")} className="absolute inset-0 bg-black outline outline-1 outline-foreground/20" />
        {/* On macOS the editor runs in its own window above the native preview. */}
        {!isMac && video && size.width >= 2 && (
          <PreviewEditor width={size.width} height={size.height} baseWidth={video.baseWidth} baseHeight={video.baseHeight} />
        )}
      </div>
    </div>
  );
}
