import { describe, expect, test } from "bun:test";
import { rescueTarget } from "./focus-target";

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
