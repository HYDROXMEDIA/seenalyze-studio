import { describe, expect, test } from "bun:test";
import type { EngineSession } from "./engine";
import type { OSN } from "./osn";
import { SceneGraph, sharesOnDuplicate, type SceneCollection } from "./scenes";

type Filter = { id: string; name: string; enabled: boolean; settings: Record<string, unknown>; released: boolean; release(): void; update(values: Record<string, unknown>): void; properties: { first(): undefined; get(): undefined } };
type Source = {
  id: string; name: string; width: number; height: number; outputFlags: number; settings: Record<string, unknown>; muted: boolean;
  filters: Filter[]; release(): void; addFilter(filter: Filter): void; removeFilter(filter: Filter): void; setFilterOrder(filter: Filter, movement: number): void;
};

/** Minimal engine double: inputs with filter chains, scenes with ordered items. */
function fixture(options: { reversedOrder?: boolean } = {}) {
  const created: Source[] = [];
  const makeSource = (id: string, name: string, settings: Record<string, unknown>): Source => {
    const source: Source = {
      id, name, settings: { ...settings }, width: 640, height: 360, outputFlags: id === "coreaudio_input_capture" ? 2 : id === "av_capture_input" ? 1 | 128 : 1, muted: false,
      filters: [],
      release() {},
      addFilter(filter) { source.filters.push(filter); },
      removeFilter(filter) { source.filters = source.filters.filter((entry) => entry !== filter); },
      setFilterOrder(filter, movement) {
        const index = source.filters.indexOf(filter);
        const towardStart = (movement === 0) !== Boolean(options.reversedOrder);
        const target = towardStart ? index - 1 : index + 1;
        if (target < 0 || target >= source.filters.length) return;
        [source.filters[index], source.filters[target]] = [source.filters[target], source.filters[index]];
      },
    };
    created.push(source);
    return source;
  };
  let nextId = 1;
  const osn = {
    InputFactory: {
      types: () => ["color_source_v3", "image_source", "av_capture_input", "coreaudio_input_capture"],
      create: (id: string, name: string, settings: Record<string, unknown> = {}) => makeSource(id, name, settings),
    },
    FilterFactory: {
      types: () => ["chroma_key_filter_v2", "crop_filter", "noise_suppress_filter_v2"],
      create: (id: string, name: string, settings: Record<string, unknown> = {}): Filter => {
        const filter: Filter = {
          id, name, enabled: true, settings: { ...settings }, released: false,
          release() { filter.released = true; },
          update(values) { Object.assign(filter.settings, values); },
          properties: { first: () => undefined, get: () => undefined },
        };
        return filter;
      },
    },
    SceneFactory: {
      create: (name: string) => {
        const items: ReturnType<typeof makeItem>[] = [];
        const makeItem = (source: Source) => {
          let info = { boundsType: 0, boundsAlignment: 0, bounds: { x: 0, y: 0 } };
          const item = {
            id: nextId++, source, visible: true, selected: false,
            position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, alignment: 5,
            crop: { left: 0, right: 0, top: 0, bottom: 0 },
            get boundsType() { return info.boundsType; }, set boundsType(value: number) { info.boundsType = value; },
            get boundsAlignment() { return info.boundsAlignment; }, set boundsAlignment(value: number) { info.boundsAlignment = value; },
            get bounds() { return info.bounds; }, set bounds(_value: { x: number; y: number }) {},
            get transformInfo() { return info; }, set transformInfo(value: typeof info) { info = value; },
            deferUpdateBegin() {}, deferUpdateEnd() {},
            moveDown() {
              const index = items.indexOf(item);
              if (index > 0) [items[index - 1], items[index]] = [items[index], items[index - 1]];
            },
            remove() { items.splice(items.indexOf(item), 1); },
          };
          return item;
        };
        const scene = {
          name, source: { name, outputFlags: 1 },
          getItems: () => items, findItem: (id: number) => items.find((item) => item.id === id),
          add: (source: Source) => { const item = makeItem(source); items.push(item); return item; },
          release() {},
        };
        return scene;
      },
    },
    TransitionFactory: { types: () => ["fade_transition"], createPrivate: () => ({ set() {}, clear() {} }) },
    Global: { setOutputSource() {} },
  } as unknown as OSN;
  const graph = new SceneGraph({ osn, settings: { baseWidth: 640, baseHeight: 360 } } as unknown as EngineSession);
  return { graph, created };
}

