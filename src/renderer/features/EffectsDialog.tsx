import {
  ArrowDownIcon,
  ArrowUpIcon,
  ContrastIcon,
  CropIcon,
  DropletIcon,
  FocusIcon,
  MoveHorizontalIcon,
  PaletteIcon,
  PipetteIcon,
  PlusIcon,
  ScalingIcon,
  SlidersHorizontalIcon,
  SquareDashedIcon,
  TimerIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { PropertyDTO } from "../../shared/types";
import { effectSuitsSource, type EffectDTO, type EffectKind, type EffectList } from "../../shared/video-effects";
import { useStudio } from "@/store/studio";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ActionMenu,
} from "@/components/ui/overlays";
import { Tooltip } from "@/components/ui/tooltip";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import type { MoveDirection } from "@/lib/focus-target";
import { useMoveFocus } from "@/lib/use-move-focus";
import { cn } from "@/lib/utils";
import { PropertyField } from "./SourcePropertiesDialog";

const EFFECT_ICONS: Record<EffectKind, LucideIcon> = {
  chromaKey: PipetteIcon,
  colorCorrection: SlidersHorizontalIcon,
  crop: CropIcon,
  lut: PaletteIcon,
  colorKey: DropletIcon,
  lumaKey: ContrastIcon,
  sharpen: FocusIcon,
  mask: SquareDashedIcon,
  scale: ScalingIcon,
  scroll: MoveHorizontalIcon,
  renderDelay: TimerIcon,
};

/** Shown as one-click cards while a source has no effects yet. */
const QUICK_EFFECTS: EffectKind[] = ["chromaKey", "colorCorrection", "crop", "lut"];

/** Per-source video effects: add with one click, then tune, reorder, switch off or remove. Changes apply live. */
export function EffectsDialog({ source, onClose }: { source: string | null; onClose: () => void }) {
  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      {source !== null && <EffectsPanel key={source} source={source} onClose={onClose} />}
    </Dialog>
  );
}

function EffectsPanel({ source, onClose }: { source: string; onClose: () => void }) {
  const t = useTranslations("effects");
  const tc = useTranslations("common");
  const tt = useTranslations("tooltips");
  const run = useAction();
  const [list, setList] = useState<EffectList | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [removing, setRemoving] = useState<EffectDTO | null>(null);
  const sourceKind = useStudio((state) => state.snapshot?.scenes.flatMap((scene) => scene.items).find((item) => item.sourceName === source)?.kind);

  useEffect(() => {
    let cancelled = false;
    void run(() => studio.listEffects(source)).then((result) => {
      if (cancelled) return;
      setList(result ?? { available: [], effects: [] });
      setSelected(result?.effects[0]?.name ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [source, run]);

  const apply = async (call: () => Promise<EffectList>, select?: (next: EffectList) => string | null, moved?: { name: string; direction: MoveDirection }) => {
    const next = await run(call);
    if (!next) return;
    if (moved) moveFocus.expect(moved.name, moved.direction);
    setList(next);
    setSelected((current) => (select ? select(next) : next.effects.some((effect) => effect.name === current) ? current : (next.effects[0]?.name ?? null)));
  };

  const add = (kind: EffectKind) =>
    apply(
      () => studio.addEffect(source, kind),
      // The new effect is the one that was not there before.
      (next) => next.effects.find((effect) => !list?.effects.some((old) => old.name === effect.name))?.name ?? next.effects.at(-1)?.name ?? null,
    );

  const effects = list?.effects ?? [];
  const detail = useRef<HTMLDivElement>(null);
  // The Move button pressed keeps focus, or its sibling once the effect reaches an end of the list.
  const moveFocus = useMoveFocus(detail, effects.map((effect) => effect.name));
  const current = effects.find((effect) => effect.name === selected) ?? null;
  const index = current ? effects.indexOf(current) : -1;
  const available = (list?.available ?? []).filter((kind) => effectSuitsSource(kind, sourceKind));
  const addItems = available.map((kind) => ({ label: t(`kinds.${kind}`), onSelect: () => void add(kind) }));

  return (
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{t("title", { name: source })}</DialogTitle>
      </DialogHeader>
      {list === null ? (
        <div className="flex h-40 items-center justify-center">
          <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-label={tc("loading")} />
        </div>
      ) : available.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("unavailable")}</p>
      ) : effects.length === 0 ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {QUICK_EFFECTS.filter((kind) => available.includes(kind)).map((kind) => {
              const Icon = EFFECT_ICONS[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => void add(kind)}
                  className="flex flex-col items-center gap-2 rounded-lg border bg-background px-3 py-5 text-sm font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
                >
                  <Icon className="size-6 text-muted-foreground" aria-hidden />
                  {t(`kinds.${kind}`)}
                </button>
              );
            })}
          </div>
          <ActionMenu items={addItems}>
            <Button variant="outline" className="justify-self-start">
              <PlusIcon />
              {t("more")}
            </Button>
          </ActionMenu>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[15rem_1fr]">
          <div className="grid content-start gap-2">
            <ul aria-label={t("applied")} className="grid gap-1">
              {effects.map((effect) => {
                const Icon = EFFECT_ICONS[effect.kind];
                const label = t(`kinds.${effect.kind}`);
                return (
                  <li
                    key={effect.name}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-md pr-1 pl-2 text-sm transition-colors",
                      effect.name === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={effect.name === selected}
                      onClick={() => setSelected(effect.name)}
                      className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Icon className={cn("size-4 shrink-0 text-muted-foreground", !effect.enabled && "opacity-40")} aria-hidden />
                      <span className={cn("truncate", !effect.enabled && "text-muted-foreground")}>{label}</span>
                    </button>
                    <Switch
                      checked={effect.enabled}
                      aria-label={t("toggle", { name: label })}
                      onCheckedChange={(checked) => void apply(() => studio.setEffectEnabled(source, effect.name, checked))}
                    />
                  </li>
                );
              })}
            </ul>
            <ActionMenu items={addItems}>
              <Button variant="outline" size="sm" className="justify-self-start">
                <PlusIcon />
                {t("add")}
              </Button>
            </ActionMenu>
          </div>
          {current && (
            <div ref={detail} className="grid min-w-0 content-start gap-3">
              <div className="flex items-center gap-1">
                <h3 className="min-w-0 flex-1 truncate font-semibold">{t(`kinds.${current.kind}`)}</h3>
                <Tooltip label={t("moveUp")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("moveUp")}
                    disabled={index <= 0}
                    data-move-key={current.name}
                    data-move="up"
                    onClick={() => void apply(() => studio.moveEffect(source, current.name, "up"), () => current.name, { name: current.name, direction: "up" })}
                  >
                    <ArrowUpIcon />
                  </Button>
                </Tooltip>
                <Tooltip label={t("moveDown")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("moveDown")}
                    disabled={index >= effects.length - 1}
                    data-move-key={current.name}
                    data-move="down"
                    onClick={() => void apply(() => studio.moveEffect(source, current.name, "down"), () => current.name, { name: current.name, direction: "down" })}
                  >
                    <ArrowDownIcon />
                  </Button>
                </Tooltip>
                <Tooltip label={tt("removeEffect")}>
                  <Button variant="ghost" size="icon-sm" aria-label={tc("remove")} onClick={() => setRemoving(current)}>
                    <Trash2Icon />
                  </Button>
                </Tooltip>
              </div>
              <EffectSettings key={current.name} source={source} effect={current.name} />
            </div>
          )}
        </div>
      )}
      <DialogFooter>
        <Button onClick={onClose}>{tc("done")}</Button>
      </DialogFooter>
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        {removing !== null && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("removeTitle", { name: t(`kinds.${removing.kind}`) })}</AlertDialogTitle>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => void apply(() => studio.removeEffect(source, removing.name))}>
                {tc("remove")}
              </AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </DialogContent>
  );
}

