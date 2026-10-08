import { ChevronLeftIcon, FilmIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Label, Slider, Switch } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import {
  DEFAULT_TRANSITION,
  defaultStinger,
  TRANSITION_MAX_MS,
  TRANSITION_MIN_MS,
  TRANSITION_PRESETS,
  transitionPreset,
  type StingerAudio,
  type StingerAudioFade,
  type StingerMatte,
  type StingerOptions,
  type TransitionChoice,
  type TransitionPreset,
} from "../../shared/transitions";

const MATTES: StingerMatte[] = ["none", "sideBySide", "stacked", "mask"];
const STINGER_AUDIO: StingerAudio[] = ["stream", "monitor", "both"];
const AUDIO_FADES: StingerAudioFade[] = ["fadeOutIn", "crossfade"];

function direction(preset: TransitionPreset): string | undefined {
  const value = preset.settings.direction;
  return typeof value === "string" ? value : undefined;
}

function fileName(file: string): string {
  return file.split(/[\\/]/u).pop() ?? file;
}

/** Looping thumbnail: scene B replaces scene A the way the transition does. */
export function TransitionThumb({ preset, className }: { preset: TransitionPreset; className?: string }) {
  return (
    <span aria-hidden className={cn("transition-thumb block aspect-video", className)} data-kind={preset.id} data-dir={direction(preset)}>
      <span className="tt-a bg-gradient-to-br from-sky-500 to-indigo-600" />
      <span className="tt-b bg-gradient-to-br from-amber-400 to-rose-500" />
      {(preset.id === "fadeBlack" || preset.id === "fadeWhite") && <span className={cn("tt-mid", preset.id === "fadeBlack" ? "bg-black" : "bg-white")} />}
      {preset.id === "stinger" && (
        <span className="tt-mid grid place-items-center bg-neutral-900 text-white">
          <FilmIcon className="size-5" />
        </span>
      )}
    </span>
  );
}

/**
 * Scene transitions: the default transition first, then the scenes that use
 * their own transition. With `scene`, opens on that scene's transition.
 */
export function TransitionsDialog({ open, onOpenChange, scene = null }: { open: boolean; onOpenChange: (open: boolean) => void; scene?: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">{open && <TransitionsPanel initialScene={scene} />}</DialogContent>
    </Dialog>
  );
}

