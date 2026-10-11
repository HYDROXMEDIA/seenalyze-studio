import { describe, expect, test } from "bun:test";
import type { EngineSession } from "./engine";
import type { OSN } from "./osn";
import { AudioMixer } from "./audio";
import { SceneGraph, type SceneCollection } from "./scenes";

function fixture(collection?: SceneCollection) {
  let createdInputs = 0;
  type Source = { id: string; name: string; width: number; height: number; outputFlags: number; settings: Record<string, unknown>; muted: boolean; release(): void };
  const osn = {
    InputFactory: {
      types: () => ["coreaudio_input_capture", "color_source_v3"],
      create: (id: string, name: string, settings: Record<string, unknown>): Source => {
        createdInputs += 1;
        return { id, name, settings, width: 640, height: 360, outputFlags: id === "coreaudio_input_capture" ? 2 : 1, muted: false, release() {} };
      },
    },
    SceneFactory: {
      create: (name: string) => {
        const makeItem = (source: Source) => {
          let info = { boundsType: 0, boundsAlignment: 0, bounds: { x: 0, y: 0 } };
          const id = nextId++;
          // Engine order is bottom-to-top: "up" swaps with the next item.
          const step = (offset: number): void => {
            const from = items.findIndex((entry) => entry.id === id);
            const to = from + offset;
            if (to >= 0 && to < items.length) [items[from], items[to]] = [items[to], items[from]];
          };
          return {
            id, source, visible: true, selected: false,
            moveUp(): void { step(1); }, moveDown(): void { step(-1); },
            position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, alignment: 5,
            crop: { left: 0, right: 0, top: 0, bottom: 0 },
            get boundsType() { return info.boundsType; }, set boundsType(value: number) { info.boundsType = value; },
            get boundsAlignment() { return info.boundsAlignment; }, set boundsAlignment(value: number) { info.boundsAlignment = value; },
            get bounds() { return info.bounds; }, set bounds(_value: { x: number; y: number }) {},
            get transformInfo() { return info; }, set transformInfo(value: typeof info) { info = value; },
            deferUpdateBegin() {}, deferUpdateEnd() {},
          };
        };
        let nextId = 1;
        const items: ReturnType<typeof makeItem>[] = [];
        return {
          name, getItems: () => items, findItem: (id: number) => items.find((item) => item.id === id),
          add: (source: Source) => { const item = makeItem(source); items.push(item); return item; },
        };
      },
    },
    TransitionFactory: { types: () => ["fade_transition"], createPrivate: () => ({ set() {}, clear() {} }) },
    Global: { setOutputSource() {} },
    FaderFactory: { create: () => ({ deflection: 1, attach() {}, detach() {}, destroy() {} }) },
    VolmeterFactory: { create: () => ({ attach() {}, detach() {}, destroy() {} }) },
    NodeObs: { RegisterSourceCallback() {}, RegisterVolmeterCallback() {} },
  } as unknown as OSN;
  const graph = new SceneGraph({ osn, settings: { baseWidth: 640, baseHeight: 360 } } as unknown as EngineSession);
  if (collection) graph.load(collection);
  else graph.createScene("Scene");
  const mixer = new AudioMixer(osn, graph);
  mixer.sync();
  return { graph, mixer, createdInputs: () => createdInputs };
}

describe("combined transform controls", () => {
  test("numeric bounds and preview patches both update the native transform", () => {
    const { graph } = fixture();
    graph.addSource("Scene", "color", "Picture");
    const item = graph.listScenes()[0].items[0];
    graph.setItemTransform("Scene", item.id, {
      ...graph.getItemTransform("Scene", item.id), sizing: "fit", x: 10, y: 20, width: 320, height: 180,
    });
    expect(graph.getItemTransform("Scene", item.id)).toMatchObject({ x: 10, y: 20, width: 320, height: 180 });
    graph.patchItemTransform("Scene", item.id, { position: { x: 40, y: 50 }, bounds: { x: 160, y: 90 } });
    expect(graph.getItemTransform("Scene", item.id)).toMatchObject({ x: 40, y: 50, width: 160, height: 90 });
    graph.setItemLocked("Scene", item.id, true);
    expect(() => graph.patchItemTransform("Scene", item.id, { rotation: 45 })).toThrow("item-locked");
    expect(() => graph.setItemTransform("Scene", item.id, graph.getItemTransform("Scene", item.id))).toThrow("item-locked");
  });
});

