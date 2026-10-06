// Scene graph: scenes, sources, scene items, transforms, properties and
// persistence of the scene collection.

import type { PropertyDTO, PropertyKind, SceneDTO, SceneReadiness, SourceChoiceDTO, SourceKind, SourceTransform, SourceTransformDTO, TransformAnchor, TransformPreset } from "../../shared/types";
import { onCanvas, TRANSFORM_ANCHORS, validateTransform } from "../../shared/transforms";
import type { EngineSession } from "./engine";
import type { IInput, IProperty, IScene, ISceneItem, OSN } from "./osn";
import { availableSourceKinds, resolveSourceType } from "./source-types";

const OUTPUT_FLAG_AUDIO = 2;
// EPropertyType
const P = {
  Boolean: 1,
  Int: 2,
  Float: 3,
  Text: 4,
  Path: 5,
  List: 6,
  Color: 7,
  Button: 8,
  Font: 9,
  EditableList: 10,
  FrameRate: 11,
  Group: 12,
  ColorAlpha: 13,
  Capture: 14,
} as const;
// EBoundsType / EAlignment
const BOUNDS_NONE = 0;
const BOUNDS_STRETCH = 1;
const BOUNDS_SCALE_INNER = 2;
const ALIGN_CENTER = 0;
const ALIGN_TOP_LEFT = 5;

/** Chat overlay page size, in canvas pixels at 1080p. */
const CHAT_OVERLAY_SIZE = { width: 440, height: 720 };
const CHAT_OVERLAY_MARGIN = 24;

/** Initial settings that make a freshly added source useful immediately. */
function initialSettings(kind: SourceKind, inputId: string, width: number, height: number): Record<string, unknown> {
  switch (kind) {
    case "display":
      return inputId === "mac_screen_capture" || inputId === "screen_capture" ? { type: 0, show_cursor: true } : {};
    case "window":
      return inputId === "mac_screen_capture" || inputId === "screen_capture" ? { type: 1, show_cursor: true } : {};
    case "application":
      return { type: 2, show_cursor: true };
    case "applicationAudio":
      return inputId === "sck_audio_capture" ? { type: 1 } : {};
    case "color":
      return { color: 0xff1a1a1a, width, height };
    case "text":
      return { text: "SEENALYZE STUDIO", font: { face: "Helvetica", style: "Regular", size: 72, flags: 0 } };
    case "browser":
      return { url: "about:blank", width: 1280, height: 720 };
    case "chatOverlay":
      return { url: "about:blank", width: CHAT_OVERLAY_SIZE.width, height: CHAT_OVERLAY_SIZE.height, fps_custom: false, shutdown: false, restart_when_active: false };
    default:
      return {};
  }
}

const VISUAL_KINDS: SourceKind[] = ["display", "window", "application", "game", "camera", "captureCard", "image", "slideshow", "media", "playlist", "browser", "syphon", "blackmagic"];
const AUDIO_ONLY: SourceKind[] = ["microphone", "desktopAudio", "applicationAudio"];

interface SavedItem {
  source: string;
  visible: boolean;
  locked: boolean;
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  alignment: number;
  boundsType: number;
  boundsAlignment: number;
  bounds: { x: number; y: number };
  crop: { left: number; right: number; top: number; bottom: number };
}

interface SavedSource {
  name: string;
  kind: SourceKind | "other";
  inputId: string;
  settings: Record<string, unknown>;
  /** Fader deflection (0..1), owned by the audio mixer. */
  volume?: number;
  muted: boolean;
}

export interface SceneCollection {
  activeScene: string | null;
  sceneOrder: string[];
  scenes: Record<string, SavedItem[]>;
  sources: SavedSource[];
  /** Audio sources bound to global output channels (not placed in scenes). */
  globalAudio: { channel: number; source: string }[];
}

const GLOBAL_DESKTOP_CHANNEL = 1;
const GLOBAL_MIC_CHANNEL = 3;

