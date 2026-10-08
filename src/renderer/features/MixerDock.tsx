import { AudioLinesIcon, CheckIcon, MicIcon, Settings2Icon, SlidersHorizontalIcon, SpeakerIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { AudioDeviceChoice } from "../../shared/audio";
import { Dock, DockEmpty } from "@/components/Dock";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { deflectionToDb, formatDb, MIN_DB, meterChannels, meterDeflection } from "@/lib/audio-meter";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { AudioSettingsDialog } from "./AudioSettingsDialog";
import { SourcePropertiesDialog } from "./SourcePropertiesDialog";

/** Release speed of the meter after a peak, as in broadcast meters. */
const DECAY_DB_PER_SECOND = 20;

/** Instant attack, steady release per channel, so the bars follow the real level without flicker. */
function useMeterLevels(peak: number[] | undefined): number[] {
  const raw = meterChannels(peak);
  const [shown, setShown] = useState(raw);
  const last = useRef<{ db: number[]; at: number }>({ db: [], at: 0 });
  useEffect(() => {
    const now = performance.now();
    const fall = ((now - last.current.at) / 1000) * DECAY_DB_PER_SECOND;
    const next = meterChannels(peak).map((db, channel) => Math.max(db, (last.current.db[channel] ?? MIN_DB) - fall, MIN_DB));
    last.current = { db: next, at: now };
    setShown(next);
  }, [peak]);
  return shown;
}

export function MixerDock() {
  const t = useTranslations("mixer");
  const audio = useStudio((state) => state.snapshot?.audio ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  const [tuning, setTuning] = useState<string | null>(null);
  const tuningMicrophone = audio.find((source) => source.name === tuning)?.microphone ?? false;

  return (
    <Dock title={t("title")}>
      {audio.length === 0 ? (
        <DockEmpty icon={SlidersHorizontalIcon} text={t("empty")} />
      ) : (
        <div className="grid gap-4 p-3">
          {audio.map((source) => (
            <MixerChannel
              key={source.name}
              name={source.name}
              deflection={source.deflection}
              muted={source.muted}
              global={source.global}
              microphone={source.microphone}
              onProperties={setEditing}
              onAudioSettings={setTuning}
            />
          ))}
        </div>
      )}
      <SourcePropertiesDialog source={editing} onClose={() => setEditing(null)} />
      <AudioSettingsDialog source={tuning} microphone={tuningMicrophone} onClose={() => setTuning(null)} />
    </Dock>
  );
}

const MixerChannel = memo(function MixerChannel({
  name,
  deflection,
  muted,
  global,
  microphone,
  onProperties,
  onAudioSettings,
}: {
  name: string;
  deflection: number;
  muted: boolean;
  global: boolean;
  microphone: boolean;
  onProperties: (name: string) => void;
  onAudioSettings: (name: string) => void;
}) {
  const t = useTranslations("mixer");
  const run = useAction();
  const peak = useStudio((state) => state.levels[name]);
  const levels = useMeterLevels(peak);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1 text-sm">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {global && <DevicePicker source={name} microphone={microphone} />}
        <Button variant="ghost" size="icon-sm" aria-label={t("audioSettings", { name })} onClick={() => onAudioSettings(name)}><AudioLinesIcon /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={t("properties", { name })} onClick={() => onProperties(name)}><Settings2Icon /></Button>
      </div>
      <div className="grid gap-0.5" aria-hidden>
        {levels.map((level, channel) => (
          <div key={channel} className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-[width] duration-75 motion-reduce:transition-none", level > -9 ? "bg-red-500" : level > -20 ? "bg-yellow-400" : "bg-brand-green")}
              style={{ width: `${muted ? 0 : meterDeflection(level) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[deflection]}
          aria-label={t("volume", { name })}
          aria-valuetext={formatDb(deflectionToDb(deflection))}
          onValueChange={([value]) => void run(() => studio.setVolume(name, value))}
        />
        <span className={cn("w-16 shrink-0 text-right text-xs tabular-nums", muted ? "text-red-500" : "text-muted-foreground")}>
          {muted ? t("muted") : formatDb(deflectionToDb(deflection))}
        </span>
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

/** Switches the device a desktop-audio or microphone channel captures, right from the mixer. */
function DevicePicker({ source, microphone }: { source: string; microphone: boolean }) {
  const t = useTranslations("mixer");
  const run = useAction();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<AudioDeviceChoice | null | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void run(() => studio.listAudioDevices(source)).then((result) => {
      if (!cancelled) setChoice(result ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, source, run]);

  const Icon = microphone ? MicIcon : SpeakerIcon;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setChoice(undefined);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("device", { name: source })}><Icon /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        {choice === undefined ? (
          <div className="flex h-16 items-center justify-center">
            <span className="size-4 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-label={t("loadingDevices")} />
          </div>
        ) : !choice || choice.options.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t("noDevices")}</p>
        ) : (
          <div role="listbox" aria-label={t("device", { name: source })} className="grid max-h-72 overflow-y-auto">
            {choice.options.map((option) => {
              const selected = option.value === choice.current;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={async () => {
                    setOpen(false);
                    if (!selected) await run(() => studio.setAudioDevice(source, option.value));
                  }}
                >
                  <CheckIcon className={cn("size-4 shrink-0", !selected && "invisible")} />
                  <span className="truncate">{option.value === "default" ? t("systemDefault") : option.label || option.value}</span>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