describe("reordering", () => {
  test("moving a source in the list changes which source is drawn on top", () => {
    const { graph } = fixture();
    for (const name of ["A", "B", "C", "D"]) graph.addSource("Scene", "color", name);
    const names = () => graph.listScenes()[0].items.map((item) => item.sourceName);
    // Newest on top.
    expect(names()).toEqual(["D", "C", "B", "A"]);
    const idOf = (name: string) => graph.listScenes()[0].items.find((item) => item.sourceName === name)?.id ?? -1;
    graph.reorderSceneItem("Scene", idOf("A"), 0);
    expect(names()).toEqual(["A", "D", "C", "B"]);
    graph.reorderSceneItem("Scene", idOf("A"), 3);
    expect(names()).toEqual(["D", "C", "B", "A"]);
    graph.reorderSceneItem("Scene", idOf("D"), 2);
    expect(names()).toEqual(["C", "B", "D", "A"]);
    // Saved bottom-to-top, so a reload keeps the stacking.
    expect(graph.save().scenes.Scene.map((item) => item.source)).toEqual(["A", "D", "B", "C"]);
    expect(() => graph.reorderSceneItem("Scene", idOf("A"), 4)).toThrow("invalid-request");
    expect(() => graph.reorderSceneItem("Scene", idOf("A"), -1)).toThrow("invalid-request");
    expect(() => graph.reorderSceneItem("Scene", 999, 0)).toThrow("item-not-found");
  });

  test("moving a scene changes the scene list order", () => {
    const { graph } = fixture();
    graph.createScene("Two");
    graph.createScene("Three");
    const names = () => graph.listScenes().map((scene) => scene.name);
    graph.reorderScene("Three", 0);
    expect(names()).toEqual(["Three", "Scene", "Two"]);
    graph.reorderScene("Three", 2);
    expect(names()).toEqual(["Scene", "Two", "Three"]);
    expect(graph.save().sceneOrder).toEqual(["Scene", "Two", "Three"]);
    expect(() => graph.reorderScene("Two", 3)).toThrow("invalid-request");
    expect(() => graph.reorderScene("Missing", 0)).toThrow("scene-not-found");
  });
});

describe("shared global microphones", () => {
  for (const muted of [false, true]) {
    test(`preserves a reused microphone across reload and mute changes (initial muted=${muted})`, () => {
      const collection: SceneCollection = {
        activeScene: "Scene", sceneOrder: ["Scene"],
        scenes: { Scene: [{ source: "Microphone", visible: true, locked: false, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, alignment: 5, boundsType: 0, boundsAlignment: 0, bounds: { x: 0, y: 0 }, crop: { left: 0, top: 0, right: 0, bottom: 0 } }] },
        sources: [{ name: "Microphone", kind: "microphone", inputId: "coreaudio_input_capture", settings: {}, muted, volume: 0.3 }],
        globalAudio: [{ channel: 3, source: "Microphone" }],
      };
      const { graph, mixer, createdInputs } = fixture(collection);
      expect(graph.listScenes()[0].items).toHaveLength(1);
      mixer.setMuted("Microphone", true);
      mixer.setMuted("Microphone", false);
      expect(graph.listScenes()[0].items[0].sourceName).toBe("Microphone");
      expect(mixer.list()[0]).toMatchObject({ muted: false, deflection: 0.3 });
      expect(createdInputs()).toBe(1);
      const saved = graph.save((name) => mixer.volumeOf(name));
      expect(saved.scenes.Scene[0].source).toBe("Microphone");
      expect(saved.sources).toHaveLength(1);
    });
  }
});
