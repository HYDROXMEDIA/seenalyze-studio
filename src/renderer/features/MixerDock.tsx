import { Settings2Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { memo, useState } from "react";
import { useTranslations } from "use-intl";
import { Dock, DockEmpty } from "@/components/Dock";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/form";
import systemIcon from "@/assets/icons/system_desktop.png";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { SourcePropertiesDialog } from "./SourcePropertiesDialog";

const MIN_DB = -60;

export function MixerDock() {
  const t = useTranslations("mixer");
  const audio = useStudio((state) => state.snapshot?.audio ?? []);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Dock title={t("title")}>
      {audio.length === 0 ? (
        <DockEmpty icon={systemIcon} text={t("empty")} />
      ) : (
        <div className="grid gap-3 p-3">
          {audio.map((source) => (
            <MixerChannel key={source.name} name={source.name} deflection={source.deflection} muted={source.muted} onProperties={setEditing} />
          ))}
        </div>
      )}
      <SourcePropertiesDialog source={editing} onClose={() => setEditing(null)} />
    </Dock>
  );
}

const MixerChannel = memo(function MixerChannel({ name, deflection, muted, onProperties }: { name: string; deflection: number; muted: boolean; onProperties: (name: string) => void }) {
  const t = useTranslations("mixer");
  const run = useAction();
  const peak = useStudio((state) => state.levels[name]);
  const level = peak && peak.length > 0 ? Math.max(...peak) : MIN_DB;
  const percent = muted ? 0 : Math.min(100, Math.max(0, ((level - MIN_DB) / -MIN_DB) * 100));

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate">{name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{muted ? t("muted") : `${Math.round(deflection * 100)}%`}</span>
        <Button variant="ghost" size="icon-sm" aria-label={t("properties", { name })} onClick={() => onProperties(name)}><Settings2Icon /></Button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn("h-full rounded-full transition-[width] duration-75", percent > 90 ? "bg-red-500" : percent > 70 ? "bg-yellow-400" : "bg-brand-green")}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[deflection]}
          aria-label={t("volume", { name })}
          onValueChange={([value]) => void run(() => studio.setVolume(name, value))}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={muted ? t("unmute", { name }) : t("mute", { name })}
          aria-pressed={muted}
          onClick={() => void run(() => studio.setMuted(name, !muted))}
        >
          {muted ? <VolumeXIcon className="text-red-500" /> : <Volume2Icon />}
        </Button>
      </div>
    </div>
  );
});