function load(graph: SceneGraph, collection: SceneCollection | null) {
  graph.load(collection);
  return graph;
}

describe("video effects", () => {
  test("add, edit, toggle, reorder and remove; audio filters are left alone", () => {
    const { graph } = fixture();
    graph.createScene("Scene");
    const name = graph.addSource("Scene", "color", "Backdrop");
    const input = graph.effectTarget(name) as unknown as Source;
    const effects = graph.effects;
    expect(effects.list(input as never).available).toEqual(["chromaKey", "crop"]);
    effects.add(input as never, "chromaKey");
    // An audio filter sits between the two effects.
    input.filters.push({ id: "noise_suppress_filter_v2", name: "Noise", enabled: true, settings: {}, released: false, release() {}, update() {}, properties: { first: () => undefined, get: () => undefined } });
    let list = effects.add(input as never, "crop");
    expect(list.effects.map((effect) => effect.kind)).toEqual(["chromaKey", "crop"]);
    expect(input.filters[0].settings).toEqual({ key_color_type: "green" });
    expect(input.filters[0].released).toBe(true);

    list = effects.move(input as never, "crop 1", "up");
    expect(list.effects.map((effect) => effect.kind)).toEqual(["crop", "chromaKey"]);
    effects.update(input as never, "chromaKey 1", { similarity: 300 });
    effects.setEnabled(input as never, "chromaKey 1", false);
    list = effects.remove(input as never, "crop 1");
    expect(list.effects).toEqual([{ name: "chromaKey 1", kind: "chromaKey", enabled: false }]);
    expect(input.filters.some((filter) => filter.id === "noise_suppress_filter_v2")).toBe(true);
    expect(() => effects.remove(input as never, "Noise")).toThrow("effect-not-found");
  });

  test("reordering works whichever way the binding counts", () => {
    const { graph } = fixture({ reversedOrder: true });
    graph.createScene("Scene");
    const input = graph.effectTarget(graph.addSource("Scene", "color", "Backdrop"));
    graph.effects.add(input, "chromaKey");
    graph.effects.add(input, "crop");
    expect(graph.effects.move(input, "crop 1", "up").effects.map((effect) => effect.name)).toEqual(["crop 1", "chromaKey 1"]);
    expect(graph.effects.move(input, "crop 1", "down").effects.map((effect) => effect.name)).toEqual(["chromaKey 1", "crop 1"]);
  });

  test("effects are saved with the collection and restored on load", () => {
    const first = fixture();
    first.graph.createScene("Scene");
    const input = first.graph.effectTarget(first.graph.addSource("Scene", "color", "Backdrop"));
    first.graph.effects.add(input, "crop");
    first.graph.effects.update(input, "crop 1", { left: 12 });
    first.graph.effects.setEnabled(input, "crop 1", false);
    const saved = first.graph.save();
    expect(saved.sources.find((source) => source.name === "Backdrop")?.effects).toEqual([{ kind: "crop", enabled: false, settings: { left: 12 } }]);

    const second = fixture();
    load(second.graph, JSON.parse(JSON.stringify(saved)) as SceneCollection);
    const restored = second.graph.effectTarget("Backdrop");
    expect(second.graph.effects.list(restored).effects).toEqual([{ name: "crop 1", kind: "crop", enabled: false }]);
    expect(second.graph.effects.snapshot(restored)).toEqual([{ kind: "crop", enabled: false, settings: { left: 12 } }]);
  });

  test("older collections without effects still load", () => {
    const { graph } = fixture();
    load(graph, {
      activeScene: "Scene", sceneOrder: ["Scene"], scenes: { Scene: [] },
      sources: [{ name: "Backdrop", kind: "color", inputId: "color_source_v3", settings: {}, muted: false }],
      globalAudio: [],
    });
    expect(graph.effects.list(graph.effectTarget("Backdrop")).effects).toEqual([]);
    expect(graph.save().sources[0].effects).toBeUndefined();
  });

  test("audio-only sources take no effects", () => {
    const { graph } = fixture();
    graph.createScene("Scene");
    const mic = graph.effectTarget(graph.addSource("Scene", "microphone", "Mic"));
    expect(() => graph.effects.add(mic, "crop")).toThrow("effects-unsupported");
  });
});

