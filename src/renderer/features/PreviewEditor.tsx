import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "use-intl";
import { studio } from "@/lib/studio";
import { useStudio } from "@/store/studio";
import {
  applyPatch,
  boxPoint,
  containsPoint,
  cropDrag,
  move,
  rotateAround,
  snapLines,
  snapMove,
  snapResize,
  type Handle,
  type SnapGuides,
  type Vec,
} from "../../shared/transform-geometry";
import type { ItemTransformDTO, ItemTransformPatch } from "../../shared/types";

const HANDLES: Handle[] = [
  { hx: 0, hy: 0 },
  { hx: 0.5, hy: 0 },
  { hx: 1, hy: 0 },
  { hx: 1, hy: 0.5 },
  { hx: 1, hy: 1 },
  { hx: 0.5, hy: 1 },
  { hx: 0, hy: 1 },
  { hx: 0, hy: 0.5 },
];
const HANDLE_SIZE = 10;
/** Distance of the rotation handle above the top edge, in screen pixels. */
const ROTATE_OFFSET = 24;
/** Snap distance to the canvas edges and centre lines, in screen pixels. */
const SNAP_DISTANCE = 8;
/** Smallest on-screen source size, so its handles stay apart and grabbable. */
const MIN_SCREEN_SIZE = 3 * HANDLE_SIZE;
const NO_GUIDES: SnapGuides = { x: [], y: [] };

/** Pointer travel, in screen pixels, before a press on a source starts moving it. */
const MOVE_THRESHOLD = 4;

/** How long a committed outline may wait for the saved position to arrive. */
const SETTLE_TIMEOUT_MS = 1000;

type Drag = { itemId: number; pointerId: number; initial: ItemTransformDTO; lines: SnapGuides; lastPatch?: ItemTransformPatch } & (
  | { mode: "move"; start: Vec; moving?: boolean }
  | { mode: "resize"; handle: Handle }
  | { mode: "crop"; handle: Handle }
  | { mode: "rotate"; start: Vec }
);

function cursorFor(handle: Handle, rotation: number): string {
  // Pick the resize cursor closest to the handle's on-screen direction.
  const angle = (Math.atan2(handle.hy - 0.5, handle.hx - 0.5) * 180) / Math.PI + rotation;
  const step = ((Math.round(angle / 45) % 4) + 4) % 4;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][step] ?? "move";
}

/**
 * Transparent editing layer aligned with the preview frame: click to select a
 * source, drag to move, handles to resize (corners keep the aspect ratio,
 * Shift resizes freely, Option/Alt crops) and the top handle to rotate
 * (Shift snaps to 15°). Arrow keys nudge the selection (useArrowNudge).
 * Moving and resizing snap to the canvas edges and centre (Option/Alt turns
 * snapping off), and to other visible sources; sources never shrink below a
 * usable size.
 * The engine draws no editing UI; this layer draws the outline and handles
 * (on macOS it runs in a transparent window above the native preview).
 */
