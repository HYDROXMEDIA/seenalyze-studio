import { describe, expect, test } from "bun:test";
import { applyPatch, boxPoint, cropDrag, nudgeOffset, sanitizePlacement, sanitizeTransformPatch } from "./transform-geometry";
import type { ItemTransformDTO } from "./types";

const base: ItemTransformDTO = {
  position: { x: 100, y: 50 },
  scale: { x: 0.5, y: 0.5 },
  rotation: 0,
  alignment: 5, // top-left
  boundsType: 0,
  bounds: { x: 0, y: 0 },
  sourceWidth: 1920,
  sourceHeight: 1080,
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
};

describe("arrow-key nudge", () => {
  test("one pixel, ten with Shift, nothing for other keys", () => {
    expect(nudgeOffset("ArrowLeft", false)).toEqual({ x: -1, y: 0 });
    expect(nudgeOffset("ArrowDown", true)).toEqual({ x: 0, y: 10 });
    expect(nudgeOffset("a", false)).toBeNull();
  });
});

describe("Alt-drag crop", () => {
  test("cropping the left edge cuts source pixels and keeps the right edge and scale", () => {
    // 40 canvas px inward at scale 0.5 = 80 source px.
    const patch = cropDrag(base, { hx: 0, hy: 0.5 }, { x: 140, y: 100 });
    expect(patch.crop).toEqual({ left: 80, top: 0, right: 0, bottom: 0 });
    expect(patch.scale).toBeUndefined();
    const after = applyPatch(base, patch);
    expect(after.sourceWidth).toBe(1840);
    expect(boxPoint(after, 0, 0)).toEqual({ x: 140, y: 50 });
    expect(boxPoint(after, 1, 1)).toEqual(boxPoint(base, 1, 1));
  });

  test("dragging outward uncrops, never past the source edge", () => {
    const cropped = { ...base, crop: { left: 0, top: 0, right: 100, bottom: 0 }, sourceWidth: 1820 };
    const patch = cropDrag(cropped, { hx: 1, hy: 0.5 }, { x: 5000, y: 100 });
    expect(patch.crop?.right).toBe(0);
  });

  test("always keeps at least one source pixel", () => {
    const patch = cropDrag(base, { hx: 0, hy: 0 }, { x: 99999, y: 99999 });
    expect(patch.crop).toEqual({ left: 1919, top: 1079, right: 0, bottom: 0 });
  });

  test("a mirrored item crops the matching source edge", () => {
    const mirrored = { ...base, scale: { x: -0.5, y: 0.5 } };
    const left = boxPoint(mirrored, 0, 0);
    const patch = cropDrag(mirrored, { hx: 0, hy: 0.5 }, { x: left.x + 10, y: 100 });
    expect(patch.crop).toEqual({ left: 0, top: 0, right: 20, bottom: 0 });
  });

  test("bounded items shrink their bounds with the crop", () => {
    const stretched = { ...base, boundsType: 1, bounds: { x: 960, y: 540 }, scale: { x: 1, y: 1 } };
    const patch = cropDrag(stretched, { hx: 0.5, hy: 1 }, { x: 300, y: 50 + 540 - 54 });
    expect(patch.crop).toEqual({ left: 0, top: 0, right: 0, bottom: 108 });
    expect(patch.bounds).toEqual({ x: 960, y: 486 });
  });

  test("crop survives patch sanitizing as whole pixels", () => {
    expect(sanitizeTransformPatch({ crop: { left: 1.4, top: 0, right: 2, bottom: 3 } }).crop).toEqual({ left: 1, top: 0, right: 2, bottom: 3 });
    expect(sanitizeTransformPatch({ crop: { left: -1, top: 0, right: 0, bottom: 0 } }).crop).toBeUndefined();
  });
});

describe("paste transform", () => {
  const placement = {
    position: { x: 1, y: 2 }, scale: { x: 1, y: 1 }, rotation: 0, alignment: 5,
    boundsType: 0, boundsAlignment: 0, bounds: { x: 0, y: 0 }, crop: { left: 0, top: 0, right: 0, bottom: 0 },
  };

  test("accepts a copied placement, including 0x0 bounds of unbounded items", () => {
    expect(sanitizePlacement(placement)).toEqual(placement);
  });

  test("rejects malformed placements", () => {
    expect(sanitizePlacement({ ...placement, scale: { x: 0, y: 1 } })).toBeNull();
    expect(sanitizePlacement({ ...placement, boundsType: 2, bounds: { x: 0, y: 0 } })).toBeNull();
    expect(sanitizePlacement({ ...placement, alignment: "5" })).toBeNull();
    expect(sanitizePlacement(null)).toBeNull();
  });
});
