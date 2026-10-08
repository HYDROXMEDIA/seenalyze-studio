// Studio mode and projectors, engine side (runs in the engine worker).
// The studio-mode preview is a cut transition that holds the preview scene:
// its display keeps showing the same engine source while the preview scene
// changes, so changing it never rebuilds a display. It is never an output
// source, so it plays no audio and never reaches the stream or recording.

import type { DisplaySpec } from "../../shared/types";
import type { DisplayContent } from "./preview";
import type { ITransition, OSN } from "./osn";
import type { SceneGraph } from "./scenes";

export const STUDIO_PREVIEW_SOURCE = "seenalyze-studio-preview";

export class StudioPreview {
  private transition: ITransition | null = null;
  private shown: string | null = null;

  constructor(
    private readonly osn: OSN,
    private readonly graph: SceneGraph,
  ) {}

  /** The scene shown in the studio-mode preview, or null when studio mode is off. */
  get scene(): string | null {
    return this.shown;
  }

  /** Shows a scene in the preview; null empties it (studio mode off). */
  show(scene: string | null): void {
    if (scene === null) {
      // The transition stays alive until engine teardown (teardown rules) but
      // stops referencing the scene.
      this.transition?.clear();
      this.shown = null;
      return;
    }
    const source = this.graph.scene(scene);
    if (!this.transition) {
      // Public, so a display can find it by name; the app never lists transitions.
      this.transition = this.osn.TransitionFactory.create("cut_transition", STUDIO_PREVIEW_SOURCE, {});
    }
    this.transition.set(source);
    this.shown = scene;
  }
}

/** Resolves what a display should show to engine content; throws when the scene or source is gone. */
export function displayContent(spec: DisplaySpec, graph: SceneGraph, preview: StudioPreview): DisplayContent {
  switch (spec.kind) {
    case "program":
      return { kind: "program" };
    case "studioPreview":
      if (preview.scene === null) throw new Error("scene-not-found");
      return { kind: "source", source: STUDIO_PREVIEW_SOURCE };
    case "scene":
      return { kind: "source", source: graph.scene(spec.name).name };
    case "source":
      return { kind: "source", source: graph.input(spec.name).name };
    default:
      throw new Error("invalid-request");
  }
}
