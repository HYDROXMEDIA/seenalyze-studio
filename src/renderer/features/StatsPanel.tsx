import { useTranslations } from "use-intl";
import type { DestinationStatus } from "../../shared/types";
import { PlatformIcon } from "@/components/PlatformIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { isActive } from "./DestinationsDock";

/** Low free space where recordings are saved (about 10 minutes at a high recording bitrate). */
const LOW_DISK_MB = 5 * 1024;

export function droppedPercent(status: Pick<DestinationStatus, "droppedFrames" | "totalFrames">): number {
  return status.totalFrames > 0 ? (status.droppedFrames / status.totalFrames) * 100 : 0;
}

/** Header statistics; opens a panel with the full numbers. */
export function StatsButton() {
  const t = useTranslations("header");
  const stats = useStudio((state) => state.stats);
  if (!stats) return null;
  return (
    <Popover>
      <PopoverTrigger
        className="app-no-drag flex items-center gap-4 rounded-md px-2 py-1 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={t("statsOpen")}
      >
        <span>{t("cpu", { value: stats.cpu.toFixed(1) })}</span>
        <span>{t("fps", { value: stats.fps.toFixed(0) })}</span>
        <span className={cn(stats.renderLagFrames > 0 && "text-yellow-500")}>{t("lagged", { value: stats.renderLagFrames })}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <StatsPanel />
      </PopoverContent>
    </Popover>
  );
}

function StatsPanel() {
  const t = useTranslations("stats");
  const stats = useStudio((state) => state.stats);
  const destinations = useStudio((state) => state.snapshot?.destinations ?? []);
  const statuses = useStudio((state) => state.snapshot?.destinationStatus ?? []);
  const recording = useStudio((state) => state.snapshot?.recording.active ?? false);
  if (!stats) return null;
  const lagPercent = stats.totalFrames > 0 ? (stats.renderLagFrames / stats.totalFrames) * 100 : 0;
  const streaming = statuses.filter((status) => isActive(status) || status.totalFrames > 0);
  const lowDisk = stats.diskFreeMb !== undefined && stats.diskFreeMb < LOW_DISK_MB;

  return (
    <div className="grid gap-4 text-sm">
      <h3 className="text-base font-semibold">{t("title")}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 tabular-nums">
        <Stat label={t("cpu")} value={t("percent", { value: stats.cpu.toFixed(1) })} />
        <Stat label={t("memory")} value={t("megabytes", { value: Math.round(stats.memoryMb) })} />
        <Stat label={t("fps")} value={stats.fps.toFixed(1)} />
        <Stat
          label={t("renderLag")}
          value={t("framesOf", { value: stats.renderLagFrames, total: stats.totalFrames, percent: lagPercent.toFixed(1) })}
          warn={stats.renderLagFrames > 0}
        />
        <Stat
          label={t("diskFree")}
          value={stats.diskFreeMb === undefined ? t("unknown") : t("gigabytes", { value: (stats.diskFreeMb / 1024).toFixed(1) })}
          warn={lowDisk}
        />
        <Stat label={t("recordingBitrate")} value={recording && stats.recordingKbps !== undefined ? t("kbps", { value: stats.recordingKbps }) : t("notRecording")} />
      </dl>

      <div className="grid gap-2">
        <h4 className="font-medium">{t("destinations")}</h4>
        {streaming.length === 0 ? (
          <p className="text-muted-foreground">{t("notStreaming")}</p>
        ) : (
          <ul className="grid gap-2">
            {streaming.map((status) => {
              const destination = destinations.find((entry) => entry.id === status.id);
              const percent = droppedPercent(status);
              return (
                <li key={status.id} className="flex items-center gap-2 tabular-nums">
                  {destination && <PlatformIcon platform={destination.platform} className="size-4" />}
                  <span className="min-w-0 flex-1 truncate">{destination?.name ?? status.id}</span>
                  <span className="text-muted-foreground">{t("kbps", { value: status.kbps })}</span>
                  <span className={cn(percent >= 1 && "text-yellow-600 dark:text-yellow-400")}>
                    {t("dropped", { value: status.droppedFrames, total: status.totalFrames, percent: percent.toFixed(1) })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", warn && "text-yellow-600 dark:text-yellow-400")}>{value}</dd>
    </div>
  );
}
