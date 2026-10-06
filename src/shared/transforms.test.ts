import { expect, test } from "bun:test";
import { onCanvas, validateTransform } from "./transforms";
import type { SourceTransform } from "./types";
import { sceneIssues } from "./stream-check";

const layout: SourceTransform = { x: 0, y: 0, width: 320, height: 180, rotation: 0, sizing: "fit", anchor: "topLeft", crop: { left: 0, top: 0, right: 0, bottom: 0 } };
test("invalid layouts are rejected before scene mutation", () => {
  for (const value of [{ ...layout, x: NaN }, { ...layout, width: 0 }, { ...layout, rotation: Infinity }, { ...layout, anchor: "__proto__" as never }]) expect(() => validateTransform(value, 640, 360)).toThrow("invalid-transform");
});
test("crop cannot remove the whole picture or address an unloaded source", () => {
  expect(() => validateTransform({ ...layout, crop: { left: 320, right: 320, top: 0, bottom: 0 } }, 640, 360)).toThrow("invalid-crop");
  expect(() => validateTransform({ ...layout, sizing: "scale" }, 0, 0)).toThrow("source-picture-not-ready");
  expect(() => validateTransform(layout, 0, 0)).not.toThrow();
});
test("canvas checks respect source anchors and rotation", () => {
  expect(onCanvas(layout, 1920, 1080)).toBe(true);
  expect(onCanvas({ ...layout, x: 2200 }, 1920, 1080)).toBe(false);
  expect(onCanvas({ ...layout, x: 2000, anchor: "right" }, 1920, 1080)).toBe(true);
  expect(onCanvas({ ...layout, x: 1950, rotation: 90 }, 1920, 1080)).toBe(true);
});
test("sound and picture warnings remain advisory and are computed from resolved data", () => {
  expect(sceneIssues({ scene: "Scene", pictureSources: 1, audibleSources: 1, pendingSources: 0, missingSources: 0 })).toEqual([]);
  const issues = sceneIssues({ scene: "Scene", pictureSources: 0, audibleSources: 0, pendingSources: 1, missingSources: 2 });
  expect(issues.map((issue) => issue.key)).toEqual(["streamCheck.noPicture", "streamCheck.waitingSources", "streamCheck.noSound", "streamCheck.missingSources"]);
  expect(issues.every((issue) => !issue.blocking)).toBe(true);
});