export class SceneGraph {
  private readonly osn: OSN;
  private readonly scenes = new Map<string, IScene>();
  private sceneOrder: string[] = [];
  private readonly inputs = new Map<string, { input: IInput; kind: SourceKind | "other" }>();
  private readonly unavailable = new Map<string, SavedSource>();
  private readonly unavailableItems = new Map<string, SavedItem[]>();
  private readonly locked = new Set<string>();
  private readonly globalAudio = new Map<number, string>();
  private active: string | null = null;
  /**
   * The engine client keeps reporting a source's original name after a rename,
   * so names read from engine objects are mapped to their current name here.
   */
  private readonly engineNames = new Map<string, string>();

  constructor(private readonly engine: EngineSession) {
    this.osn = engine.osn;
  }

  // ----- scenes -------------------------------------------------------------

  listScenes(): SceneDTO[] {
    return this.sceneOrder.map((name) => {
      const scene = this.requireScene(name);
      // Engine order is bottom-to-top; the UI lists the top item first.
      const items = scene
        .getItems()
        .map((item) => ({
          id: item.id,
          sourceName: this.nameOf(item.source),
          kind: this.scenes.has(this.nameOf(item.source)) ? "scene" : this.inputs.get(this.nameOf(item.source))?.kind ?? "other",
          visible: item.visible,
          locked: this.locked.has(lockKey(name, item.id)),
        }))
        .reverse();
      return { name, items };
    });
  }

  get activeScene(): string | null {
    return this.active;
  }

  get unavailableSourceCount(): number {
    return this.unavailable.size;
  }

  createScene(name: string): void {
    const clean = this.uniqueName(name.trim() || "Scene");
    this.scenes.set(clean, this.osn.SceneFactory.create(clean));
    this.sceneOrder.push(clean);
    if (!this.active) this.setActiveScene(clean);
  }

  removeScene(name: string): void {
    if (this.sceneOrder.length <= 1) throw new Error("last-scene");
    const scene = this.requireScene(name);
    if ([...this.scenes.values()].some((entry) => entry.getItems().some((item) => this.nameOf(item.source) === name))) {
      throw new Error("scene-in-use");
    }
    // Detach items before releasing the scene; releasing a populated scene
    // leaves references that make engine teardown stall.
    for (const item of scene.getItems()) {
      this.locked.delete(lockKey(name, item.id));
      item.remove();
    }
    scene.release();
    this.scenes.delete(name);
    this.unavailableItems.delete(name);
    this.sceneOrder = this.sceneOrder.filter((entry) => entry !== name);
    if (this.active === name) this.setActiveScene(this.sceneOrder[0]);
    this.releaseUnusedInputs();
  }

  renameScene(name: string, nextName: string): void {
    const clean = nextName.trim();
    if (!clean || clean === name) return;
    if (this.nameTaken(clean)) throw new Error("name-taken");
    const scene = this.requireScene(name);
    const reported = scene.name;
    scene.name = clean;
    this.engineNames.set(reported, clean);
    this.scenes.delete(name);
    this.scenes.set(clean, scene);
    const unavailable = this.unavailableItems.get(name);
    if (unavailable) {
      this.unavailableItems.delete(name);
      this.unavailableItems.set(clean, unavailable);
    }
    this.sceneOrder = this.sceneOrder.map((entry) => (entry === name ? clean : entry));
    for (const key of [...this.locked]) {
      if (key.startsWith(`${name}\u0000`)) {
        this.locked.delete(key);
        this.locked.add(`${clean}\u0000${key.slice(name.length + 1)}`);
      }
    }
    if (this.active === name) this.active = clean;
  }

  setActiveScene(name: string): void {
    const scene = this.requireScene(name);
    this.osn.Global.setOutputSource(0, scene);
    this.active = name;
  }

  // ----- sources ------------------------------------------------------------

  availableKinds(): SourceKind[] {
    return availableSourceKinds(this.osn.InputFactory.types());
  }

