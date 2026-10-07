import { describe, expect, test } from "bun:test";
import { applyPatch, boxPoint, containsPoint, move, resize, rotateAround, sanitizeTransformPatch } from "./transform-geometry";
import type { ItemTransformDTO } from "./types";

const base: ItemTransformDTO = {
  position: { x: 100, y: 100 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  alignment: 5, // top-left
  boundsType: 0,
  bounds: { x: 0, y: 0 },
  sourceWidth: 200,
  sourceHeight: 100,
};

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("transform geometry", () => {
  test("hit test respects the box", () => {
    expect(containsPoint(base, { x: 150, y: 150 })).toBe(true);
    expect(containsPoint(base, { x: 350, y: 150 })).toBe(false);
  });

  test("move offsets the position", () => {
    expect(move(base, { x: 0, y: 0 }, { x: 10, y: -5 }).position).toEqual({ x: 110, y: 95 });
  });

  test("corner resize keeps aspect by default and anchors the opposite corner", () => {
    const patch = resize(base, { hx: 1, hy: 1 }, { x: 500, y: 150 }, true);
    expect(patch.position).toEqual({ x: 100, y: 100 });
    close(patch.scale!.x, 2);
    close(patch.scale!.y, 2);
  });

  test("free resize from the top-left moves the position", () => {
    const patch = resize(base, { hx: 0, hy: 0 }, { x: 50, y: 80 }, false);
    close(patch.position!.x, 50);
    close(patch.position!.y, 80);
    close(patch.scale!.x, 250 / 200);
    close(patch.scale!.y, 120 / 100);
  });

  test("bounded items resize through bounds", () => {
    const bounded = { ...base, boundsType: 2, bounds: { x: 200, y: 100 } };
    const patch = resize(bounded, { hx: 1, hy: 0.5 }, { x: 400, y: 0 }, true);
    expect(patch.bounds).toEqual({ x: 300, y: 100 });
    expect(patch.scale).toBeUndefined();
  });

  test("rotation pivots around the centre", () => {
    const center = boxPoint(base, 0.5, 0.5);
    const patch = rotateAround(base, { x: center.x + 10, y: center.y }, { x: center.x, y: center.y + 10 }, false);
    close(patch.rotation!, 90);
    const rotated = applyPatch(base, patch);
    const after = boxPoint(rotated, 0.5, 0.5);
    close(after.x, center.x);
    close(after.y, center.y);
  });
});

describe("mirrored items", () => {
  const flipped = {
    position: { x: 100, y: 100 },
    scale: { x: -1, y: 1 },
    rotation: 0,
    alignment: 5,
    boundsType: 0,
    bounds: { x: 0, y: 0 },
    sourceWidth: 200,
    sourceHeight: 100,
  };

  test("a negative scale extends the box the other way from the alignment point", () => {
    expect(boxPoint(flipped, 0, 0)).toEqual({ x: -100, y: 100 });
    expect(boxPoint(flipped, 1, 1)).toEqual({ x: 100, y: 200 });
  });

  test("resizing keeps the mirror and the opposite edge fixed", () => {
    const patch = resize(flipped, { hx: 0, hy: 0.5 }, { x: -200, y: 150 }, false);
    expect(patch.scale?.x).toBeCloseTo(-1.5);
    const clean = sanitizeTransformPatch(patch);
    expect(clean.scale).toEqual(patch.scale);
    const next = applyPatch(flipped, clean);
    expect(boxPoint(next, 1, 0).x).toBeCloseTo(100);
    expect(boxPoint(next, 0, 0).x).toBeCloseTo(-200);
  });

  test("rejects invalid scales and bounds without dropping valid position updates", () => {
    for (const scale of [{ x: 0, y: 1 }, { x: Infinity, y: 1 }, { x: 1_000_001, y: 1 }]) {
      const clean = sanitizeTransformPatch({ position: { x: -20, y: 0 }, scale, bounds: { x: -1, y: 10 } });
      expect(clean.position).toEqual({ x: -20, y: 0 });
      expect(clean.scale).toBeUndefined();
      expect(clean.bounds).toBeUndefined();
    }
  });
});
