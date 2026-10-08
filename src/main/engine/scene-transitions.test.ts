import { describe, expect, test } from "bun:test";
import type { EngineSession } from "./engine";
import type { OSN } from "./osn";
import { SceneGraph, type SceneCollection } from "./scenes";

interface FakeTransition {
  id: string;
  settings: Record<string, unknown>;
  starts: { ms: number; scene: string }[];
  set(): void;
  clear(): void;
  update(settings: Record<string, unknown>): void;
  start(ms: number, scene: { name: string }): void;
}

function fixture(collection?: SceneCollection) {
  const created: FakeTransition[] = [];
  let output: FakeTransition | null = null;
  const osn = {
    InputFactory: { types: () => [] },
    SceneFactory: {
      create: (name: string) => ({ name, getItems: () => [], release() {} }),
    },
    TransitionFactory: {
      types: () => ["fade_transition", "slide_transition", "cut_transition"],
      createPrivate: (id: string, _name: string, settings: Record<string, unknown>): FakeTransition => {
        const transition: FakeTransition = {
          id,
          settings,
          starts: [],
          set() {},
          clear() {},
          update(next) {
            transition.settings = next;
          },
          start(ms, scene) {
            transition.starts.push({ ms, scene: scene.name });
          },
        };
        created.push(transition);
        return transition;
      },
    },
    Global: {
      setOutputSource: (_channel: number, source: FakeTransition) => {
        output = source;
      },
    },
  } as unknown as OSN;
  const graph = new SceneGraph({ osn, settings: { baseWidth: 640, baseHeight: 360 } } as unknown as EngineSession);
  graph.setTransition({ id: "fade", durationMs: 300 });
  if (collection) graph.load(collection);
  else {
    graph.createScene("A");
    graph.createScene("B");
  }
  return { graph, created, output: () => output };
}

const collection = (overrides?: SceneCollection["transitionOverrides"]): SceneCollection => ({
  activeScene: "A",
  sceneOrder: ["A", "B"],
  scenes: { A: [], B: [] },
  sources: [],
  globalAudio: [],
  transitionOverrides: overrides,
});

describe("per-scene transitions", () => {
  test("switching into a scene with an override uses it; other scenes use the default", () => {
    const { graph, created, output } = fixture();
    graph.setSceneTransition("B", { id: "slideLeft", durationMs: 800 });
    graph.setActiveScene("B");
    const slide = created.find((entry) => entry.id === "slide_transition");
    expect(slide?.starts).toEqual([{ ms: 800, scene: "B" }]);
    expect(slide?.settings).toMatchObject({ direction: "left" });
    expect(output()).toBe(slide ?? null);
    graph.setActiveScene("A");
    const fade = created.find((entry) => entry.id === "fade_transition");
    expect(fade?.starts).toEqual([{ ms: 300, scene: "A" }]);
    expect(output()).toBe(fade ?? null);
  });

  test("overrides follow renames and duplicates, and go away with their scene", () => {
    const { graph } = fixture();
    graph.setSceneTransition("B", { id: "cut", durationMs: 0 });
    graph.renameScene("B", "Talk");
    expect(graph.listScenes().find((scene) => scene.name === "Talk")?.transition).toEqual({ id: "cut", durationMs: 0 });
    const copy = graph.duplicateScene("Talk");
    expect(graph.listScenes().find((scene) => scene.name === copy)?.transition?.id).toBe("cut");
    graph.removeScene("Talk");
    expect(Object.keys(graph.save().transitionOverrides ?? {})).toEqual([copy]);
    graph.setSceneTransition(copy, null);
    expect(graph.listScenes().every((scene) => scene.transition === undefined)).toBe(true);
  });

  test("overrides are saved with the collection and restored; older collections load without them", () => {
    const { graph } = fixture(collection({ B: { id: "slideUp", durationMs: 450 }, Gone: { id: "fade", durationMs: 300 }, A: { id: "nope", durationMs: 1 } as never }));
    expect(graph.save().transitionOverrides).toEqual({ B: { id: "slideUp", durationMs: 450 } });
    const older = fixture(collection(undefined));
    expect(older.graph.save().transitionOverrides).toEqual({});
  });

  test("unknown scenes and invalid choices are rejected", () => {
    const { graph } = fixture();
    expect(() => graph.setSceneTransition("Missing", { id: "fade", durationMs: 300 })).toThrow("scene-not-found");
    expect(() => graph.setSceneTransition("A", { id: "stinger", durationMs: 300 })).toThrow("transition-unavailable");
  });
});
