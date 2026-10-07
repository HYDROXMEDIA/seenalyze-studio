// Pure scene-item geometry for the preview editor (canvas pixels, libobs
// semantics): the item's alignment point is its position and rotation pivot,
// its box is `bounds` (bounds types) or source size × scale.

import type { ItemTransformDTO, ItemTransformPatch } from "./types";

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
 */
export function resize(t: ItemTransformDTO, handle: Handle, pointer: Vec, keepAspect: boolean): ItemTransformPatch {
  const box = localBox(t);
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const p = toLocal(t, pointer);
  let width = handle.hx === 1 ? p.x - box.left : handle.hx === 0 ? right - p.x : box.width;
  let height = handle.hy === 1 ? p.y - box.top : handle.hy === 0 ? bottom - p.y : box.height;
  width = Math.max(MIN_SIZE, width);
  height = Math.max(MIN_SIZE, height);
  const corner = handle.hx !== 0.5 && handle.hy !== 0.5;
  if (keepAspect && corner && box.width > 0 && box.height > 0) {
    const sx = width / box.width;
    const sy = height / box.height;
    const s = Math.max(Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy, MIN_SIZE / Math.min(box.width, box.height));
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
  return {
    ...t,
    position: patch.position ?? t.position,
    rotation: patch.rotation ?? t.rotation,
    scale: t.boundsType === 0 ? (patch.scale ?? t.scale) : t.scale,
    bounds: t.boundsType !== 0 ? (patch.bounds ?? t.bounds) : t.bounds,
  };
}
