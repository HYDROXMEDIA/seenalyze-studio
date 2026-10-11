import { describe, expect, test } from "bun:test";
import { fittedBounds, initialBounds, minimumSizeFor } from "./window-fit";

const laptop = { x: 0, y: 25, width: 1440, height: 875 };
const portrait = { x: -1080, y: -400, width: 1080, height: 1895 };
const small = { x: 0, y: 0, width: 800, height: 560 };

describe("window fitting", () => {
  test("minimum size never exceeds the screen", () => {
    expect(minimumSizeFor(laptop)).toEqual({ width: 900, height: 600 });
    expect(minimumSizeFor(small)).toEqual({ width: 800, height: 560 });
  });

  test("first launch fits and centres on portrait and small screens", () => {
    expect(initialBounds(portrait)).toEqual({ x: -1080, y: -400 + Math.round((1895 - 900) / 2), width: 1080, height: 900 });
    expect(initialBounds(small)).toEqual({ x: 0, y: 0, width: 800, height: 560 });
  });

  test("a window that already fits is left alone", () => {
    expect(fittedBounds({ x: 100, y: 100, width: 1200, height: 700 }, laptop, [laptop], "left")).toBeNull();
  });

  test("a window wider than its screen is shrunk and pulled back inside", () => {
    // The reported case: 1100 wide on a 1080-wide portrait screen, left edge off-screen.
    const next = fittedBounds({ x: -1100, y: 0, width: 1100, height: 1895 }, portrait, [portrait, laptop], "left");
    expect(next).toEqual({ x: -1080, y: -400 + (1895 - 1895), width: 1080, height: 1895 });
  });

  test("window buttons on no screen are brought back", () => {
    expect(fittedBounds({ x: -300, y: 100, width: 1000, height: 700 }, laptop, [laptop], "left")).toEqual({ x: 0, y: 100, width: 1000, height: 700 });
    expect(fittedBounds({ x: 900, y: 100, width: 1000, height: 700 }, laptop, [laptop], "right")).toEqual({ x: 440, y: 100, width: 1000, height: 700 });
  });

  test("a window placed across two screens keeps its place", () => {
    expect(fittedBounds({ x: -500, y: 100, width: 1000, height: 700 }, laptop, [laptop, portrait], "left")).toBeNull();
  });

  test("a window partly past the far edge keeps its place while its buttons are reachable", () => {
    expect(fittedBounds({ x: 900, y: 100, width: 1000, height: 700 }, laptop, [laptop], "left")).toBeNull();
  });
});
