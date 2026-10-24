import { describe, expect, test } from "bun:test";
import { SWAP_STEP_MS, SWAP_TOTAL_MS, swapLabelLayout } from "./swap-label";

describe("button label swap", () => {
  test("splits each word into characters with a running position", () => {
    const layout = swapLabelLayout("Continue with SEENALYZE");
    expect(layout.words.map((word) => word.pieces.join(""))).toEqual(["Continue", "with", "SEENALYZE"]);
    expect(layout.words.map((word) => word.start)).toEqual([0, 8, 12]);
    expect(layout.words[2].pieces).toHaveLength(9);
  });

  test("keeps accented and combined characters whole", () => {
    expect(swapLabelLayout("Čeká").words[0].pieces).toEqual(["Č", "e", "k", "á"]);
    expect(swapLabelLayout("é").words[0].pieces).toEqual(["é"]);
  });

  test("moves joined-script words as one piece and leaves Latin words in them split", () => {
    const layout = swapLabelLayout("المتابعة باستخدام SEENALYZE");
    expect(layout.words[0].pieces).toEqual(["المتابعة"]);
    expect(layout.words[1].pieces).toEqual(["باستخدام"]);
    expect(layout.words[2].pieces).toHaveLength(9);
  });

  test("long labels use a shorter step so the whole swap stays quick", () => {
    expect(swapLabelLayout("Go").stepMs).toBe(SWAP_STEP_MS);
    const long = swapLabelLayout("x".repeat(60));
    expect(long.stepMs * 60).toBeLessThanOrEqual(SWAP_TOTAL_MS + 60);
    expect(long.stepMs).toBeLessThan(SWAP_STEP_MS);
  });

  test("ignores extra spaces", () => {
    expect(swapLabelLayout("  Open   browser ").words.map((word) => word.pieces.join(""))).toEqual(["Open", "browser"]);
  });
});
