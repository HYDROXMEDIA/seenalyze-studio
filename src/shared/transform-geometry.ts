// Pure scene-item geometry for the preview editor (canvas pixels, libobs
// semantics): the item's alignment point is its position and rotation pivot,
// its box is `bounds` (bounds types) or source size × scale.

import type { ItemPlacement, ItemTransformDTO, ItemTransformPatch } from "./types";

export interface Vec {
  x: number;
  y: number;
}

/** Handle position on the box, as fractions of width/height (0, 0.5 or 1). */
export interface Handle {
  hx: number;
  hy: number;
}

const MIN_SIZE = 4;
const ALIGN_LEFT = 1;
const ALIGN_RIGHT = 2;
const ALIGN_TOP = 4;
const ALIGN_BOTTOM = 8;
const BOUNDS_STRETCH = 1;

/** Keeps finite renderer values; scales may be mirrored, bounds must stay positive. */
export function sanitizeTransformPatch(patch: ItemTransformPatch): ItemTransformPatch {
  const num = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000 ? value : undefined;
  const vec = (value: unknown, mode: "position" | "scale" | "bounds"): Vec | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const x = num((value as { x?: unknown }).x);
    const y = num((value as { y?: unknown }).y);
    if (x === undefined || y === undefined) return undefined;
    if (mode === "scale" && (x === 0 || y === 0)) return undefined;
    if (mode === "bounds" && (x <= 0 || y <= 0)) return undefined;
    return { x, y };
  };
  const rotation = num(patch?.rotation);
  return {
    position: vec(patch?.position, "position"),
    scale: vec(patch?.scale, "scale"),
    rotation: rotation === undefined ? undefined : ((rotation % 360) + 360) % 360,
    bounds: vec(patch?.bounds, "bounds"),
    crop: sanitizeCrop(patch?.crop),
  };
}

type Crop = NonNullable<ItemTransformPatch["crop"]>;
const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
const MAX_CROP = 100_000;

/** Whole, non-negative source pixels per edge, or undefined when malformed. */
export function sanitizeCrop(value: unknown): Crop | undefined {
  if (!value || typeof value !== "object") return undefined;
  const edges = value as Record<string, unknown>;
  const edge = (key: keyof Crop) => {
    const n = edges[key];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_CROP ? Math.round(n) : undefined;
  };
  const left = edge("left");
  const top = edge("top");
  const right = edge("right");
  const bottom = edge("bottom");
  if (left === undefined || top === undefined || right === undefined || bottom === undefined) return undefined;
  return { left, top, right, bottom };
}

/** A full placement from the renderer (paste transform), or null when malformed. */
export function sanitizePlacement(value: unknown): ItemPlacement | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const patch = sanitizeTransformPatch({ position: raw.position, scale: raw.scale, rotation: raw.rotation, bounds: raw.bounds, crop: raw.crop } as ItemTransformPatch);
  const flag = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 0xff ? n : undefined);
  const alignment = flag(raw.alignment);
  const boundsType = flag(raw.boundsType);
  const boundsAlignment = flag(raw.boundsAlignment);
  if (!patch.position || !patch.scale || patch.rotation === undefined || !patch.crop || alignment === undefined || boundsType === undefined || boundsAlignment === undefined) return null;
  // Items without a bounds type may keep 0x0 bounds, which the patch sanitizer rejects.
  const bounds = patch.bounds ?? (boundsType === 0 ? { x: 0, y: 0 } : undefined);
  if (!bounds) return null;
  return { position: patch.position, scale: patch.scale, rotation: patch.rotation, alignment, boundsType, boundsAlignment, bounds, crop: patch.crop };
}

/** Arrow-key nudge: one canvas pixel, ten with Shift; null for other keys. */
export function nudgeOffset(key: string, large: boolean): Vec | null {
  const step = large ? 10 : 1;
  switch (key) {
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    default:
      return null;
  }
}

export function itemSize(t: ItemTransformDTO): { width: number; height: number } {
  if (t.boundsType !== 0) return { width: t.bounds.x, height: t.bounds.y };
  return { width: t.sourceWidth * Math.abs(t.scale.x), height: t.sourceHeight * Math.abs(t.scale.y) };
}

/** Where the alignment point sits inside the box, as fractions. */
export function alignFraction(alignment: number): Vec {
  const x = alignment & ALIGN_LEFT ? 0 : alignment & ALIGN_RIGHT ? 1 : 0.5;
  const y = alignment & ALIGN_TOP ? 0 : alignment & ALIGN_BOTTOM ? 1 : 0.5;
  return { x, y };
}

