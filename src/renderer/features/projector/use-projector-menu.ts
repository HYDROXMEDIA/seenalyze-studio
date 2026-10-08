import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { NativeMenuItem } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import type { ProjectorTarget, ScreenChoice } from "../../../shared/types";

/** Screens a projector can fill, refreshed whenever the window gets focus. */
function useScreens(): ScreenChoice[] {
  const [screens, setScreens] = useState<ScreenChoice[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      studio
        .listScreens()
        .then((next) => {
          if (!cancelled) setScreens(next);
        })
        .catch(console.error);
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, []);
  return screens;
}

/**
 * Menu rows that open a projector for a target: in a window, or filling a
 * screen (one row per screen when there are several).
 */
export function useProjectorMenu(): (target: ProjectorTarget, label?: (kind: "window" | "screen", screen?: string) => string) => NativeMenuItem[] {
  const t = useTranslations("projector");
  const run = useAction();
  const screens = useScreens();
  return useCallback(
    (target, label) => {
      const open = (screenId: number | null) => void run(() => studio.openProjector(target, screenId));
      const windowLabel = label ? label("window") : t("open");
      const screenRows = screens.map((screen) => ({
        label: label ? label("screen", screens.length > 1 ? screen.label : undefined) : screens.length > 1 ? t("fullscreenOn", { screen: screen.label }) : t("fullscreen"),
        onSelect: () => open(screen.id),
      }));
      return [{ label: windowLabel, onSelect: () => open(null) }, ...screenRows];
    },
    [run, screens, t],
  );
}