function TransitionsPanel({ initialScene }: { initialScene: string | null }) {
  const t = useTranslations("transitions");
  const run = useAction();
  const [target, setTarget] = useState<string | null>(initialScene);
  const fallback = useStudio((state) => state.snapshot?.transition ?? DEFAULT_TRANSITION);
  const scenes = useStudio((state) => state.snapshot?.scenes ?? []);
  const available = useStudio((state) => state.snapshot?.availableTransitions);
  const targetScene = target === null ? undefined : scenes.find((entry) => entry.name === target);
  // In a scene, null means "use the default transition".
  const current: TransitionChoice | null = target === null ? fallback : (targetScene?.transition ?? null);
  const presets = TRANSITION_PRESETS.filter((preset) => !available?.length || available.includes(preset.id) || preset.id === current?.id);
  const fallbackPreset = transitionPreset(fallback.id) ?? TRANSITION_PRESETS[0];
  const overrides = scenes.filter((entry) => entry.transition);
  const withoutOverride = scenes.filter((entry) => !entry.transition);

  const apply = (choice: TransitionChoice | null) =>
    run(() => (target === null ? studio.setTransition(choice ?? DEFAULT_TRANSITION) : studio.setSceneTransition(target, choice)));

  const pickStinger = async (previous?: StingerOptions) => {
    const file = await run(() => studio.pickStingerFile());
    if (!file) return;
    const fresh = defaultStinger(file.path, file.durationMs);
    if (!fresh) return;
    const stinger = previous ? { ...fresh, matte: previous.matte, invertMatte: previous.invertMatte, audio: previous.audio, audioFade: previous.audioFade } : fresh;
    await apply({ id: "stinger", durationMs: file.durationMs, stinger });
  };

  const choose = (preset: TransitionPreset) => {
    if (preset.id === current?.id) return;
    if (preset.file) void pickStinger();
    else void apply({ id: preset.id, durationMs: preset.defaultDurationMs });
  };

  return (
    <>
      <DialogHeader>
        {target === null ? (
          <>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1">
              <Button variant="ghost" size="icon-sm" className="-ml-1.5" aria-label={t("back")} title={t("back")} onClick={() => setTarget(null)}>
                <ChevronLeftIcon />
              </Button>
              <DialogTitle className="truncate">{t("sceneTitle", { name: target })}</DialogTitle>
            </div>
            <DialogDescription className="sr-only">{t("sceneDescription")}</DialogDescription>
          </>
        )}
      </DialogHeader>

      <ul className="grid max-h-[40vh] grid-cols-3 gap-2 overflow-y-auto p-0.5 animate-ui-list sm:grid-cols-4">
        {target !== null && (
          <li>
            <PresetTile preset={fallbackPreset} label={t("useDefault", { name: t(`presets.${fallbackPreset.id}`) })} selected={current === null} onClick={() => current !== null && void apply(null)} />
          </li>
        )}
        {presets.map((preset) => (
          <li key={preset.id}>
            <PresetTile preset={preset} label={t(`presets.${preset.id}`)} selected={preset.id === current?.id} onClick={() => choose(preset)} />
          </li>
        ))}
      </ul>

      {current?.stinger ? (
        <StingerOptionsPanel key={`${target ?? ""}\u0000${current.stinger.path}`} options={current.stinger} onChange={(stinger) => void apply({ ...current, stinger })} onPickFile={() => void pickStinger(current.stinger)} />
      ) : current ? (
        <DurationField key={`${target ?? ""}\u0000${current.id}`} choice={current} onCommit={(durationMs) => void apply({ ...current, durationMs })} />
      ) : null}

      {target === null && scenes.length > 0 && (
        <div className="grid gap-2 border-t pt-3">
          <Label>{t("perScene")}</Label>
          {overrides.length > 0 && (
            <ul className="grid gap-1">
              {overrides.map((entry) => {
                const choice = entry.transition as TransitionChoice;
                const preset = transitionPreset(choice.id);
                return (
                  <li key={entry.name} className="flex items-center gap-2 rounded-md border px-2 py-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate rounded-sm py-1 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onClick={() => setTarget(entry.name)}
                    >
                      <span className="font-medium">{entry.name}</span>
                      <span className="text-muted-foreground"> · {t(`presets.${choice.id}`)}</span>
                      {preset && !preset.instant && !preset.file && <span className="text-muted-foreground tabular-nums"> · {t("durationValue", { ms: choice.durationMs })}</span>}
                    </button>
                    <Button variant="ghost" size="icon-sm" aria-label={t("removeOverride", { name: entry.name })} title={t("removeOverride", { name: entry.name })} onClick={() => void run(() => studio.setSceneTransition(entry.name, null))}>
                      <XIcon />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {withoutOverride.length > 0 && (
            <Select value="" onValueChange={(value) => setTarget(value)}>
              <SelectTrigger aria-label={t("addOverride")} className="sm:w-64">
                <SelectValue placeholder={t("addOverride")} />
              </SelectTrigger>
              <SelectContent>
                {withoutOverride.map((entry) => (
                  <SelectItem key={entry.name} value={entry.name}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </>
  );
}

function PresetTile({ preset, label, selected, onClick }: { preset: TransitionPreset; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "tt-host w-full overflow-hidden rounded-lg border text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected && "border-primary",
      )}
    >
      <TransitionThumb preset={preset} />
      <span className="block truncate px-2.5 py-1.5 text-xs font-semibold">{label}</span>
    </button>
  );
}

function DurationField({ choice, onCommit }: { choice: TransitionChoice; onCommit: (durationMs: number) => void }) {
  const t = useTranslations("transitions");
  // Slider position while dragging; the saved value is shown otherwise.
  const [draft, setDraft] = useState<number | null>(null);
  const duration = draft ?? choice.durationMs;
  const preset = transitionPreset(choice.id);
  return (
    <div className="grid gap-2">
      <Label>{t("duration")}</Label>
      {preset?.instant ? (
        <p className="text-sm text-muted-foreground">{t("instant")}</p>
      ) : (
        <div className="flex items-center gap-3">
          <Slider
            min={TRANSITION_MIN_MS}
            max={2000}
            step={50}
            value={[Math.min(duration, 2000)]}
            onValueChange={([next]) => setDraft(next)}
            onValueCommit={([next]) => {
              onCommit(Math.min(next, TRANSITION_MAX_MS));
              setDraft(null);
            }}
            aria-label={t("duration")}
          />
          <span className="w-16 shrink-0 text-right text-sm tabular-nums">{t("durationValue", { ms: duration })}</span>
        </div>
      )}
    </div>
  );
}

function StingerOptionsPanel({ options, onChange, onPickFile }: { options: StingerOptions; onChange: (options: StingerOptions) => void; onPickFile: () => void }) {
  const t = useTranslations("transitions.stinger");
  const [draft, setDraft] = useState<number | null>(null);
  const percent = options.point.unit === "percent";
  const max = percent ? 100 : Math.max(options.videoMs, 1000);
  const value = draft ?? options.point.value;
  const patch = (next: Partial<StingerOptions>) => onChange({ ...options, ...next });

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3 rounded-md border px-3 py-2">
        <FilmIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{fileName(options.path)}</span>
          {options.videoMs > 0 && <span className="text-muted-foreground tabular-nums"> · {t("length", { seconds: Math.round(options.videoMs / 100) / 10 })}</span>}
        </span>
        <Button variant="outline" size="sm" onClick={onPickFile}>
          {t("changeFile")}
        </Button>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label>{t("point")}</Label>
          {options.videoMs > 0 && (
            <div className="flex rounded-md border p-0.5" role="group" aria-label={t("pointUnit")}>
              {(["percent", "ms"] as const).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  aria-pressed={options.point.unit === unit}
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    options.point.unit === unit ? "bg-accent font-semibold" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => {
                    if (options.point.unit === unit) return;
                    // Keep the same moment when switching units.
                    const ms = percent ? Math.round((options.videoMs * options.point.value) / 100) : options.point.value;
                    patch({ point: { unit, value: unit === "percent" ? Math.round((ms / options.videoMs) * 100) : ms } });
                  }}
                >
                  {t(`units.${unit}`)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Slider
            min={0}
            max={max}
            step={percent ? 1 : 10}
            value={[Math.min(value, max)]}
            onValueChange={([next]) => setDraft(next)}
            onValueCommit={([next]) => {
              patch({ point: { unit: options.point.unit, value: next } });
              setDraft(null);
            }}
            aria-label={t("point")}
          />
          <span className="w-16 shrink-0 text-right text-sm tabular-nums">{percent ? t("percentValue", { value }) : t("msValue", { value })}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="stinger-matte">{t("matte")}</Label>
          <Select value={options.matte} onValueChange={(matte) => patch({ matte: matte as StingerMatte })}>
            <SelectTrigger id="stinger-matte">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MATTES.map((matte) => (
                <SelectItem key={matte} value={matte}>
                  {t(`mattes.${matte}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="stinger-audio">{t("audio")}</Label>
          <Select value={options.audio} onValueChange={(audio) => patch({ audio: audio as StingerAudio })}>
            <SelectTrigger id="stinger-audio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STINGER_AUDIO.map((audio) => (
                <SelectItem key={audio} value={audio}>
                  {t(`audioOptions.${audio}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="stinger-fade">{t("sceneAudio")}</Label>
          <Select value={options.audioFade} onValueChange={(audioFade) => patch({ audioFade: audioFade as StingerAudioFade })}>
            <SelectTrigger id="stinger-fade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIO_FADES.map((fade) => (
                <SelectItem key={fade} value={fade}>
                  {t(`fades.${fade}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {options.matte !== "none" && (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="stinger-invert">{t("invertMatte")}</Label>
          <Switch id="stinger-invert" checked={options.invertMatte} onCheckedChange={(invertMatte) => patch({ invertMatte })} />
        </div>
      )}
    </div>
  );
}