  sourceChoices(sceneName: string): SourceChoiceDTO[] {
    this.requireScene(sceneName);
    const inputs = [...this.inputs].map(([name, { kind }]) => ({ name, kind }));
    const scenes = this.sceneOrder.filter((name) => !this.referencesScene(name, sceneName)).map((name) => ({ name, kind: "scene" as const }));
    return [...inputs, ...scenes];
  }

  addExistingSource(sceneName: string, sourceName: string): string {
    const scene = this.requireScene(sceneName);
    const nested = this.scenes.get(sourceName);
    if (nested && this.referencesScene(sourceName, sceneName)) throw new Error("scene-cycle");
    const source = nested?.source ?? this.requireInput(sourceName).input;
    const item = scene.add(source);
    if (nested) this.transform(item, "fit");
    return sourceName;
  }

  /** `extraSettings` lets the caller supply values only it knows (e.g. the overlay URL). */
  addSource(sceneName: string, kind: SourceKind, name: string, extraSettings: Record<string, unknown> = {}): string {
    const scene = this.requireScene(sceneName);
    const { baseWidth, baseHeight } = this.engine.settings;
    const inputId = this.resolveInputId(kind);
    const clean = this.uniqueName(name.trim() || kind);
    const settings = { ...initialSettings(kind, inputId, baseWidth, baseHeight), ...extraSettings };
    const input = this.osn.InputFactory.create(inputId, clean, settings);
    this.inputs.set(clean, { input, kind });
    if (AUDIO_ONLY.includes(kind)) {
      // Audio-only sources still live in a scene so they follow scene switches.
      scene.add(input);
      return clean;
    }
    const item = scene.add(input);
    if (VISUAL_KINDS.includes(kind)) this.transform(item, "fit");
    if (kind === "overlay") {
      // Library overlays are authored at 1080p; scale to the canvas. Full-canvas
      // designs fill it, smaller ones start centered.
      const scale = baseHeight / 1080;
      const width = Number(settings.width) || 800;
      const height = Number(settings.height) || 600;
      item.deferUpdateBegin();
      item.alignment = ALIGN_TOP_LEFT;
      item.scale = { x: scale, y: scale };
      item.position = { x: Math.max(0, (baseWidth - width * scale) / 2), y: Math.max(0, (baseHeight - height * scale) / 2) };
      item.deferUpdateEnd();
    }
    if (kind === "chatOverlay") {
      // Bottom-left corner, sized relative to a 1080p canvas.
      const scale = baseHeight / 1080;
      item.deferUpdateBegin();
      item.alignment = ALIGN_TOP_LEFT;
      item.scale = { x: scale, y: scale };
      item.position = { x: CHAT_OVERLAY_MARGIN * scale, y: baseHeight - (CHAT_OVERLAY_SIZE.height + CHAT_OVERLAY_MARGIN) * scale };
      item.deferUpdateEnd();
    }
    return clean;
  }

  /** Applies a library overlay's new size to every source showing it. */
  resizeOverlaySources(overlayId: string, width: number, height: number): number {
    let updated = 0;
    for (const { input, kind } of this.inputs.values()) {
      if (kind !== "overlay" || !String(input.settings.url ?? "").includes(`/overlay/o/${overlayId}`)) continue;
      input.update({ width, height });
      updated += 1;
    }
    return updated;
  }

  /** Points every overlay source (chat and library) at the overlay server's current address. */
  retargetChatOverlays(origin: string): number {
    let updated = 0;
    for (const { input, kind } of this.inputs.values()) {
      if (kind !== "chatOverlay" && kind !== "overlay") continue;
      const current = String(input.settings.url ?? "");
      let next: string;
      try {
        const url = new URL(current);
        next = `${origin}${url.pathname}${url.search}`;
      } catch {
        // Not a parseable URL yet (e.g. about:blank): use the default overlay page.
        next = `${origin}/overlay/chat`;
      }
      if (next !== current) {
        input.update({ url: next });
        updated += 1;
      }
    }
    return updated;
  }

