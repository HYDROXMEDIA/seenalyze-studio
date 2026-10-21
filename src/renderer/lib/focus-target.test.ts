import { describe, expect, test } from "bun:test";
import { moveButtonAfterMove, rescueTarget } from "./focus-target";

describe("focus rescue target", () => {
  test("takes the control now in the lost one's place", () => {
    expect(rescueTarget(["a", "b", "c"], 1)).toBe("b");
  });

  test("falls back to the last control when the lost one was at the end", () => {
    expect(rescueTarget(["a", "b"], 5)).toBe("b");
  });

  test("uses the first control when the lost one was not in the list", () => {
    expect(rescueTarget(["a", "b"], -1)).toBe("a");
  });

  test("has nothing to focus in an empty container", () => {
    expect(rescueTarget([], 0)).toBeUndefined();
  });
});

describe("move button after a move", () => {
  test("keeps the pressed button while it is still enabled", () => {
    expect(moveButtonAfterMove("up", 1, 3)).toBe("up");
    expect(moveButtonAfterMove("down", 1, 3)).toBe("down");
  });

  test("moves to the other button when the item reached the end of the list", () => {
    expect(moveButtonAfterMove("up", 0, 3)).toBe("down");
    expect(moveButtonAfterMove("down", 2, 3)).toBe("up");
  });

  test("has no button when the item is alone or gone", () => {
    expect(moveButtonAfterMove("up", 0, 1)).toBeUndefined();
    expect(moveButtonAfterMove("down", -1, 3)).toBeUndefined();
  });
});
