import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useTranslations } from "use-intl";
import { subscribePixelRatio, readPixelRatio } from "@/lib/pixel-ratio";
import { projectorApi } from "@/lib/projector";
import { cn } from "@/lib/utils";
import type { MenuEntry } from "../../../shared/ipc";
import type { ProjectorCell, ProjectorView } from "../../../shared/projector";

/** Multiview: scene cells per row below the preview and the program. */
const MULTIVIEW_COLUMNS = 4;

/**
 * One picture: the canvas letterboxed inside the cell (the engine fits a
 * source projector's picture inside it), with an optional label underneath.
 */
function Cell({
  cell,
  aspect,
  label,
  index,
  onLayout,
  onPick,
}: {
  cell: ProjectorCell;
  aspect: number;
  label: string | null;
  index: number;
  onLayout: () => void;
  onPick?: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const update = () => {
      const { width, height } = box.getBoundingClientRect();
      const fitted = Math.min(width, height * aspect);
      setSize(fitted > 0 ? { width: Math.floor(fitted), height: Math.floor(fitted / aspect) } : { width: 0, height: 0 });
    };
    const observer = new ResizeObserver(update);
    observer.observe(box);
    update();
    return () => observer.disconnect();
  }, [aspect]);

  useEffect(onLayout, [size, onLayout]);

  const outline = cell.role === "program" || cell.live ? "outline-live" : cell.role === "preview" || cell.previewing ? "outline-emerald-500" : "outline-white/15";
  const picture = (
    <div ref={boxRef} className="flex min-h-0 flex-1 items-center justify-center">
      <div data-projector-cell={index} className={cn("bg-black", label !== null && "outline outline-2", label !== null && outline)} style={size} />
    </div>
  );
  if (label === null) return picture;
  const content = (
    <>
      {picture}
      <span className="h-6 shrink-0 truncate px-1 text-center text-sm leading-6 text-neutral-200">{label}</span>
    </>
  );
  return onPick ? (
    <button type="button" className="flex min-h-0 min-w-0 flex-col rounded-sm p-1 outline-none focus-visible:ring-2 focus-visible:ring-white/70" onClick={onPick}>
      {content}
    </button>
  ) : (
    <div className="flex min-h-0 min-w-0 flex-col p-1">{content}</div>
  );
}

/** Entry for projector windows (`#projector`): pictures only, on black. */
export function ProjectorRoot() {
  const t = useTranslations("projector");
  const [view, setView] = useState<ProjectorView | null>(null);
  const pixelRatio = useSyncExternalStore(subscribePixelRatio, readPixelRatio);
  const timer = useRef(0);

  useEffect(() => {
    const api = projectorApi();
    let cancelled = false;
    api
      .getView()
      .then((initial) => {
        if (!cancelled && initial) setView(initial);
      })
      .catch(console.error);
    const unsubscribe = api.onView(setView);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Reports where every picture is once layout settles (the engine makes a
  // new surface per size, so not on every frame of a resize).
  const report = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const elements = [...document.querySelectorAll<HTMLElement>("[data-projector-cell]")];
      const count = elements.reduce((max, element) => Math.max(max, Number(element.dataset.projectorCell) + 1), 0);
      const rects = Array.from({ length: count }, (_, index) => {
        const box = elements.find((element) => Number(element.dataset.projectorCell) === index)?.getBoundingClientRect();
        return box && box.width >= 2 && box.height >= 2
          ? { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) }
          : null;
      });
      projectorApi().setCells(rects, window.devicePixelRatio).catch(console.error);
    }, 80);
  }, []);

  useEffect(() => {
    report();
    window.addEventListener("resize", report);
    return () => {
      window.removeEventListener("resize", report);
      window.clearTimeout(timer.current);
    };
  }, [report, pixelRatio, view?.cells.length]);

  const target = view?.target;
  const title =
    !target ? "" : target.kind === "scene" || target.kind === "source" ? target.name : t(target.kind === "multiview" ? "multiview" : target.kind);
  useEffect(() => {
    document.title = title;
  }, [title]);

  const openMenu = async (event: MouseEvent) => {
    event.preventDefault();
    if (!view) return;
    const api = projectorApi();
    const actions: (() => Promise<void>)[] = [];
    const entries: MenuEntry[] = [];
    const add = (label: string, action: () => Promise<void>) => {
      entries.push({ label });
      actions.push(action);
    };
    for (const screen of view.screens) {
      add(view.screens.length > 1 ? t("fullscreenOn", { screen: screen.label }) : t("fullscreen"), () => api.setFullscreen(screen.id));
    }
    if (view.fullscreen) add(t("leaveFullscreen"), () => api.setFullscreen(null));
    entries.push({ separator: true });
    actions.push(async () => undefined);
    add(t("close"), () => api.close());
    const chosen = await api.showMenu(entries);
    if (chosen !== null) await actions[chosen]?.();
  };

  if (!view) return <div className="h-full w-full bg-black" />;
  const multiview = view.target.kind === "multiview";
  const label = (cell: ProjectorCell): string | null => {
    if (!multiview) return null;
    if (cell.role === "preview") return cell.name ? t("cellPreview", { scene: cell.name }) : t("preview");
    if (cell.role === "program") return cell.name ? t("cellProgram", { scene: cell.name }) : t("program");
    return cell.name;
  };
  const cell = (entry: ProjectorCell, index: number) => (
    <Cell
      key={`${index}-${entry.role}-${entry.name ?? ""}`}
      cell={entry}
      aspect={view.aspect}
      label={label(entry)}
      index={index}
      onLayout={report}
      onPick={multiview && entry.role === "scene" && entry.name ? () => void projectorApi().pick(index).catch(console.error) : undefined}
    />
  );

  return (
    <div className="flex h-full w-full flex-col bg-black p-0 text-white select-none" onContextMenu={(event) => void openMenu(event).catch(console.error)}>
      {multiview ? (
        <>
          <div className="grid min-h-0 flex-[3] grid-cols-2 gap-1 p-1">{view.cells.slice(0, 2).map((entry, index) => cell(entry, index))}</div>
          <div className="grid min-h-0 flex-[2] gap-1 p-1" style={{ gridTemplateColumns: `repeat(${MULTIVIEW_COLUMNS}, minmax(0, 1fr))` }}>
            {view.cells.slice(2).map((entry, index) => cell(entry, index + 2))}
          </div>
        </>
      ) : (
        view.cells.map((entry, index) => cell(entry, index))
      )}
    </div>
  );
}