export function rotate(v: Vec, degrees: number): Vec {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/** Item-local point (relative to the alignment point, unrotated) → canvas. */
export function toCanvas(t: ItemTransformDTO, local: Vec): Vec {
  const r = rotate(local, t.rotation);
  return { x: t.position.x + r.x, y: t.position.y + r.y };
}

/** Canvas point → item-local (relative to the alignment point, unrotated). */
export function toLocal(t: ItemTransformDTO, point: Vec): Vec {
  return rotate({ x: point.x - t.position.x, y: point.y - t.position.y }, -t.rotation);
}

/** Box edges in item-local space. */
export function localBox(t: ItemTransformDTO): { left: number; top: number; width: number; height: number } {
  const { width, height } = itemSize(t);
  const f = alignFraction(t.alignment);
  // libobs scales the source about its own origin before offsetting by the
  // alignment point, so a mirrored axis (negative scale) extends the other way.
  const flipX = t.boundsType === 0 && t.scale.x < 0 ? width : 0;
  const flipY = t.boundsType === 0 && t.scale.y < 0 ? height : 0;
  return { left: -f.x * width - flipX, top: -f.y * height - flipY, width, height };
}

/** Canvas position of a point on the box given as fractions (handles, corners). */
export function boxPoint(t: ItemTransformDTO, hx: number, hy: number): Vec {
  const box = localBox(t);
  return toCanvas(t, { x: box.left + hx * box.width, y: box.top + hy * box.height });
}

export function containsPoint(t: ItemTransformDTO, point: Vec): boolean {
  const box = localBox(t);
  const p = toLocal(t, point);
  return p.x >= box.left && p.x <= box.left + box.width && p.y >= box.top && p.y <= box.top + box.height;
}

export function move(t: ItemTransformDTO, start: Vec, pointer: Vec): ItemTransformPatch {
  return { position: { x: t.position.x + pointer.x - start.x, y: t.position.y + pointer.y - start.y } };
}

/**
 * Resizes by dragging a handle, keeping the opposite side fixed. Corners keep
 * the aspect ratio when `keepAspect` is set (OBS default; Shift frees it).
 * Neither side gets smaller than `minSize` canvas pixels.
 */
export function resize(t: ItemTransformDTO, handle: Handle, pointer: Vec, keepAspect: boolean, minSize = MIN_SIZE): ItemTransformPatch {
  const min = Math.max(1, minSize);
  const box = localBox(t);
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const p = toLocal(t, pointer);
  let width = handle.hx === 1 ? p.x - box.left : handle.hx === 0 ? right - p.x : box.width;
  let height = handle.hy === 1 ? p.y - box.top : handle.hy === 0 ? bottom - p.y : box.height;
  width = Math.max(min, width);
  height = Math.max(min, height);
  const corner = handle.hx !== 0.5 && handle.hy !== 0.5;
  if (keepAspect && corner && box.width > 0 && box.height > 0) {
    const sx = width / box.width;
    const sy = height / box.height;
    const s = Math.max(Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy, min / Math.min(box.width, box.height));
    width = box.width * s;
    height = box.height * s;
  }
  const left = handle.hx === 0 ? right - width : handle.hx === 1 ? box.left : box.left + (box.width - width) / 2;
  const top = handle.hy === 0 ? bottom - height : handle.hy === 1 ? box.top : box.top + (box.height - height) / 2;
  const f = alignFraction(t.alignment);
  const flipX = t.boundsType === 0 && t.scale.x < 0;
  const flipY = t.boundsType === 0 && t.scale.y < 0;
  const position = toCanvas(t, { x: left + f.x * width + (flipX ? width : 0), y: top + f.y * height + (flipY ? height : 0) });
  if (t.boundsType !== 0) return { position, bounds: { x: width, y: height } };
  return {
    position,
    scale: {
      x: t.sourceWidth > 0 ? ((flipX ? -1 : 1) * width) / t.sourceWidth : t.scale.x,
      y: t.sourceHeight > 0 ? ((flipY ? -1 : 1) * height) / t.sourceHeight : t.scale.y,
    },
  };
}

/**
 * Crops by dragging a handle (Alt/Option-drag, like OBS): the dragged edge
 * follows the pointer and cuts source pixels while the opposite edge and the
 * scale stay put. Dragging outward uncrops, never past the source's edge, and
 * at least one source pixel always remains.
 */
export function cropDrag(t: ItemTransformDTO, handle: Handle, pointer: Vec): ItemTransformPatch {
  const crop = t.crop ?? NO_CROP;
  if (t.sourceWidth <= 0 || t.sourceHeight <= 0) return {};
  const box = localBox(t);
  // Canvas pixels per source pixel along each axis.
  let kx: number;
  let ky: number;
  if (t.boundsType === 0) {
    kx = Math.abs(t.scale.x);
    ky = Math.abs(t.scale.y);
  } else if (t.boundsType === BOUNDS_STRETCH) {
    kx = box.width / t.sourceWidth;
    ky = box.height / t.sourceHeight;
  } else {
    kx = ky = Math.min(box.width / t.sourceWidth, box.height / t.sourceHeight);
  }
  if (!(kx > 0) || !(ky > 0)) return {};
  const flipX = t.boundsType === 0 && t.scale.x < 0;
  const flipY = t.boundsType === 0 && t.scale.y < 0;
  const p = toLocal(t, pointer);
  const next = { ...crop };
  let left = box.left;
  let top = box.top;
  let right = box.left + box.width;
  let bottom = box.top + box.height;
  /** Crops `side` by `inward` canvas pixels; returns the change in canvas pixels. */
  const cut = (side: keyof Crop, inward: number, k: number, size: number): number => {
    const value = Math.round(Math.min(crop[side] + size - 1, Math.max(0, crop[side] + inward / k)));
    next[side] = value;
    return (value - crop[side]) * k;
  };
  if (handle.hx === 0) left += cut(flipX ? "right" : "left", p.x - box.left, kx, t.sourceWidth);
  if (handle.hx === 1) right -= cut(flipX ? "left" : "right", right - p.x, kx, t.sourceWidth);
  if (handle.hy === 0) top += cut(flipY ? "bottom" : "top", p.y - box.top, ky, t.sourceHeight);
  if (handle.hy === 1) bottom -= cut(flipY ? "top" : "bottom", bottom - p.y, ky, t.sourceHeight);
  const width = right - left;
  const height = bottom - top;
  const f = alignFraction(t.alignment);
  const position = toCanvas(t, { x: left + f.x * width + (flipX ? width : 0), y: top + f.y * height + (flipY ? height : 0) });
  return t.boundsType === 0 ? { position, crop: next } : { position, crop: next, bounds: { x: width, y: height } };
}

/** Rotates around the box centre; `snap` rounds to 15° steps. */
export function rotateAround(t: ItemTransformDTO, start: Vec, pointer: Vec, snap: boolean): ItemTransformPatch {
  const box = localBox(t);
  const centerLocal = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const center = toCanvas(t, centerLocal);
  const angle = (v: Vec) => (Math.atan2(v.y - center.y, v.x - center.x) * 180) / Math.PI;
  let rotation = t.rotation + angle(pointer) - angle(start);
  if (snap) rotation = Math.round(rotation / 15) * 15;
  rotation = ((rotation % 360) + 360) % 360;
  const offset = rotate({ x: -centerLocal.x, y: -centerLocal.y }, rotation);
  return { rotation, position: { x: center.x + offset.x, y: center.y + offset.y } };
}

export function applyPatch(t: ItemTransformDTO, patch: ItemTransformPatch): ItemTransformDTO {
  const crop = t.crop ?? NO_CROP;
  const next = patch.crop;
  return {
    ...t,
    crop: next ?? t.crop,
    sourceWidth: next ? t.sourceWidth + crop.left + crop.right - next.left - next.right : t.sourceWidth,
    sourceHeight: next ? t.sourceHeight + crop.top + crop.bottom - next.top - next.bottom : t.sourceHeight,
    position: patch.position ?? t.position,
    rotation: patch.rotation ?? t.rotation,
    scale: t.boundsType === 0 ? (patch.scale ?? t.scale) : t.scale,
    bounds: t.boundsType !== 0 ? (patch.bounds ?? t.bounds) : t.bounds,
  };
}

/** Lines in canvas pixels: vertical lines at x, horizontal lines at y. */
export interface SnapGuides {
  x: number[];
  y: number[];
}

/** Axis-aligned bounds of the item's (possibly rotated) box. */
export function boundingBox(t: ItemTransformDTO): { left: number; top: number; right: number; bottom: number } {
  const corners = [boxPoint(t, 0, 0), boxPoint(t, 1, 0), boxPoint(t, 1, 1), boxPoint(t, 0, 1)];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** Lines items snap to: canvas edges and centre, plus other items' edges and centres. */
export function snapLines(canvas: { width: number; height: number }, others: ItemTransformDTO[] = []): SnapGuides {
  const lines: SnapGuides = { x: [0, canvas.width / 2, canvas.width], y: [0, canvas.height / 2, canvas.height] };
  for (const other of others) {
    const box = boundingBox(other);
    lines.x.push(box.left, (box.left + box.right) / 2, box.right);
    lines.y.push(box.top, (box.top + box.bottom) / 2, box.bottom);
  }
  return lines;
}

/** Smallest offset that puts one of `values` on one of `lines`, within `threshold`. */
function nearestSnap(values: number[], lines: number[], threshold: number): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null;
  for (const value of values) {
    for (const line of lines) {
      const delta = line - value;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line };
    }
  }
  return best;
}

