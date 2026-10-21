import { useEffect, useState } from "react";
import { studio } from "@/lib/studio";
import { useArrowNudge } from "@/lib/use-arrow-nudge";
import { useCanvasUndo } from "@/lib/use-canvas-undo";
import { useStudio } from "@/store/studio";
import { PREVIEW_EDITOR_MARGIN } from "../../shared/transform-geometry";
import { PreviewEditor } from "./PreviewEditor";

/**
 * Entry for the transparent macOS editor window that sits exactly over the
 * native preview: only the editing layer, sized to the whole window.
 */
export function PreviewEditorRoot() {
  const setSnapshot = useStudio((state) => state.setSnapshot);
  const video = useStudio((state) => state.snapshot?.video);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useCanvasUndo();
  useArrowNudge();

  useEffect(() => {
    let cancelled = false;
    studio
      .getSnapshot()
      .then((initial) => {
        if (!cancelled) setSnapshot(initial);
      })
      // The next pushed snapshot still arrives through onSnapshot.
      .catch((error: unknown) => console.error("[preview-editor] initial snapshot could not be read", error));
    const unsubscribe = studio.onSnapshot(setSnapshot);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [setSnapshot]);

  useEffect(() => {
    const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // The window reaches PREVIEW_EDITOR_MARGIN past the preview on every side.
  const width = size.width - 2 * PREVIEW_EDITOR_MARGIN;
  const height = size.height - 2 * PREVIEW_EDITOR_MARGIN;
  if (!video || width < 2 || height < 2) return null;
  return (
    <div className="absolute" style={{ left: PREVIEW_EDITOR_MARGIN, top: PREVIEW_EDITOR_MARGIN, width, height }}>
      <PreviewEditor width={width} height={height} baseWidth={video.baseWidth} baseHeight={video.baseHeight} />
    </div>
  );
}
