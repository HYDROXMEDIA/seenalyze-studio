import { describe, expect, test } from "bun:test";
import { applyPatch, boxPoint, containsPoint, move, resize, rotateAround, sanitizeTransformPatch, snapLines, snapMove, snapResize } from "./transform-geometry";
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

  test("resize never goes below the minimum size", () => {
    const patch = resize(base, { hx: 1, hy: 1 }, { x: 101, y: 101 }, false, 40);
    expect(patch.scale?.x).toBeCloseTo(40 / 200);
    expect(patch.scale?.y).toBeCloseTo(40 / 100);
    const kept = resize(base, { hx: 1, hy: 1 }, { x: 101, y: 101 }, true, 40);
    expect(Math.min(200 * (kept.scale?.x ?? 0), 100 * (kept.scale?.y ?? 0))).toBeCloseTo(40);
  });

  test("move snaps edges and centre to the canvas", () => {
    const lines = snapLines({ width: 1920, height: 1080 });
    const edge = snapMove(base, { position: { x: 6, y: 300 } }, lines, 10);
    expect(edge.patch.position).toEqual({ x: 0, y: 300 });
    expect(edge.guides).toEqual({ x: [0], y: [] });
    const centre = snapMove(base, { position: { x: 855, y: 487 } }, lines, 10);
    expect(centre.patch.position).toEqual({ x: 860, y: 490 });
    const free = snapMove(base, { position: { x: 400, y: 300 } }, lines, 10);
    expect(free.patch.position).toEqual({ x: 400, y: 300 });
    expect(free.guides).toEqual({ x: [], y: [] });
  });

  test("move snaps to other items", () => {
    const lines = snapLines({ width: 1920, height: 1080 }, [{ ...base, position: { x: 700, y: 600 } }]);
    // Other item spans x 700..900; our left edge lands on its right edge.
    expect(snapMove(base, { position: { x: 905, y: 300 } }, lines, 10).patch.position).toEqual({ x: 900, y: 300 });
  });

  test("side resize snaps the dragged edge", () => {
    const lines = snapLines({ width: 1920, height: 1080 });
    const { patch, guides } = snapResize(base, { hx: 1, hy: 0.5 }, { x: 1914, y: 500 }, true, 4, lines, 10);
    close(100 + 200 * (patch.scale?.x ?? 0), 1920);
    expect(guides.x).toEqual([1920]);
  });

  test("aspect-locked corner resize lands the snapped edge exactly on the line", () => {
    const lines = snapLines({ width: 1920, height: 1080 });
    const { patch } = snapResize(base, { hx: 1, hy: 1 }, { x: 1000, y: 1076 }, true, 4, lines, 30);
    const s = patch.scale?.x ?? 0;
    expect(patch.scale?.y).toBeCloseTo(s);
    const right = 100 + 200 * s;
    const bottom = 100 + 100 * s;
    expect(Math.abs(right - 1920) < 1e-6 || Math.abs(bottom - 1080) < 1e-6).toBe(true);
  });

  test("rotated items and disabled snapping resize freely", () => {
    const lines = snapLines({ width: 1920, height: 1080 });
    expect(snapResize({ ...base, rotation: 30 }, { hx: 1, hy: 0.5 }, { x: 1914, y: 500 }, true, 4, lines, 10).guides).toEqual({ x: [], y: [] });
    expect(snapResize(base, { hx: 1, hy: 0.5 }, { x: 1914, y: 500 }, true, 4, lines, -1).guides).toEqual({ x: [], y: [] });
  });
});