  removeSceneItem(sceneName: string, itemId: number): void {
    const item = this.requireItem(sceneName, itemId);
    this.locked.delete(lockKey(sceneName, itemId));
    item.remove();
    this.releaseUnusedInputs();
  }

  setItemVisible(sceneName: string, itemId: number, visible: boolean): void {
    this.requireItem(sceneName, itemId).visible = visible;
  }

  setItemLocked(sceneName: string, itemId: number, locked: boolean): void {
    this.requireItem(sceneName, itemId);
    if (locked) this.locked.add(lockKey(sceneName, itemId));
    else this.locked.delete(lockKey(sceneName, itemId));
  }

  moveSceneItem(sceneName: string, itemId: number, direction: "up" | "down"): void {
    const item = this.requireItem(sceneName, itemId);
    // "Up" in the list means drawn above, i.e. later in engine order.
    if (direction === "up") item.moveUp();
    else item.moveDown();
  }

  applyTransform(sceneName: string, itemId: number, preset: TransformPreset): void {
    if (this.locked.has(lockKey(sceneName, itemId))) throw new Error("item-locked");
    this.transform(this.requireItem(sceneName, itemId), preset);
  }

  getItemTransform(sceneName: string, itemId: number): SourceTransformDTO {
    const item = this.requireItem(sceneName, itemId);
    if (!(item.source.outputFlags & 1)) throw new Error("source-transform-unavailable");
    const sourceWidth = item.source.width;
    const sourceHeight = item.source.height;
    const crop = { ...item.crop };
    const bounded = item.boundsType !== BOUNDS_NONE;
    const pixels = (value: number) => Math.round(value * 1000) / 1000;
    const anchor = (Object.entries(TRANSFORM_ANCHORS).find(([, value]) => value === item.alignment)?.[0] ?? "topLeft") as TransformAnchor;
    return {
      sourceName: this.nameOf(item.source), sourceWidth, sourceHeight,
      locked: this.locked.has(lockKey(sceneName, itemId)),
      x: pixels(item.position.x), y: pixels(item.position.y),
      width: pixels(Math.max(1, bounded ? item.bounds.x : (sourceWidth - crop.left - crop.right) * Math.abs(item.scale.x))),
      height: pixels(Math.max(1, bounded ? item.bounds.y : (sourceHeight - crop.top - crop.bottom) * Math.abs(item.scale.y))),
      rotation: pixels(((item.rotation + 180) % 360 + 360) % 360 - 180),
      sizing: item.boundsType === BOUNDS_SCALE_INNER ? "fit" : item.boundsType === BOUNDS_STRETCH ? "stretch" : "scale",
      anchor, crop,
    };
  }

  setItemTransform(sceneName: string, itemId: number, value: SourceTransform): void {
    if (this.locked.has(lockKey(sceneName, itemId))) throw new Error("item-locked");
    const item = this.requireItem(sceneName, itemId);
    if (!(item.source.outputFlags & 1)) throw new Error("source-transform-unavailable");
    validateTransform(value, item.source.width, item.source.height);
    const before = {
      position: { ...item.position }, scale: { ...item.scale }, rotation: item.rotation,
      alignment: item.alignment, boundsType: item.boundsType, boundsAlignment: item.boundsAlignment,
      bounds: { ...item.bounds }, crop: { ...item.crop },
    };
    item.deferUpdateBegin();
    try {
      item.crop = { ...value.crop };
      item.alignment = TRANSFORM_ANCHORS[value.anchor];
      item.position = { x: value.x, y: value.y };
      item.rotation = value.rotation;
      item.boundsAlignment = ALIGN_CENTER;
      item.boundsType = value.sizing === "fit" ? BOUNDS_SCALE_INNER : value.sizing === "stretch" ? BOUNDS_STRETCH : BOUNDS_NONE;
      if (value.sizing === "scale") {
        item.scale = { x: value.width / (item.source.width - value.crop.left - value.crop.right) * Math.sign(before.scale.x || 1), y: value.height / (item.source.height - value.crop.top - value.crop.bottom) * Math.sign(before.scale.y || 1) };
      } else {
        item.bounds = { x: value.width, y: value.height };
      }
    } catch (error) {
      Object.assign(item, before);
      throw error;
    } finally {
      item.deferUpdateEnd();
    }
  }