/**
 * Snaps a moved item so its edges or centre land on a snap line when within
 * `threshold` canvas pixels; each axis snaps independently.
 */
export function snapMove(t: ItemTransformDTO, patch: ItemTransformPatch, lines: SnapGuides, threshold: number): { patch: ItemTransformPatch; guides: SnapGuides } {
  const moved = applyPatch(t, patch);
  const box = boundingBox(moved);
  const sx = nearestSnap([box.left, (box.left + box.right) / 2, box.right], lines.x, threshold);
  const sy = nearestSnap([box.top, (box.top + box.bottom) / 2, box.bottom], lines.y, threshold);
  return {
    patch: { ...patch, position: { x: moved.position.x + (sx?.delta ?? 0), y: moved.position.y + (sy?.delta ?? 0) } },
    guides: { x: sx ? [sx.line] : [], y: sy ? [sy.line] : [] },
  };
}

/**
 * Resizes like `resize`, snapping the dragged edges to snap lines. A corner
 * that keeps the aspect ratio snaps whichever edge is closer to a line, so the
 * snapped edge lands exactly on it. Rotated items do not snap, since their
 * edges cannot sit on a canvas line.
 */
export function snapResize(
  t: ItemTransformDTO,
  handle: Handle,
  pointer: Vec,
  keepAspect: boolean,
  minSize: number,
  lines: SnapGuides,
  threshold: number,
): { patch: ItemTransformPatch; guides: SnapGuides } {
  const plain = resize(t, handle, pointer, keepAspect, minSize);
  const none = { patch: plain, guides: { x: [], y: [] } };
  if (threshold < 0 || t.rotation % 360 !== 0) return none;
  const box = boundingBox(applyPatch(t, plain));
  const sx = handle.hx === 0.5 ? null : nearestSnap([handle.hx === 1 ? box.right : box.left], lines.x, threshold);
  const sy = handle.hy === 0.5 ? null : nearestSnap([handle.hy === 1 ? box.bottom : box.top], lines.y, threshold);
  if (!sx && !sy) return none;
  // The item is unrotated here, so canvas and item-local axes are parallel and
  // the dragged edge follows the pointer one-to-one.
  const corner = handle.hx !== 0.5 && handle.hy !== 0.5;
  if (keepAspect && corner) {
    const original = boundingBox(t);
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    const useX = sx && (!sy || Math.abs(sx.delta) <= Math.abs(sy.delta));
    const factor = useX ? (width + (handle.hx === 1 ? sx.delta : -sx.delta)) / width : sy ? (height + (handle.hy === 1 ? sy.delta : -sy.delta)) / height : 1;
    const nextWidth = width * factor;
    const nextHeight = height * factor;
    if (Math.min(nextWidth, nextHeight) < minSize) return none;
    const target = {
      x: handle.hx === 1 ? original.left + nextWidth : original.right - nextWidth,
      y: handle.hy === 1 ? original.top + nextHeight : original.bottom - nextHeight,
    };
    return { patch: resize(t, handle, target, false, minSize), guides: { x: useX && sx ? [sx.line] : [], y: !useX && sy ? [sy.line] : [] } };
  }
  const target = { x: pointer.x + (sx?.delta ?? 0), y: pointer.y + (sy?.delta ?? 0) };
  return { patch: resize(t, handle, target, keepAspect, minSize), guides: { x: sx ? [sx.line] : [], y: sy ? [sy.line] : [] } };
}
