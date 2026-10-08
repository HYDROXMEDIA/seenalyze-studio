// Video effects on a source: libobs video filters (chroma key, color
// correction, crop, LUT, …) added, edited, reordered and removed, plus their
// save/restore with the scene collection. Filters that are not video effects
// (for example audio filters) are left untouched.

import type { PropertyDTO } from "../../shared/types";
import {
  availableEffectKinds,
  EFFECT_SPECS,
  effectKindOf,
  effectName,
  resolveEffectType,
  sanitizeEffectSnapshots,
  type EffectDTO,
  type EffectKind,
  type EffectList,
  type EffectSnapshot,
} from "../../shared/video-effects";
import type { IFilter, IInput, OSN } from "./osn";
import { toPropertyDTO } from "./scenes";

/** ESourceOutputFlags.Video */
const OUTPUT_FLAG_VIDEO = 1;
/** EOrderMovement */
const ORDER_UP = 0;
const ORDER_DOWN = 1;

export class VideoEffects {
  constructor(private readonly osn: OSN) {}

  available(): EffectKind[] {
    return availableEffectKinds(this.osn.FilterFactory.types());
  }

  list(input: IInput): EffectList {
    return { available: this.available(), effects: effectsOf(input) };
  }

  add(input: IInput, kind: EffectKind): EffectList {
    requireVideo(input);
    this.create(input, { kind, enabled: true, settings: { ...EFFECT_SPECS[kind].defaults } });
    return this.list(input);
  }

  remove(input: IInput, name: string): EffectList {
    // The source drops its reference; the filter is freed with it.
    input.removeFilter(requireEffect(input, name));
    return this.list(input);
  }

  setEnabled(input: IInput, name: string, enabled: boolean): EffectList {
    requireEffect(input, name).enabled = enabled;
    return this.list(input);
  }

  /** Moves an effect one place among the video effects ("up" = applied earlier). */
  move(input: IInput, name: string, direction: "up" | "down"): EffectList {
    const filter = requireEffect(input, name);
    const effects = effectsOf(input).map((effect) => effect.name);
    const index = effects.indexOf(name);
    const neighbour = effects[direction === "up" ? index - 1 : index + 1];
    if (neighbour === undefined) return this.list(input);
    // Other filters (audio) may sit in between; step until the neighbour is
    // passed. The list is read back after every step, so a binding that
    // orders the other way round is detected and corrected.
    const position = (entry: string) => filtersOf(input).findIndex((filter) => filter.name === entry);
    let movement = direction === "up" ? ORDER_UP : ORDER_DOWN;
    let flipped = false;
    for (let step = 0, limit = 2 * filtersOf(input).length + 2; step < limit; step += 1) {
      const before = position(name);
      const target = position(neighbour);
      if (direction === "up" ? before < target : before > target) break;
      input.setFilterOrder(filter, movement);
      const after = position(name);
      if (after !== before && (after < before) === (direction === "up")) continue;
      // Stuck at the end or moved away: the binding counts the other way round.
      if (flipped) break;
      flipped = true;
      movement = movement === ORDER_UP ? ORDER_DOWN : ORDER_UP;
      if (after !== before) input.setFilterOrder(filter, movement);
    }
    return this.list(input);
  }

  properties(input: IInput, name: string): PropertyDTO[] {
    return propertiesOf(requireEffect(input, name));
  }

  update(input: IInput, name: string, settings: Record<string, unknown>): PropertyDTO[] {
    const filter = requireEffect(input, name);
    filter.update(settings);
    // Some choices reveal dependent controls (e.g. a custom key color).
    const properties = filter.properties;
    for (const key of Object.keys(settings)) {
      const property = properties.get(key);
      // The binding accepts settings at runtime despite its no-argument declaration.
      if (property) (property.modified as (values: Record<string, unknown>) => boolean).call(property, filter.settings);
    }
    return propertiesOf(filter);
  }

  /** The source's effects with their settings, for saving, copying or duplicating. */
  snapshot(input: IInput): EffectSnapshot[] {
    return filtersOf(input).flatMap((filter) => {
      const kind = effectKindOf(filter.id);
      return kind ? [{ kind, enabled: filter.enabled, settings: { ...filter.settings } }] : [];
    });
  }

  /** Appends effects to a source; effects this engine cannot apply are skipped. */
  restore(input: IInput, effects: unknown): void {
    const clean = sanitizeEffectSnapshots(effects);
    if (clean.length === 0) return;
    requireVideo(input);
    for (const effect of clean) {
      try {
        this.create(input, effect);
      } catch (error) {
        console.warn(`[effects] could not restore ${effect.kind}`, error);
      }
    }
  }

  private create(input: IInput, effect: EffectSnapshot): void {
    const type = resolveEffectType(effect.kind, this.osn.FilterFactory.types());
    if (!type) throw new Error("effect-unavailable");
    const name = effectName(effect.kind, filtersOf(input).map((filter) => filter.name));
    const filter = this.osn.FilterFactory.create(type, name, effect.settings);
    if (!filter) throw new Error("effect-unavailable");
    filter.enabled = effect.enabled;
    input.addFilter(filter);
    // The source now holds its own reference; drop the one from create.
    filter.release();
  }
}

function effectsOf(input: IInput): EffectDTO[] {
  return filtersOf(input).flatMap((filter) => {
    const kind = effectKindOf(filter.id);
    return kind ? [{ name: filter.name, kind, enabled: filter.enabled }] : [];
  });
}

/** The source's filters in the order they are applied. */
function filtersOf(input: IInput): IFilter[] {
  const filters = input.filters as IFilter[] | undefined;
  return Array.isArray(filters) ? filters : [];
}

function requireVideo(input: IInput): void {
  if (!(input.outputFlags & OUTPUT_FLAG_VIDEO)) throw new Error("effects-unsupported");
}

function requireEffect(input: IInput, name: string): IFilter {
  const filter = filtersOf(input).find((entry) => entry.name === name);
  if (!filter || !effectKindOf(filter.id)) throw new Error("effect-not-found");
  return filter;
}

function propertiesOf(filter: IFilter): PropertyDTO[] {
  const settings = filter.settings;
  const result: PropertyDTO[] = [];
  let property = filter.properties.first();
  while (property) {
    const dto = toPropertyDTO(property, settings, filter.id);
    if (dto && property.visible) result.push(dto);
    property = property.next();
  }
  return result;
}
