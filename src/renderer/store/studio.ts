import { useEffect } from "react";
import { create } from "zustand";
import { studio } from "@/lib/studio";
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
  /** Number of open modal overlays that cover the native preview. */
  overlays: number;
  /** Number of open anchored popups (menus, selects); they hide the preview only where they overlap it. */
  poppers: number;
  setSnapshot: (snapshot: StudioSnapshot) => void;
  setStats: (stats: EngineStats) => void;
  setLevels: (levels: AudioLevel[]) => void;
  selectItem: (id: number | null) => void;
  pushOverlay: (kind?: OcclusionKind) => void;
  popOverlay: (kind?: OcclusionKind) => void;
}

/** "modal" always hides the preview; "popper" only while it overlaps it. */
export type OcclusionKind = "modal" | "popper";

export const useStudio = create<StudioStore>((set, get) => ({
  view: "studio",
  setView: (view) => set({ view }),
  snapshot: null,
  stats: null,
  levels: {},
  selectedItemId: null,
  overlays: 0,
  poppers: 0,
  // The main process owns the selection so every window agrees on it.
  setSnapshot: (snapshot) => set({ snapshot, selectedItemId: snapshot.selectedItemId ?? null }),
  setStats: (stats) => set({ stats }),
  setLevels: (levels) =>
    set((state) => {
      const next = { ...state.levels };
      for (const level of levels) next[level.name] = level.peak;
      return { levels: next };
    }),
  selectItem: (selectedItemId) => {
    if (get().selectedItemId === selectedItemId) return;
    set({ selectedItemId });
    const scene = get().snapshot?.activeScene;
    if (scene) studio.setSelectedItem(scene, selectedItemId).catch(() => undefined);
  },
  pushOverlay: (kind = "modal") =>
    set((state) => (kind === "popper" ? { poppers: state.poppers + 1 } : { overlays: state.overlays + 1 })),
  popOverlay: (kind = "modal") =>
    set((state) => (kind === "popper" ? { poppers: Math.max(0, state.poppers - 1) } : { overlays: Math.max(0, state.overlays - 1) })),
}));

/**
 * The live preview is a native surface that HTML cannot draw over. Any overlay
 * calls this while mounted so the preview steps aside until it closes.
 */
export function usePreviewOcclusion(active = true, kind: OcclusionKind = "modal"): void {
  const pushOverlay = useStudio((state) => state.pushOverlay);
  const popOverlay = useStudio((state) => state.popOverlay);
  useEffect(() => {
    if (!active) return;
    pushOverlay(kind);
    return () => popOverlay(kind);
  }, [active, kind, pushOverlay, popOverlay]);
}
