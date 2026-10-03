import { LayersIcon, MessageSquareIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { useChat } from "@/store/chat";
import appIcon from "@/assets/icons/seenalyze-app-icon.png";
import { isMac } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { isActive } from "./DestinationsDock";

export function Header() {
  const t = useTranslations("header");
  const stats = useStudio((state) => state.stats);
  const live = useStudio((state) => state.snapshot?.destinationStatus.some((status) => status.state === "live") ?? false);
  const connecting = useStudio((state) => state.snapshot?.destinationStatus.some((status) => isActive(status) && status.state !== "live") ?? false);
  const recording = useStudio((state) => state.snapshot?.recording.active ?? false);
  const view = useStudio((state) => state.view);
  const setView = useStudio((state) => state.setView);
  const chatOpen = useChat((state) => state.open);
  const setChatOpen = useChat((state) => state.setOpen);

  return (
    <header className={cn("app-drag flex h-12 shrink-0 items-center gap-3 border-b px-4", isMac && "pl-20")}>
      <img src={appIcon} alt="" className="size-6 rounded-md" draggable={false} />
      <h1 className="text-sm font-semibold">{t("appName")}</h1>
      <div className="ml-2 flex items-center gap-2">
        {live && (
          <span className="flex items-center gap-1.5 rounded-md bg-live px-2 py-0.5 text-xs font-semibold text-white">
            <span className="size-1.5 rounded-full bg-white" aria-hidden />
            {t("live")}
          </span>
        )}
        {!live && connecting && <span className="text-xs text-muted-foreground">{t("connecting")}</span>}
        {recording && (
          <span className="flex items-center gap-1.5 text-xs text-red-500">
            <span className="size-1.5 rounded-full bg-red-500" aria-hidden />
            {t("recording")}
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
        {stats && (
          <>
            <span>{t("cpu", { value: stats.cpu.toFixed(1) })}</span>
            <span>{t("fps", { value: stats.fps.toFixed(0) })}</span>
            <span className={cn(stats.renderLagFrames > 0 && "text-yellow-500")}>{t("lagged", { value: stats.renderLagFrames })}</span>
          </>
        )}
        {view === "studio" && (
          <Button variant="ghost" size="sm" className="app-no-drag" onClick={() => setView("overlays")}>
            <LayersIcon />
            {t("overlays")}
          </Button>
        )}
        {view === "studio" && (
          <Button
            variant={chatOpen ? "secondary" : "ghost"}
            size="sm"
            className="app-no-drag"
            aria-pressed={chatOpen}
            onClick={() => setChatOpen(!chatOpen)}
          >
            <MessageSquareIcon />
            {t("chat")}
          </Button>
        )}
      </div>
    </header>
  );
}
