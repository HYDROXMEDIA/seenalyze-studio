import { describe, expect, test } from "bun:test";
import en from "../../messages/en.json";
import { SETUP_GOALS, STARTER_LAYOUTS } from "../../../shared/setup";
import { ENCODER_PRESETS } from "../../../shared/types";

type Tree = { [key: string]: string | Tree };

function has(tree: Tree, dotted: string): boolean {
  let node: string | Tree | undefined = tree;
  for (const part of dotted.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = node[part];
  }
  return typeof node === "string";
}

describe("setup and stream option messages", () => {
  test("keys built from runtime values exist", () => {
    const dynamic = [
      ...["goal", "video", "accounts", "layout"].flatMap((step) => [`setup.steps.${step}.title`, `setup.steps.${step}.description`]),
      ...SETUP_GOALS.map((goal) => `setup.goals.${goal}`),
      ...[...STARTER_LAYOUTS, "none"].map((layout) => `setup.layouts.${layout}`),
      ...ENCODER_PRESETS.map((preset) => `destinations.advanced.presets.${preset}`),
      ...["display", "camera"].map((kind) => `sources.kinds.${kind}`),
      "settings.advanced",
    ];
    expect(dynamic.filter((key) => !has(en as Tree, key))).toEqual([]);
  });
});