describe("scene and source management", () => {
  test("scenes move up and down", () => {
    const { graph } = fixture();
    graph.createScene("Scene");
    graph.createScene("B");
    graph.createScene("C");
    graph.moveScene("C", "up");
    expect(graph.listScenes().map((scene) => scene.name)).toEqual(["Scene", "C", "B"]);
    graph.moveScene("Scene", "up");
    expect(graph.listScenes().map((scene) => scene.name)).toEqual(["Scene", "C", "B"]);
    expect(graph.save().sceneOrder).toEqual(["Scene", "C", "B"]);
  });

  test("a duplicated scene keeps items, placement, visibility and lock, listed right after the original", () => {
    const { graph } = fixture();
    graph.createScene("Scene");
    graph.createScene("Other");
    graph.addSource("Scene", "color", "Backdrop");
    graph.addSource("Scene", "image", "Logo");
    const [logo, backdrop] = graph.listScenes()[0].items;
    graph.patchItemTransform("Scene", logo.id, { position: { x: 30, y: 40 }, crop: { left: 2, top: 0, right: 0, bottom: 0 } });
    graph.setItemVisible("Scene", backdrop.id, false);
    graph.setItemLocked("Scene", logo.id, true);
    const copy = graph.duplicateScene("Scene");
    expect(copy).toBe("Scene 2");
    const scenes = graph.listScenes();
    expect(scenes.map((scene) => scene.name)).toEqual(["Scene", "Scene 2", "Other"]);
    const items = scenes[1].items;
    expect(items.map((item) => [item.sourceName, item.visible, item.locked])).toEqual([["Logo", true, true], ["Backdrop", false, false]]);
    expect(graph.getItemPlacement("Scene 2", items[0].id)).toEqual(graph.getItemPlacement("Scene", logo.id));
  });

  test("a duplicated picture gets its own source with settings and effects, right above the original", () => {
    const { graph } = fixture();
    graph.createScene("Scene");
    graph.addSource("Scene", "color", "Backdrop");
    graph.addSource("Scene", "image", "Logo");
    const input = graph.effectTarget("Backdrop");
    graph.effects.add(input, "chromaKey");
    const backdrop = graph.listScenes()[0].items[1];
    const copy = graph.duplicateSceneItem("Scene", backdrop.id);
    expect(copy.sourceName).toBe("Backdrop 2");
    expect(graph.listScenes()[0].items.map((item) => item.sourceName)).toEqual(["Logo", "Backdrop 2", "Backdrop"]);
    const copied = graph.effectTarget("Backdrop 2");
    expect(copied).not.toBe(input);
    expect(copied.settings).toEqual(input.settings);
    expect(graph.effects.snapshot(copied)).toEqual(graph.effects.snapshot(input));
  });

  test("devices and audio are shared instead of opened twice", () => {
    expect(sharesOnDuplicate("camera", 1)).toBe(true);
    expect(sharesOnDuplicate("other", 1 | 128)).toBe(true);
    expect(sharesOnDuplicate("microphone", 2)).toBe(true);
    expect(sharesOnDuplicate("display", 1)).toBe(false);
    const { graph } = fixture();
    graph.createScene("Scene");
    graph.addSource("Scene", "camera", "Camera");
    const camera = graph.listScenes()[0].items[0];
    expect(graph.duplicateSceneItem("Scene", camera.id).sourceName).toBe("Camera");
    expect(graph.listScenes()[0].items.map((item) => item.sourceName)).toEqual(["Camera", "Camera"]);
  });
});
