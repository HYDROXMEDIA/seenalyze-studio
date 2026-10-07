import { useState } from "react";
import { useTranslations } from "use-intl";
import { Label, Slider } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import {
  DEFAULT_TRANSITION,
  TRANSITION_MAX_MS,
  TRANSITION_MIN_MS,
  TRANSITION_PRESETS,
  transitionPreset,
  type TransitionPreset,
} from "../../shared/transitions";

function direction(preset: TransitionPreset): string | undefined {
  const value = preset.settings.direction;
  return typeof value === "string" ? value : undefined;
}

/** Looping thumbnail: scene B replaces scene A the way the transition does. */
export function TransitionThumb({ preset, className }: { preset: TransitionPreset; className?: string }) {
  return (
    <span aria-hidden className={cn("transition-thumb block aspect-video", className)} data-kind={preset.id} data-dir={direction(preset)}>
      <span className="tt-a bg-gradient-to-br from-sky-500 to-indigo-600" />
      <span className="tt-b bg-gradient-to-br from-amber-400 to-rose-500" />
      {(preset.id === "fadeBlack" || preset.id === "fadeWhite") && <span className={cn("tt-mid", preset.id === "fadeBlack" ? "bg-black" : "bg-white")} />}
    </span>
  );
}

export function TransitionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("transitions");
  const run = useAction();
  const current = useStudio((state) => state.snapshot?.transition ?? DEFAULT_TRANSITION);
  // Slider position while dragging; the saved value is shown otherwise.
  const [draft, setDraft] = useState<number | null>(null);
  const duration = draft ?? current.durationMs;
  const preset = transitionPreset(current.id) ?? TRANSITION_PRESETS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <ul className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto p-0.5 animate-ui-list sm:grid-cols-4">
          {TRANSITION_PRESETS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                aria-pressed={entry.id === current.id}
                onClick={() => {
                  if (entry.id !== current.id)
                    void run(() =>
                      studio.setTransition({
                        id: entry.id,
                        durationMs: entry.defaultDurationMs,
                      }),
                    );
                }}
                className={cn(
                  "w-full overflow-hidden rounded-lg border text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  entry.id === current.id && "border-primary",
                )}
              >
                <TransitionThumb preset={entry} />
                <span className="block truncate px-2.5 py-1.5 text-xs font-semibold">{t(`presets.${entry.id}`)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2">
          <Label>{t("duration")}</Label>
          {preset.instant ? (
            <p className="text-sm text-muted-foreground">{t("instant")}</p>
          ) : (
            <div className="flex items-center gap-3">
              <Slider
                min={TRANSITION_MIN_MS}
                max={2000}
                step={50}
                value={[Math.min(duration, 2000)]}
                onValueChange={([next]) => setDraft(next)}
                onValueCommit={([next]) =>
                  void run(() =>
                    studio.setTransition({
                      id: current.id,
                      durationMs: Math.min(next, TRANSITION_MAX_MS),
                    }),
                  ).finally(() => setDraft(null))
                }
                aria-label={t("duration")}
              />
              <span className="w-16 shrink-0 text-right text-sm tabular-nums">{t("durationValue", { ms: duration })}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
