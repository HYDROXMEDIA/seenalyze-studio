import { useEffect } from "react";
import { create } from "zustand";
import type { AudioLevel, EngineStats, StudioSnapshot } from "../../shared/types";

export type View = "studio" | "settings" | "overlays";

interface StudioStore {
  view: View;
  setView: (view: View) => void;
  snapshot: StudioSnapshot | null;
  stats: EngineStats | null;
  levels: Record<string, number[]>;
  /** Selected scene item in the active scene. */
  selectedItemId: number | null;
  /** Number of open overlays that would sit above the native preview. */
  overlays: number;
  setSnapshot: (snapshot: StudioSnapshot) => void;
  setStats: (stats: EngineStats) => void;
  setLevels: (levels: AudioLevel[]) => void;
  selectItem: (id: number | null) => void;
  pushOverlay: () => void;
  popOverlay: () => void;
}

export const useStudio = create<StudioStore>((set) => ({
  view: "studio",
  setView: (view) => set({ view }),
  snapshot: null,
  stats: null,
  levels: {},
  selectedItemId: null,
  overlays: 0,
  setSnapshot: (snapshot) => set({ snapshot }),
  setStats: (stats) => set({ stats }),
  setLevels: (levels) =>
    set((state) => {
      const next = { ...state.levels };
      for (const level of levels) next[level.name] = level.peak;
      return { levels: next };
    }),
  selectItem: (selectedItemId) => set({ selectedItemId }),
  pushOverlay: () => set((state) => ({ overlays: state.overlays + 1 })),
  popOverlay: () => set((state) => ({ overlays: Math.max(0, state.overlays - 1) })),
}));

/**
 * The live preview is a native surface that HTML cannot draw over. Any overlay
 * calls this while mounted so the preview steps aside until it closes.
 */
export function usePreviewOcclusion(active = true): void {
  const pushOverlay = useStudio((state) => state.pushOverlay);
  const popOverlay = useStudio((state) => state.popOverlay);
  useEffect(() => {
    if (!active) return;
    pushOverlay();
    return () => popOverlay();
  }, [active, pushOverlay, popOverlay]);
}
