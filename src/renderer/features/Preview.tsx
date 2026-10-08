import { ChevronDownIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { NativeMenu } from "@/components/ui/overlays";
import { subscribePixelRatio, readPixelRatio } from "@/lib/pixel-ratio";
import { isMac, studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { DEFAULT_TRANSITION } from "../../shared/transitions";
import { PreviewEditor } from "./PreviewEditor";
import { TransitionsDialog } from "./TransitionsDialog";

/** Gap between the canvas and the edge of the preview area, in pixels. */
const CANVAS_INSET = 12;
/** Studio mode: height of the label above each canvas. */
const LABEL_HEIGHT = 28;
/** Studio mode: room for the transition controls between the two canvases. */
const CONTROLS_WIDTH = 132;
const CONTROLS_HEIGHT = 48;

interface Layout {
  width: number;
  height: number;
  /** Studio mode on a narrow area: preview above program. */
  stacked: boolean;
}

/** Largest canvas size with the given aspect inside a box. */
function fit(width: number, height: number, aspect: number): { width: number; height: number } {
  const fittedWidth = Math.min(width, height * aspect);
  if (fittedWidth <= 0) return { width: 0, height: 0 };
  return { width: Math.floor(fittedWidth), height: Math.floor(fittedWidth / aspect) };
}

function measure(frame: HTMLElement | null) {
  const box = frame?.getBoundingClientRect();
  if (!box || box.width < 2) return null;
  return { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
}

/**
 * Reserves the on-screen rectangles where the engine draws: the program, or in
 * studio mode the editable preview and the program side by side (stacked when
 * the area is narrow). The native surfaces follow these elements. Modal
 * overlays park them off-screen; menus and selects do so only while they
 * actually overlap one.
 */
export function Preview() {
  const t = useTranslations("preview");
  const ts = useTranslations("studioMode");
  const tt = useTranslations("transitions");
  const run = useAction();
  const areaRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const programRef = useRef<HTMLDivElement>(null);
  const overlays = useStudio((state) => state.overlays);
  const poppers = useStudio((state) => state.poppers);
  const [popperCovers, setPopperCovers] = useState(false);
  const video = useStudio((state) => state.snapshot?.video);
  const studioMode = useStudio((state) => state.snapshot?.studioMode?.enabled ?? false);
  const previewScene = useStudio((state) => state.snapshot?.activeScene ?? null);
  const programScene = useStudio((state) => state.snapshot?.studioMode?.programScene ?? null);
  const transition = useStudio((state) => state.snapshot?.transition ?? DEFAULT_TRANSITION);
  const [picking, setPicking] = useState(false);
  const aspect = video ? video.baseWidth / video.baseHeight : 16 / 9;
  const [layout, setLayout] = useState<Layout>({ width: 0, height: 0, stacked: false });
  const pixelRatio = useSyncExternalStore(subscribePixelRatio, readPixelRatio);

  // Letterbox the canvas aspect ratio inside the available area, inset so the
  // surround shows on every side and the canvas edge is always visible. In
  // studio mode, pick whichever arrangement gives the larger canvases.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const update = () => {
      const box = area.getBoundingClientRect();
      const width = box.width - 2 * CANVAS_INSET;
      const height = box.height - 2 * CANVAS_INSET;
      if (!studioMode) return setLayout({ ...fit(width, height, aspect), stacked: false });
      const side = fit((width - CONTROLS_WIDTH) / 2, height - LABEL_HEIGHT, aspect);
      const stacked = fit(width, (height - CONTROLS_HEIGHT) / 2 - LABEL_HEIGHT, aspect);
      setLayout(stacked.width > side.width ? { ...stacked, stacked: true } : { ...side, stacked: false });
    };
    const observer = new ResizeObserver(update);
    observer.observe(area);
    update();
    return () => observer.disconnect();
  }, [aspect, studioMode]);

  // While a menu or select is open, track whether it overlaps a canvas
  // (it may move or animate, so check every frame until it closes).
  useEffect(() => {
    if (poppers === 0) return;
    let raf = 0;
    const check = () => {
      let covers = false;
      for (const frame of [frameRef.current, programRef.current]) {
        const box = frame?.getBoundingClientRect();
        if (!box || box.width <= 0) continue;
        for (const element of document.querySelectorAll("[data-radix-popper-content-wrapper], [role='menu'], [role='listbox']")) {
          const popper = element.getBoundingClientRect();
          if (popper.width > 0 && popper.height > 0 && popper.left < box.right && popper.right > box.left && popper.top < box.bottom && popper.bottom > box.top) {
            covers = true;
            break;
          }
        }
        if (covers) break;
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
    if (layout.width < 2) {
      studio.setProgramBounds(null).catch(console.error);
      studio.setPreviewBounds(null).catch(console.error);
      return;
    }
    // Wait for resizing to settle: rebuilding the native surface on every frame
    // of a window drag is expensive (macOS recreates it per size). A new
    // pixel ratio is reported too: the preview is rebuilt for the new scale.
    let timer = 0;
    const report = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const ratio = window.devicePixelRatio;
        // The program rect first: the preview call places both.
        studio.setProgramBounds(studioMode ? measure(programRef.current) : null, ratio).catch(console.error);
        studio.setPreviewBounds(measure(frameRef.current), ratio).catch(console.error);
      }, 80);
    };
    report();
    window.addEventListener("resize", report);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", report);
    };
  }, [layout, pixelRatio, studioMode]);

  useEffect(
    () => () => {
      studio.setProgramBounds(null).catch(console.error);
      studio.setPreviewBounds(null).catch(console.error);
    },
    [],
  );

  const canvas = { width: layout.width, height: layout.height };
  const editor = !isMac && video && layout.width >= 2 && (
    <PreviewEditor width={layout.width} height={layout.height} baseWidth={video.baseWidth} baseHeight={video.baseHeight} />
  );

  if (!studioMode) {
    return (
      <div ref={areaRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--preview-surface)]">
        <div className="relative" style={canvas}>
          <div ref={frameRef} role="img" aria-label={t("label")} className="absolute inset-0 bg-black outline outline-1 outline-foreground/20" />
          {/* On macOS the editor runs in its own window above the native preview. */}
          {editor}
        </div>
      </div>
    );
  }

  const transitionName = tt(`presets.${transition.id}`);
  const same = !previewScene || previewScene === programScene;
  const pane = (kind: "preview" | "program", scene: string | null, frame: ReactNode) => (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 text-sm" style={{ height: LABEL_HEIGHT, width: layout.width }}>
        {kind === "program" && <span aria-hidden className="size-2 shrink-0 rounded-full bg-live" />}
        <span className="font-semibold">{ts(kind)}</span>
        {scene && <span className="min-w-0 truncate text-muted-foreground">{scene}</span>}
      </div>
      <div className="relative" style={canvas}>
        {frame}
      </div>
    </div>
  );

  return (
    <div ref={areaRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--preview-surface)]">
      <div className={cn("flex items-center", layout.stacked ? "flex-col" : "flex-row")}>
        {pane(
          "preview",
          previewScene,
          <>
            <div ref={frameRef} role="img" aria-label={ts("previewLabel")} className="absolute inset-0 bg-black outline outline-1 outline-foreground/20" />
            {editor}
          </>,
        )}
        <div
          className={cn("flex items-center justify-center gap-1", layout.stacked ? "flex-row" : "flex-col")}
          style={layout.stacked ? { height: CONTROLS_HEIGHT } : { width: CONTROLS_WIDTH, paddingTop: LABEL_HEIGHT }}
        >
          <div className="flex items-center">
            <Button
              size="sm"
              className="rounded-r-none"
              disabled={same}
              title={ts("transitionWith", { name: transitionName })}
              onClick={() => void run(() => studio.studioTransition(null))}
            >
              {ts("transition")}
            </Button>
            <NativeMenu
              items={[
                { label: ts("cut"), disabled: same, onSelect: () => void run(() => studio.studioTransition("cut")) },
                "separator",
                { label: ts("chooseTransition"), onSelect: () => setPicking(true) },
              ]}
            >
              <Button size="sm" className="rounded-l-none border-l border-primary-foreground/20 px-2" aria-label={ts("quick")}>
                <ChevronDownIcon />
              </Button>
            </NativeMenu>
          </div>
        </div>
        {pane(
          "program",
          programScene,
          <div ref={programRef} role="img" aria-label={ts("programLabel")} className="absolute inset-0 bg-black outline outline-1 outline-live/60" />,
        )}
      </div>
      <TransitionsDialog open={picking} onOpenChange={setPicking} />
    </div>
  );
}
