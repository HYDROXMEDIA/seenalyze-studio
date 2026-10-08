import { create } from "zustand";
import type { ItemPlacement } from "../../shared/types";
import type { EffectSnapshot } from "../../shared/video-effects";

/** In-app clipboard for "Copy transform" and "Copy effects" (kept for the session). */
interface ClipboardStore {
  placement: ItemPlacement | null;
  effects: EffectSnapshot[] | null;
  copyPlacement: (placement: ItemPlacement) => void;
  copyEffects: (effects: EffectSnapshot[]) => void;
}

export const useClipboard = create<ClipboardStore>((set) => ({
  placement: null,
  effects: null,
  copyPlacement: (placement) => set({ placement }),
  copyEffects: (effects) => set({ effects }),
}));
