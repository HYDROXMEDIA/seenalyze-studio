import { describe, expect, test } from "bun:test";
import en from "./en.json";
import { AUDIO_FILTER_KINDS, AUDIO_FILTER_SPECS, MONITORING_MODES } from "../../shared/audio";

type Tree = { [key: string]: string | Tree };

function has(tree: Tree, dotted: string): boolean {
  let node: string | Tree | undefined = tree;
  for (const part of dotted.split(".")) {
    if (typeof node !== "object" || node === null) return false;
    node = node[part];
  }
  return typeof node === "string";
}

describe("audio settings messages", () => {
  test("keys built from the filter catalog exist", () => {
    const keys = [
      ...AUDIO_FILTER_KINDS.map((kind) => `mixer.filterKinds.${kind}`),
      ...MONITORING_MODES.map((mode) => `mixer.monitoringModes.${mode}`),
      ...AUDIO_FILTER_KINDS.flatMap((kind) =>
        AUDIO_FILTER_SPECS[kind].params.flatMap((param) => [
          `mixer.params.${param.key}`,
          ...(param.type === "choice" ? param.options.map((option) => `mixer.choices.${option}`) : []),
          ...(param.type === "number" ? [`mixer.units.${param.unit}`] : []),
        ]),
      ),
    ];
    expect(keys.filter((key) => !has(en as Tree, key))).toEqual([]);
  });
});