export function PreviewEditor({ width, height, baseWidth, baseHeight }: { width: number; height: number; baseWidth: number; baseHeight: number }) {
  const t = useTranslations("preview.editor");
  const scene = useStudio((state) => state.snapshot?.scenes.find((entry) => entry.name === state.snapshot?.activeScene));
  const selectedItemId = useStudio((state) => state.selectedItemId);
  const selectItem = useStudio((state) => state.selectItem);
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const finishRef = useRef<() => void>(() => undefined);
  // `settling`: the drag has been saved and the outline stays at its final
  // place until the updated scene arrives, so it never jumps back first.
  const [live, setLive] = useState<{ itemId: number; transform: ItemTransformDTO; settling?: ItemTransformDTO } | null>(null);
  const [guides, setGuides] = useState<SnapGuides>(NO_GUIDES);

  // Engine updates are coalesced: at most one request in flight, and only the
  // newest patch is sent when it completes. The outline follows the pointer
  // locally, so it never waits for the engine.
  const pendingRef = useRef<{ scene: string; itemId: number; patch: ItemTransformPatch } | null>(null);
  const frameRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);

  // The engine fits the canvas into the display keeping its aspect ratio and
  // centres it; use the same mapping so the outline sits on the rendered edges.
  const k = baseWidth > 0 && baseHeight > 0 ? Math.min(width / baseWidth, height / baseHeight) : 1;
  const offset = { x: (width - baseWidth * k) / 2, y: (height - baseHeight * k) / 2 };
  const sceneName = scene?.name;
  const selected = scene?.items.find((item) => item.id === selectedItemId);
  // A settling outline gives way once the scene reports a new transform for
  // the item, or after a timeout if the update never arrives.
  const savedTransform = scene?.items.find((item) => item.id === live?.itemId)?.transform;
  const settled = Boolean(live?.settling && savedTransform !== live.settling);
  const transform = live && !settled && live.itemId === selected?.id ? live.transform : selected?.transform;
  const editable = Boolean(selected && transform && selected.visible && !selected.locked);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  // A drag must never outlive the press: if the release is missed (the window
  // loses focus, is re-ordered or hidden mid-drag), end it here so later hover
  // movement cannot keep moving the source.
  useEffect(() => {
    const end = () => finishRef.current();
    window.addEventListener("blur", end);
    return () => window.removeEventListener("blur", end);
  }, []);

  useEffect(() => {
    if (!live?.settling) return;
    const timer = window.setTimeout(() => setLive((current) => (current === live ? null : current)), SETTLE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [live, savedTransform]);

  const flush = () => {
    frameRef.current = 0;
    if (inFlightRef.current) return;
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    inFlightRef.current = studio
      .patchItemTransform(pending.scene, pending.itemId, pending.patch, false)
      .catch(() => undefined)
      .finally(() => {
        inFlightRef.current = null;
        if (pendingRef.current && !frameRef.current) frameRef.current = requestAnimationFrame(flush);
      });
  };

  const queue = (itemId: number, patch: ItemTransformPatch) => {
    if (!sceneName) return;
    pendingRef.current = { scene: sceneName, itemId, patch };
    if (!frameRef.current) frameRef.current = requestAnimationFrame(flush);
  };

  const toCanvasPoint = (event: { clientX: number; clientY: number }): Vec => {
    const box = layerRef.current?.getBoundingClientRect();
    return { x: (event.clientX - (box?.left ?? 0) - offset.x) / k, y: (event.clientY - (box?.top ?? 0) - offset.y) / k };
  };

  /** Snap lines for a drag: the canvas plus every other visible source. */
  const linesFor = (itemId: number): SnapGuides =>
    snapLines(
      { width: baseWidth, height: baseHeight },
      (scene?.items ?? []).flatMap((item) => (item.id !== itemId && item.visible && item.transform ? [item.transform] : [])),
    );

  const begin = (event: ReactPointerEvent, drag: Drag) => {
    event.preventDefault();
    event.stopPropagation();
    layerRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = drag;
  };

  const onLayerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || !scene) return;
    const point = toCanvasPoint(event);
    // Items are listed top-first; locked and hidden items are not picked.
    const hit = scene.items.find((item) => item.visible && !item.locked && item.transform && containsPoint(item.transform, point));
    if (!hit?.transform) {
      selectItem(null);
      return;
    }
    selectItem(hit.id);
    begin(event, { mode: "move", itemId: hit.id, pointerId: event.pointerId, start: point, initial: hit.transform, lines: linesFor(hit.id) });
    setLive({ itemId: hit.id, transform: hit.transform });
  };

  const onMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    // No button held: the release was missed, so the drag is over.
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      finish();
      return;
    }
    const point = toCanvasPoint(event);
    // A click selects without moving; small jitter while pressing is ignored.
    if (drag.mode === "move" && !drag.moving) {
      if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) * k < MOVE_THRESHOLD) return;
      drag.moving = true;
    }
    const threshold = event.altKey ? -1 : SNAP_DISTANCE / k;
    let patch: ItemTransformPatch;
    let snapped = NO_GUIDES;
    if (drag.mode === "move") {
      ({ patch, guides: snapped } = snapMove(drag.initial, move(drag.initial, drag.start, point), drag.lines, threshold));
    } else if (drag.mode === "crop") {
      patch = cropDrag(drag.initial, drag.handle, point);
    } else if (drag.mode === "resize") {
      ({ patch, guides: snapped } = snapResize(drag.initial, drag.handle, point, !event.shiftKey, MIN_SCREEN_SIZE / k, drag.lines, threshold));
    } else {
      patch = rotateAround(drag.initial, drag.start, point, event.shiftKey);
    }
    setGuides(snapped);
    drag.lastPatch = patch;
    setLive({ itemId: drag.itemId, transform: applyPatch(drag.initial, patch) });
    queue(drag.itemId, patch);
  };

  /** Ends the current drag (release, cancel, lost capture or blur) and saves its last position. */
  const finish = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setGuides(NO_GUIDES);
    const layer = layerRef.current;
    if (layer?.hasPointerCapture(drag.pointerId)) layer.releasePointerCapture(drag.pointerId);
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    pendingRef.current = null;
    const patch = drag.lastPatch;
    if (!patch || !sceneName) {
      setLive(null);
      return;
    }
    // Final update (after any live update still in flight) refreshes the
    // snapshot and saves the scene collection.
    const final = applyPatch(drag.initial, patch);
    const saved = scene?.items.find((item) => item.id === drag.itemId)?.transform ?? drag.initial;
    void (inFlightRef.current ?? Promise.resolve())
      .then(() => studio.patchItemTransform(sceneName, drag.itemId, patch, true))
      .then(() => setLive({ itemId: drag.itemId, transform: final, settling: saved }))
      .catch((error: unknown) => {
        console.error(error);
        setLive(null);
      });
  };

  useEffect(() => {
    finishRef.current = finish;
  });

  const screen = (p: Vec) => ({ x: offset.x + p.x * k, y: offset.y + p.y * k });
  const corners = transform ? [boxPoint(transform, 0, 0), boxPoint(transform, 1, 0), boxPoint(transform, 1, 1), boxPoint(transform, 0, 1)].map(screen) : [];
  let rotateHandle: { from: Vec; to: Vec } | null = null;
  if (transform && editable) {
    const top = screen(boxPoint(transform, 0.5, 0));
    const center = screen(boxPoint(transform, 0.5, 0.5));
    const dx = top.x - center.x;
    const dy = top.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    let to = { x: top.x + (dx / length) * ROTATE_OFFSET, y: top.y + (dy / length) * ROTATE_OFFSET };
    // Keep the handle reachable: point it into the box when it would leave the layer.
    if (to.x < 0 || to.y < 0 || to.x > width || to.y > height) to = { x: top.x - (dx / length) * ROTATE_OFFSET, y: top.y - (dy / length) * ROTATE_OFFSET };
    rotateHandle = { from: top, to };
  }

  return (
    <div
      ref={layerRef}
      role="application"
      aria-label={t("label")}
      className="absolute inset-0 touch-none select-none"
      style={{ width, height }}
      onPointerDown={onLayerDown}
      onPointerMove={onMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      {/* Canvas border and snap guides: what is inside the border goes live. */}
      <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
        <rect x={offset.x + 0.5} y={offset.y + 0.5} width={Math.max(0, baseWidth * k - 1)} height={Math.max(0, baseHeight * k - 1)} fill="none" stroke="var(--canvas-border)" strokeWidth={1} />
        {guides.x.map((x) => (
          <line key={`x-${x}`} x1={offset.x + x * k} y1={offset.y} x2={offset.x + x * k} y2={offset.y + baseHeight * k} stroke="var(--snap-guide)" strokeWidth={1} strokeDasharray="5 4" />
        ))}
        {guides.y.map((y) => (
          <line key={`y-${y}`} x1={offset.x} y1={offset.y + y * k} x2={offset.x + baseWidth * k} y2={offset.y + y * k} stroke="var(--snap-guide)" strokeWidth={1} strokeDasharray="5 4" />
        ))}
      </svg>
      {transform && corners.length === 4 && (
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height}>
          <polygon
            points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
            fill="none"
            stroke="var(--primary, #ef4444)"
            strokeWidth={1.5}
            strokeDasharray={editable ? undefined : "4 3"}
          />
          {rotateHandle && <line x1={rotateHandle.from.x} y1={rotateHandle.from.y} x2={rotateHandle.to.x} y2={rotateHandle.to.y} stroke="var(--primary, #ef4444)" strokeWidth={1.5} />}
        </svg>
      )}
      {transform &&
        editable &&
        selected &&
        HANDLES.map((handle) => {
          const p = screen(boxPoint(transform, handle.hx, handle.hy));
          return (
            <div
              key={`${handle.hx}-${handle.hy}`}
              aria-label={t("resize")}
              className="absolute rounded-[2px] border border-primary bg-background"
              style={{
                left: p.x - HANDLE_SIZE / 2,
                top: p.y - HANDLE_SIZE / 2,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                cursor: cursorFor(handle, transform.rotation),
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                // Option/Alt-drag on a handle crops instead of resizing (as in OBS).
                begin(event, { mode: event.altKey ? "crop" : "resize", itemId: selected.id, pointerId: event.pointerId, handle, initial: transform, lines: linesFor(selected.id) });
              }}
            />
          );
        })}
      {rotateHandle && transform && (
        <div
          aria-label={t("rotate")}
          className="absolute cursor-grab rounded-full border border-primary bg-background"
          style={{ left: rotateHandle.to.x - HANDLE_SIZE / 2, top: rotateHandle.to.y - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !selected) return;
            begin(event, { mode: "rotate", itemId: selected.id, pointerId: event.pointerId, start: toCanvasPoint(event), initial: transform, lines: NO_GUIDES });
          }}
        />
      )}
    </div>
  );
}