/** The effect's own engine settings; edits apply live and are coalesced while dragging. */
function EffectSettings({ source, effect }: { source: string; effect: string }) {
  const t = useTranslations("effects");
  const tc = useTranslations("common");
  const run = useAction();
  const [properties, setProperties] = useState<PropertyDTO[] | null>(null);
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<number | null>(null);
  const updates = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void run(() => studio.getEffectProperties(source, effect)).then((result) => {
      if (!cancelled) setProperties(result ?? []);
    });
    return () => {
      cancelled = true;
      mounted.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
      const settings = pending.current;
      pending.current = {};
      // Never drop the last change when the dialog closes or another effect is picked.
      if (Object.keys(settings).length > 0) void updates.current.then(() => run(() => studio.updateEffectSettings(source, effect, settings)));
    };
  }, [source, effect, run]);

  const flush = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const settings = pending.current;
    pending.current = {};
    if (Object.keys(settings).length === 0) return;
    updates.current = updates.current.then(async () => {
      const next = await run(() => studio.updateEffectSettings(source, effect, settings));
      // Keep values the user changed meanwhile; take everything else from the engine.
      if (next && mounted.current) {
        setProperties(next.map((property) => (Object.hasOwn(pending.current, property.name) ? { ...property, value: pending.current[property.name] } : property)));
      }
    });
  };

  const change = (name: string, value: unknown, immediate = false) => {
    setProperties((current) => current?.map((property) => (property.name === name ? { ...property, value } : property)) ?? null);
    pending.current[name] = value;
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = window.setTimeout(flush, 120);
  };

  if (properties === null) {
    return (
      <div className="flex h-24 items-center justify-center">
        <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-label={tc("loading")} />
      </div>
    );
  }
  if (properties.length === 0) return <p className="py-4 text-sm text-muted-foreground">{t("noSettings")}</p>;
  return (
    <div className="-mr-2 grid max-h-[55vh] gap-4 overflow-y-auto py-1 pr-2">
      {properties.map((property) => (
        <PropertyField key={property.name} property={property} onChange={change} onButton={() => undefined} />
      ))}
    </div>
  );
}
