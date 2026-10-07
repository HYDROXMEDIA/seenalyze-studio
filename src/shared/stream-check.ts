import type { SceneReadiness, StreamCheck } from "./types";

export function sceneIssues(scene: SceneReadiness): StreamCheck["issues"] {
  const issues: StreamCheck["issues"] = [];
  if (scene.pictureSources === 0) issues.push({ key: "streamCheck.noPicture", blocking: false });
  if (scene.pendingSources > 0) issues.push({ key: "streamCheck.waitingSources", blocking: false, count: scene.pendingSources });
  if (scene.audibleSources === 0) issues.push({ key: "streamCheck.noSound", blocking: false });
  if (scene.missingSources > 0) issues.push({ key: "streamCheck.missingSources", blocking: false, count: scene.missingSources });
  return issues;
}
