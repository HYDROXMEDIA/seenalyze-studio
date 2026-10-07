import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "use-intl";
import { studio } from "@/lib/studio";
import { useStudio } from "@/store/studio";
import {
  applyPatch,
  boxPoint,
  containsPoint,
  move,
  resize,
  rotateAround,
  type Handle,
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

type Drag = { itemId: number; initial: ItemTransformDTO; lastPatch?: ItemTransformPatch } & (
  | { mode: "move"; start: Vec }
  | { mode: "resize"; handle: Handle }
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
 * Shift resizes freely) and the top handle to rotate (Shift snaps to 15°).
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
  const [live, setLive] = useState<{ itemId: number; transform: ItemTransformDTO } | null>(null);

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
  const transform = live && live.itemId === selected?.id ? live.transform : selected?.transform;
  const editable = Boolean(selected && transform && selected.visible && !selected.locked);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

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
    begin(event, { mode: "move", itemId: hit.id, start: point, initial: hit.transform });
    setLive({ itemId: hit.id, transform: hit.transform });
  };

  const onMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toCanvasPoint(event);
    const patch =
      drag.mode === "move"
        ? move(drag.initial, drag.start, point)
        : drag.mode === "resize"
          ? resize(drag.initial, drag.handle, point, !event.shiftKey)
          : rotateAround(drag.initial, drag.start, point, event.shiftKey);
    drag.lastPatch = patch;
    setLive({ itemId: drag.itemId, transform: applyPatch(drag.initial, patch) });
    queue(drag.itemId, patch);
  };

  const onUp = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    layerRef.current?.releasePointerCapture(event.pointerId);
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
    void (inFlightRef.current ?? Promise.resolve())
      .then(() => studio.patchItemTransform(sceneName, drag.itemId, patch, true))
      .catch(console.error)
      .finally(() => setLive(null));
  };

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
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
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
                begin(event, { mode: "resize", itemId: selected.id, handle, initial: transform });
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
            begin(event, { mode: "rotate", itemId: selected.id, start: toCanvasPoint(event), initial: transform });
          }}
        />
      )}
    </div>
  );
}
