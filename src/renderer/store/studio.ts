import { useEffect } from "react";
import { create } from "zustand";
import { studio } from "@/lib/studio";
import type { AudioLevel, EngineStats, StudioSnapshot } from "../../shared/types";

export type View = "studio" | "settings" | "overlays";

interface StudioStore {
  view: View;
  setView: (view: View) => void;
  /** Settings section to show when the settings page opens next (for example from a "connect" button). */
  settingsSection: string | null;
  openSettings: (section?: string) => void;
  snapshot: StudioSnapshot | null;
  stats: EngineStats | null;
  levels: Record<string, number[]>;
  /** Selected scene item in the active scene. */
  selectedItemId: number | null;
  /** Number of open modal overlays that cover the native preview. */
  overlays: number;
  /** Number of open anchored popups (menus, selects); they hide the preview only where they overlap it. */
  poppers: number;
  /** Number of visible tooltips; like poppers they hide the preview only where they overlap it, but never block canvas shortcuts. */
  tooltips: number;
  setSnapshot: (snapshot: StudioSnapshot) => void;
  setStats: (stats: EngineStats) => void;
  setLevels: (levels: AudioLevel[]) => void;
  selectItem: (id: number | null) => void;
  /** A source menu opened by right-clicking the preview, at window CSS pixels. */
  sourceMenu: { itemId: number; x: number; y: number } | null;
  setSourceMenu: (menu: { itemId: number; x: number; y: number } | null) => void;
  pushOverlay: (kind?: OcclusionKind) => void;
  popOverlay: (kind?: OcclusionKind) => void;
}

/** "modal" always hides the preview; "popper" and "tooltip" only while they overlap it. */
export type OcclusionKind = "modal" | "popper" | "tooltip";

const OCCLUSION_COUNTER = { modal: "overlays", popper: "poppers", tooltip: "tooltips" } as const;

export const useStudio = create<StudioStore>((set, get) => ({
  view: "studio",
  setView: (view) => set({ view }),
  settingsSection: null,
  openSettings: (section) => set({ view: "settings", settingsSection: section ?? null }),
  snapshot: null,
  stats: null,
  levels: {},
  selectedItemId: null,
  overlays: 0,
  poppers: 0,
  tooltips: 0,
  sourceMenu: null,
  setSourceMenu: (sourceMenu) => set({ sourceMenu }),
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
    if (scene) studio.setSelectedItem(scene, selectedItemId).catch((error: unknown) => console.error("[studio] selection could not be shared", error));
  },
  pushOverlay: (kind = "modal") => set((state) => ({ [OCCLUSION_COUNTER[kind]]: state[OCCLUSION_COUNTER[kind]] + 1 })),
  popOverlay: (kind = "modal") => set((state) => ({ [OCCLUSION_COUNTER[kind]]: Math.max(0, state[OCCLUSION_COUNTER[kind]] - 1) })),
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