  readiness(volumeOf: (name: string) => number | undefined): SceneReadiness {
    const result: SceneReadiness = { scene: this.active, pictureSources: 0, pendingSources: 0, audibleSources: 0, missingSources: 0 };
    const sound = new Set<string>();
    const missing = new Set<string>();
    const visited = new Set<string>();
    const addAudio = (name: string, input: IInput) => {
      if ((input.outputFlags & OUTPUT_FLAG_AUDIO) && !input.muted && (volumeOf(name) ?? 1) > 0) sound.add(name);
    };
    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);
      for (const saved of this.unavailableItems.get(name) ?? []) if (saved.visible) missing.add(saved.source);
      for (const item of this.requireScene(name).getItems()) {
        if (!item.visible) continue;
        const sourceName = this.nameOf(item.source);
        if (this.scenes.has(sourceName)) { visit(sourceName); continue; }
        addAudio(sourceName, item.source);
        if (!(item.source.outputFlags & 1)) continue;
        if (item.source.width <= 0 || item.source.height <= 0) { result.pendingSources += 1; continue; }
        const isTransparent = item.source.id === "color_source_v3" && ((Number(item.source.settings.color) >>> 24) === 0);
        if (!isTransparent && onCanvas(this.getItemTransform(name, item.id), this.engine.settings.baseWidth, this.engine.settings.baseHeight)) result.pictureSources += 1;
      }
    };
    if (this.active) visit(this.active);
    for (const name of this.globalAudio.values()) {
      const input = this.inputs.get(name)?.input;
      if (input) addAudio(name, input);
      else if (this.unavailable.has(name)) missing.add(name);
    }
    result.audibleSources = sound.size;
    result.missingSources = missing.size;
    return result;
  }

  renameSource(name: string, nextName: string): void {
    const clean = nextName.trim();
    if (!clean || clean === name) return;
    if (this.nameTaken(clean)) throw new Error("name-taken");
    const entry = this.requireInput(name);
    const reported = entry.input.name;
    entry.input.name = clean;
    this.engineNames.set(reported, clean);
    this.inputs.delete(name);
    this.inputs.set(clean, entry);
    for (const [channel, source] of this.globalAudio) if (source === name) this.globalAudio.set(channel, clean);
  }

  /** Keeps every item's layout proportional when the canvas size changes. */
  rescale(from: { baseWidth: number; baseHeight: number }, to: { baseWidth: number; baseHeight: number }): void {
    const rx = to.baseWidth / from.baseWidth;
    const ry = to.baseHeight / from.baseHeight;
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || (rx === 1 && ry === 1)) return;
    for (const scene of this.scenes.values()) {
      for (const item of scene.getItems()) {
        item.deferUpdateBegin();
        item.position = { x: item.position.x * rx, y: item.position.y * ry };
        if (item.boundsType === BOUNDS_NONE) item.scale = { x: item.scale.x * rx, y: item.scale.y * ry };
        else item.bounds = { x: item.bounds.x * rx, y: item.bounds.y * ry };
        item.deferUpdateEnd();
      }
    }
  }

  input(name: string): IInput {
    return this.requireInput(name).input;
  }

  /** Every input that produces audio: global channels first, then scene sources. */
  audioInputs(): { name: string; input: IInput; global: boolean }[] {
    const globals = new Set(this.globalAudio.values());
    const result: { name: string; input: IInput; global: boolean }[] = [];
    for (const name of globals) {
      const entry = this.inputs.get(name);
      if (entry) result.push({ name, input: entry.input, global: true });
    }
    for (const [name, entry] of this.inputs) {
      if (globals.has(name)) continue;
      if ((entry.input.outputFlags & OUTPUT_FLAG_AUDIO) !== 0) result.push({ name, input: entry.input, global: false });
    }
    return result;
  }


  // ----- properties ---------------------------------------------------------

  getProperties(name: string): PropertyDTO[] {
    if (this.scenes.has(name)) return [];
    const input = this.input(name);
    const settings = input.settings;
    const result: PropertyDTO[] = [];
    let property: IProperty | undefined = input.properties.first();
    while (property) {
      const dto = toPropertyDTO(property, settings, input.id);
      if (dto && property.visible) result.push(dto);
      property = property.next();
    }
    return result;
  }

  updateSettings(name: string, settings: Record<string, unknown>): PropertyDTO[] {
    const input = this.input(name);
    input.update(settings);
    // Device/method changes can reveal dependent controls and repopulate lists.
    const properties = input.properties;
    for (const key of Object.keys(settings)) {
      const property = properties.get(key);
      // The binding accepts settings at runtime despite its no-argument declaration.
      if (property) (property.modified as (values: Record<string, unknown>) => boolean).call(property, input.settings);
    }
    return this.getProperties(name);
  }

  clickButton(name: string, propertyName: string): PropertyDTO[] {
    const input = this.input(name);
    const property = input.properties.get(propertyName) as IProperty & { buttonClicked?: (source: object) => void };
    property.buttonClicked?.(input);
    return this.getProperties(name);
  }

  // ----- persistence --------------------------------------------------------

  /** Volumes restored from disk, applied by the mixer when it attaches faders. */
  private readonly pendingVolumes = new Map<string, number>();

  takePendingVolume(name: string): number | undefined {
    const value = this.pendingVolumes.get(name);
    this.pendingVolumes.delete(name);
    return value;
  }

  save(volumeOf: (name: string) => number | undefined = () => undefined): SceneCollection {
    const scenes: Record<string, SavedItem[]> = {};
    for (const name of this.sceneOrder) {
      scenes[name] = this.requireScene(name)
        .getItems()
        .map((item) => ({
          source: this.nameOf(item.source),
          visible: item.visible,
          locked: this.locked.has(lockKey(name, item.id)),
          position: { x: item.position.x, y: item.position.y },
          scale: { x: item.scale.x, y: item.scale.y },
          rotation: item.rotation,
          alignment: item.alignment,
          boundsType: item.boundsType,
          boundsAlignment: item.boundsAlignment,
          bounds: { x: item.bounds.x, y: item.bounds.y },
          crop: { ...item.crop },
        }));
      scenes[name].push(...this.unavailableItems.get(name) ?? []);
    }
    const sources: SavedSource[] = [...this.inputs.entries()].map(([name, { input, kind }]) => ({
      name,
      kind,
      inputId: input.id,
      settings: input.settings,
      volume: volumeOf(name),
      muted: input.muted,
    }));
    sources.push(...this.unavailable.values());
    return {
      activeScene: this.active,
      sceneOrder: [...this.sceneOrder],
      scenes,
      sources,
      globalAudio: [...this.globalAudio.entries()].map(([channel, source]) => ({ channel, source })),
    };
  }

  load(collection: SceneCollection | null): void {
    if (!collection || collection.sceneOrder.length === 0) {
      this.createDefaultCollection();
      return;
    }
    const installed = new Set(this.osn.InputFactory.types());
    for (const saved of collection.sources) {
      if (!installed.has(saved.inputId)) {
        this.unavailable.set(saved.name, saved);
        continue;
      }
      try {
        const input = this.osn.InputFactory.create(saved.inputId, saved.name, saved.settings);
        if (typeof saved.volume === "number") this.pendingVolumes.set(saved.name, saved.volume);
        input.muted = saved.muted;
        this.inputs.set(saved.name, { input, kind: saved.kind });
      } catch {
        // Device loss or denied access must not prevent the studio from opening.
        // Keep its settings and items for restoration on the next launch.
        this.unavailable.set(saved.name, saved);
      }
    }
    // Create every scene before attaching items, including nested scenes.
    for (const name of collection.sceneOrder) {
      const scene = this.osn.SceneFactory.create(name);
      this.scenes.set(name, scene);
      this.sceneOrder.push(name);
    }
    for (const name of collection.sceneOrder) {
      const scene = this.requireScene(name);
      for (const saved of collection.scenes[name] ?? []) {
        const nested = this.scenes.get(saved.source);
        if (nested && this.referencesScene(saved.source, name)) continue;
        const source = nested?.source ?? this.inputs.get(saved.source)?.input;
        if (!source) {
          if (this.unavailable.has(saved.source)) this.unavailableItems.set(name, [...this.unavailableItems.get(name) ?? [], saved]);
          continue;
        }
        const item = scene.add(source);
        item.visible = saved.visible;
        item.position = saved.position;
        item.scale = saved.scale;
        item.rotation = saved.rotation;
        item.alignment = saved.alignment;
        item.boundsType = saved.boundsType;
        item.boundsAlignment = saved.boundsAlignment;
        item.bounds = saved.bounds;
        item.crop = saved.crop;
        if (saved.locked) this.locked.add(lockKey(name, item.id));
      }
    }
    for (const { channel, source } of collection.globalAudio) {
      const entry = this.inputs.get(source);
      if (entry) this.bindGlobalAudio(channel, entry.input);
      else if (this.unavailable.has(source)) this.globalAudio.set(channel, source);
    }
    const active = collection.activeScene && this.scenes.has(collection.activeScene) ? collection.activeScene : this.sceneOrder[0];
    this.setActiveScene(active);
  }


  // ----- internals ----------------------------------------------------------

  private createDefaultCollection(): void {
    this.createScene("Scene");
    for (const [kind, channel, name] of [
      ["desktopAudio", GLOBAL_DESKTOP_CHANNEL, "Desktop audio"],
      ["microphone", GLOBAL_MIC_CHANNEL, "Microphone"],
    ] as const) {
      try {
        const input = this.osn.InputFactory.create(this.resolveInputId(kind), name, {});
        this.inputs.set(name, { input, kind });
        this.bindGlobalAudio(channel, input);
      } catch (error) {
        console.warn(`[scenes] could not create default ${kind} source`, error);
      }
    }
  }

  private bindGlobalAudio(channel: number, input: IInput): void {
    this.osn.Global.setOutputSource(channel, input);
    this.globalAudio.set(channel, this.nameOf(input));
  }

  private transform(item: ISceneItem, preset: TransformPreset): void {
    const { baseWidth, baseHeight } = this.engine.settings;
    item.deferUpdateBegin();
    switch (preset) {
      case "fit":
      case "stretch":
        item.rotation = 0;
        item.alignment = ALIGN_TOP_LEFT;
        item.position = { x: 0, y: 0 };
        item.boundsType = preset === "fit" ? BOUNDS_SCALE_INNER : BOUNDS_STRETCH;
        item.boundsAlignment = ALIGN_CENTER;
        item.bounds = { x: baseWidth, y: baseHeight };
        break;
      case "center": {
        const width = item.boundsType === BOUNDS_NONE ? item.source.width * item.scale.x : item.bounds.x;
        const height = item.boundsType === BOUNDS_NONE ? item.source.height * item.scale.y : item.bounds.y;
        item.alignment = ALIGN_TOP_LEFT;
        item.position = { x: (baseWidth - width) / 2, y: (baseHeight - height) / 2 };
        break;
      }
      case "reset":
        item.boundsType = BOUNDS_NONE;
        item.alignment = ALIGN_TOP_LEFT;
        item.position = { x: 0, y: 0 };
        item.scale = { x: 1, y: 1 };
        item.rotation = 0;
        item.crop = { left: 0, right: 0, top: 0, bottom: 0 };
        break;
    }
    item.deferUpdateEnd();
  }

  private resolveInputId(kind: SourceKind): string {
    const found = resolveSourceType(kind, this.osn.InputFactory.types());
    if (!found) throw new Error("source-unavailable");
    return found;
  }

  private referencesScene(from: string, target: string, visited = new Set<string>()): boolean {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return this.scenes.get(from)?.getItems().some((item) => this.referencesScene(this.nameOf(item.source), target, visited)) ?? false;
  }

  /** Sources not referenced by any scene or global channel are released. */
  private releaseUnusedInputs(): void {
    const used = new Set(this.globalAudio.values());
    for (const scene of this.scenes.values()) for (const item of scene.getItems()) used.add(this.nameOf(item.source));
    for (const [name, { input }] of [...this.inputs]) {
      if (used.has(name)) continue;
      input.release();
      this.inputs.delete(name);
    }
  }

  private nameTaken(name: string): boolean {
    // Names the engine still reports for renamed sources stay reserved.
    return this.scenes.has(name) || this.inputs.has(name) || this.unavailable.has(name) || this.engineNames.has(name);
  }

  /** Current name for a name reported by the engine (see engineNames). */
  nameOf(source: { name: string }): string {
    return this.engineNames.get(source.name) ?? source.name;
  }

  private uniqueName(base: string): string {
    if (!this.nameTaken(base)) return base;
    let index = 2;
    while (this.nameTaken(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  private requireScene(name: string): IScene {
    const scene = this.scenes.get(name);
    if (!scene) throw new Error("scene-not-found");
    return scene;
  }

  private requireItem(sceneName: string, itemId: number): ISceneItem {
    const item = this.requireScene(sceneName).findItem(itemId);
    if (!item) throw new Error("item-not-found");
    return item;
  }

  private requireInput(name: string): { input: IInput; kind: SourceKind | "other" } {
    const entry = this.inputs.get(name);
    if (!entry) throw new Error("source-not-found");
    return entry;
  }
}

function lockKey(scene: string, itemId: number): string {
  return `${scene}\u0000${itemId}`;
}

function toPropertyDTO(property: IProperty, settings: Record<string, unknown>, inputId: string): PropertyDTO | null {
  const base = {
    name: property.name,
    label: property.description || property.name,
    enabled: property.enabled,
    value: settings[property.name] ?? property.value,
  };
  const details = (property as IProperty & { details?: Record<string, unknown> }).details ?? {};
  let kind: PropertyKind;
  switch (property.type) {
    case P.Boolean:
      kind = "boolean";
      break;
    case P.Int:
    case P.Float:
      return {
        ...base,
        kind: property.type === P.Int ? "int" : "float",
        min: Number(details.min ?? 0),
        max: Number(details.max ?? 0),
        step: Number(details.step ?? 1),
      };
    case P.Text: {
      const textType = Number(details.type ?? 0);
      kind = textType === 1 ? "password" : textType === 2 ? "multiline" : textType === 3 ? "info" : "text";
      if (kind === "info") return { ...base, kind, value: property.description };
      break;
    }
    case P.Path:
      return {
        ...base,
        kind: "path",
        pathFilter: typeof details.filter === "string" ? details.filter : undefined,
        directory: Number(details.type) === 2,
      };
    case P.List: {
      const items = Array.isArray(details.items) ? (details.items as { name: string; value: string | number }[]) : [];
      return { ...base, kind: "list", options: items.map((item) => ({ label: item.name, value: item.value })) };
    }
    case P.Font:
      return { ...base, kind: "font" };
    case P.EditableList:
      return { ...base, kind: "editableList", pathFilter: typeof details.filter === "string" ? details.filter : undefined, allowUrls: Number(details.type) !== 1 };
    case P.Color:
    case P.ColorAlpha:
      // The binding reports the current color source's alpha control as Color.
      return { ...base, kind: "color", allowAlpha: property.type === P.ColorAlpha || inputId === "color_source_v3" };
    case P.Button:
      kind = "button";
      break;
    default:
      // Frame rates, groups and platform-specific capture pickers are not
      // editable from the generic panel yet; their current value is preserved.
      return null;
  }
  return { ...base, kind };
}
