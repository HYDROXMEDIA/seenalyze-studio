import { describe, expect, test } from "bun:test";
import type { EngineSession } from "./engine";
import type { OSN } from "./osn";
import { AudioMixer } from "./audio";
import { SceneGraph, type SceneCollection } from "./scenes";

function fixture(collection?: SceneCollection) {
  const osn = {
    InputFactory: {
      types: () => ["coreaudio_input_capture"],
      create: (id: string, name: string, settings: Record<string, unknown>) => ({ id, name, settings, outputFlags: 2, muted: false, release() {} }),
    },
    SceneFactory: { create: (name: string) => ({ name, getItems: () => [] }) },
    TransitionFactory: { types: () => ["fade_transition"], createPrivate: () => ({ set() {}, clear() {} }) },
    Global: { setOutputSource() {} },
    FaderFactory: { create: () => ({ deflection: 1, attach() {}, detach() {}, destroy() {} }) },
    VolmeterFactory: { create: () => ({ attach() {}, detach() {}, destroy() {} }) },
    NodeObs: { RegisterSourceCallback() {}, RegisterVolmeterCallback() {} },
  } as unknown as OSN;
  const graph = new SceneGraph({ osn, settings: { baseWidth: 1920, baseHeight: 1080 } } as unknown as EngineSession);
  graph.load(collection ?? {
    activeScene: "Scene", sceneOrder: ["Scene"], scenes: { Scene: [] },
    sources: [{ name: "Microphone", kind: "microphone", inputId: "coreaudio_input_capture", settings: {}, muted: false, volume: 0.25 }],
    globalAudio: [{ channel: 3, source: "Microphone" }],
  });
  const mixer = new AudioMixer(osn, graph);
  mixer.sync();
  return { mixer, graph };
}

describe("dormant microphone volume", () => {
  test("keeps the selected volume across mute and unmute", () => {
    const { mixer } = fixture();
    mixer.setVolume("Microphone", 0.4);
    mixer.setMuted("Microphone", true);
    expect(mixer.list()[0]).toMatchObject({ muted: true, deflection: 0.4 });
    mixer.setMuted("Microphone", false);
    expect(mixer.list()[0]).toMatchObject({ muted: false, deflection: 0.4 });
  });

  test("saves and restores the volume while the device is closed", () => {
    const { mixer, graph } = fixture();
    mixer.setMuted("Microphone", true);
    const collection = graph.save((name) => mixer.volumeOf(name));
    expect(collection.sources[0].volume).toBe(0.25);
    const restored = fixture(collection);
    restored.mixer.setMuted("Microphone", false);
    expect(restored.mixer.list()[0].deflection).toBe(0.25);
  });

  test("applies volume changes made while muted when reopening the device", () => {
    const { mixer } = fixture();
    mixer.setMuted("Microphone", true);
    mixer.setVolume("Microphone", 0);
    mixer.setMuted("Microphone", false);
    expect(mixer.list()[0].deflection).toBe(0);
  });
});
