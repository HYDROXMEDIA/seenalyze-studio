import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { studio } from "@/lib/studio";
import { useStudio } from "@/store/studio";

/**
 * Reserves the on-screen rectangle where the engine draws the program output.
 * The native surface follows this element and is removed while overlays open.
 */
export function Preview() {
  const t = useTranslations("preview");
  const areaRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const overlays = useStudio((state) => state.overlays);
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

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (overlays > 0 || size.width < 2) {
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
  }, [overlays, size]);

  useEffect(() => () => void studio.setPreviewBounds(null).catch(console.error), []);

  return (
    <div ref={areaRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <div
        ref={frameRef}
        role="img"
        aria-label={t("label")}
        className="bg-black"
        style={{ width: size.width, height: size.height }}
      />
    </div>
  );
}
