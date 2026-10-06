import type { SourceTransform, TransformAnchor } from "./types";

export const TRANSFORM_ANCHORS: Record<TransformAnchor, number> = {
  topLeft: 5, top: 4, topRight: 6, left: 1, center: 0, right: 2, bottomLeft: 9, bottom: 8, bottomRight: 10,
};

export function validateTransform(value: SourceTransform, sourceWidth: number, sourceHeight: number): void {
  const bounded = (n: number, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  if (!value || !bounded(value.x, -100000, 100000) || !bounded(value.y, -100000, 100000) ||
      !bounded(value.width, 1, 32768) || !bounded(value.height, 1, 32768) || !bounded(value.rotation, -360, 360) ||
      !Object.hasOwn(TRANSFORM_ANCHORS, value.anchor) || !["fit", "stretch", "scale"].includes(value.sizing) || !value.crop) throw new Error("invalid-transform");
  const crop = value.crop;
  if ([crop.left, crop.top, crop.right, crop.bottom].some((n) => !bounded(n, 0, 32768) || !Number.isInteger(n))) throw new Error("invalid-transform");
  if (sourceWidth > 0 ? crop.left + crop.right >= sourceWidth : crop.left + crop.right > 0) throw new Error("invalid-crop");
  if (sourceHeight > 0 ? crop.top + crop.bottom >= sourceHeight : crop.top + crop.bottom > 0) throw new Error("invalid-crop");
  if (value.sizing === "scale" && (sourceWidth <= 0 || sourceHeight <= 0)) throw new Error("source-picture-not-ready");
}

/** Conservative canvas intersection of the source's rotated layout box. */
export function onCanvas(value: SourceTransform, width: number, height: number): boolean {
  const alignment = TRANSFORM_ANCHORS[value.anchor];
  const x = (alignment & 1) ? 0 : (alignment & 2) ? value.width : value.width / 2;
  const y = (alignment & 4) ? 0 : (alignment & 8) ? value.height : value.height / 2;
  const angle = value.rotation * Math.PI / 180;
  const points = [[0, 0], [value.width, 0], [0, value.height], [value.width, value.height]].map(([px, py]) => ({
    x: value.x + (px - x) * Math.cos(angle) - (py - y) * Math.sin(angle),
    y: value.y + (px - x) * Math.sin(angle) + (py - y) * Math.cos(angle),
  }));
  return Math.max(...points.map((p) => p.x)) > 0 && Math.min(...points.map((p) => p.x)) < width &&
    Math.max(...points.map((p) => p.y)) > 0 && Math.min(...points.map((p) => p.y)) < height;
}
