import { LayersIcon, MessagesSquareIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useChat } from "@/store/chat";
import appIcon from "@/assets/icons/seenalyze-app-icon.svg";
import { isMac } from "@/lib/studio";
import { COMPACT_HEADER_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { isActive } from "./DestinationsDock";
import { StatsButton } from "./StatsPanel";
import { StudioModeControls } from "./projector/StudioModeControls";

export function Header() {
  const t = useTranslations("header");
  const live = useStudio((state) => state.snapshot?.destinationStatus.some((status) => status.state === "live") ?? false);
  const connecting = useStudio((state) => state.snapshot?.destinationStatus.some((status) => isActive(status) && status.state !== "live") ?? false);
  const recording = useStudio((state) => state.snapshot?.recording.active ?? false);
  const view = useStudio((state) => state.view);
  const setView = useStudio((state) => state.setView);
  const chatOpen = useChat((state) => state.open);
  const setChatOpen = useChat((state) => state.setOpen);
  const compact = useMediaQuery(COMPACT_HEADER_QUERY);
  // Icon-only buttons explain themselves on hover; full-width ones already show their label.
  const tip = (label: string, button: ReactElement) => (compact ? <Tooltip label={label}>{button}</Tooltip> : button);

  return (
    <header className={cn("app-drag flex h-12 shrink-0 items-center gap-3 border-b px-4", isMac && "pl-20")}>
      <img src={appIcon} alt="" className="size-6 shrink-0 rounded-md" draggable={false} />
      <h1 className="truncate text-sm font-semibold max-[900px]:sr-only">{t("appName")}</h1>
      <div className="ml-2 flex shrink-0 items-center gap-2">
        {live && (
          <span className="flex items-center gap-1.5 rounded-md bg-live px-2 py-0.5 text-xs font-semibold text-white">
            <span className="size-1.5 rounded-full bg-white" aria-hidden />
            {t("live")}
          </span>
        )}
        {!live && connecting && <span className="text-xs text-muted-foreground">{t("connecting")}</span>}
        {recording && (
          <span className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-500">
            <span className="size-1.5 rounded-full bg-red-500" aria-hidden />
            {t("recording")}
          </span>
        )}
      </div>
      {/* Narrow windows: header buttons drop their labels (kept for screen readers) and the stats get shorter. */}
      <div className="ml-auto flex shrink-0 items-center gap-4 text-xs text-muted-foreground max-[1100px]:gap-2 tabular-nums">
        <StatsButton />
        {view === "studio" && <StudioModeControls />}
        {view === "studio" &&
          tip(
            t("overlays"),
            <Button variant="ghost" size="sm" className="app-no-drag" onClick={() => setView("overlays")}>
              <LayersIcon aria-hidden className="size-4" />
              <span className="max-[1100px]:sr-only">{t("overlays")}</span>
            </Button>,
          )}
        {view === "studio" &&
          tip(
            t("chat"),
            <Button
              variant={chatOpen ? "secondary" : "ghost"}
              size="sm"
              className="app-no-drag"
              aria-pressed={chatOpen}
              onClick={() => setChatOpen(!chatOpen)}
            >
              <MessagesSquareIcon aria-hidden className="size-4" />
              <span className="max-[1100px]:sr-only">{t("chat")}</span>
            </Button>,
          )}
      </div>
    </header>
  );
}
