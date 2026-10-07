import { useEffect, useState } from "react";
import { studio } from "@/lib/studio";
import { useStudio } from "@/store/studio";
import { PreviewEditor } from "./PreviewEditor";

/**
 * Entry for the transparent macOS editor window that sits exactly over the
 * native preview: only the editing layer, sized to the whole window.
 */
export function PreviewEditorRoot() {
  const setSnapshot = useStudio((state) => state.setSnapshot);
  const video = useStudio((state) => state.snapshot?.video);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    let cancelled = false;
    studio
      .getSnapshot()
      .then((initial) => {
        if (!cancelled) setSnapshot(initial);
      })
      .catch(console.error);
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

  if (!video || size.width < 2 || size.height < 2) return null;
  return (
    <div className="relative h-full w-full">
      <PreviewEditor width={size.width} height={size.height} baseWidth={video.baseWidth} baseHeight={video.baseHeight} />
    </div>
  );
}
