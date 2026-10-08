import { KeyboardIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import {
  FIXED_HOTKEY_ACTIONS,
  displayHotkey,
  findHotkeyConflicts,
  hotkeyFromKeyEvent,
  hotkeyProblem,
  isReservedHotkey,
  parseHotkeyAction,
  targetAction,
  type HotkeyProblem,
} from "../../shared/hotkeys";
import { Button } from "@/components/ui/button";
import { isMac, studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";

const AUDIO_KINDS = ["mute", "pushToTalk", "pushToMute"] as const;

/** Hotkeys stay paused while any row is waiting for keys. */
let capturingRows = 0;
function setCapturing(active: boolean): void {
  capturingRows = Math.max(0, capturingRows + (active ? 1 : -1));
  studio.setHotkeyCapture(capturingRows > 0).catch((error: unknown) => console.error(error));
}

/** Settings › Hotkeys: a short list of actions, each with a "press keys" field. */
export function HotkeysSettings() {
  const t = useTranslations("hotkeys");
  const run = useAction();
  const hotkeys = useStudio((state) => state.snapshot?.hotkeys);
  const scenes = useStudio((state) => state.snapshot?.scenes ?? []);
  const audio = useStudio((state) => state.snapshot?.audio ?? []);
  if (!hotkeys) return null;

  // Only actions on screen count for conflicts; bindings of removed sources are ignored.
  const shown = [
    ...FIXED_HOTKEY_ACTIONS,
    ...scenes.map((scene) => targetAction("scene", scene.name)),
    ...audio.flatMap((source) => AUDIO_KINDS.map((kind) => targetAction(kind, source.name))),
  ];
  const visible = Object.fromEntries(shown.filter((action) => hotkeys.bindings[action]).map((action) => [action, hotkeys.bindings[action]]));
  const conflicts = findHotkeyConflicts(visible);
  const hasHolds = Object.keys(visible).some((action) => action.startsWith("pushTo"));

  const label = (action: string): string => {
    const parsed = parseHotkeyAction(action);
    if (!parsed) return action;
    if (!("target" in parsed)) return t(`actions.${parsed.kind}`);
    if (parsed.kind === "scene") return t("actions.scene", { name: parsed.target });
    return t("actions.targeted", { action: t(`actions.${parsed.kind}`), name: parsed.target });
  };

  const row = (action: string, text: string) => {
    const combo = hotkeys.bindings[action] ?? null;
    const others = conflicts.get(action);
    const warning = !combo
      ? null
      : others
        ? t("conflict", { actions: others.map(label).join(", ") })
        : hotkeys.unavailable.includes(combo)
          ? t("unavailable")
          : null;
    return (
      <HotkeyRow
        key={action}
        action={action}
        label={text}
        fullLabel={label(action)}
        combo={combo}
        warning={warning}
        onChange={(next) => void run(() => studio.setHotkey(action, next))}
      />
    );
  };

  return (
    <>
      {hasHolds && hotkeys.inputAccess === "needed" && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">{t("inputAccess")}</span>
          <Button size="sm" variant="outline" onClick={() => void run(() => studio.openInputAccessSettings())}>
            {t("openSettings")}
          </Button>
        </div>
      )}
      <HotkeyCard title={t("streamGroup")}>{FIXED_HOTKEY_ACTIONS.map((action) => row(action, t(`actions.${action}`)))}</HotkeyCard>
      {scenes.length > 0 && (
        <HotkeyCard title={t("scenesGroup")}>{scenes.map((scene) => row(targetAction("scene", scene.name), t("actions.scene", { name: scene.name })))}</HotkeyCard>
      )}
      {audio.length > 0 && (
        <HotkeyCard title={t("audioGroup")}>
          {audio.map((source) => (
            <div key={source.name} className="grid gap-1">
              <h4 className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{source.name}</h4>
              {AUDIO_KINDS.map((kind) => row(targetAction(kind, source.name), t(`actions.${kind}`)))}
            </div>
          ))}
        </HotkeyCard>
      )}
    </>
  );
}

function HotkeyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-6">
      <h3 className="text-xl font-bold text-neutral-900 dark:text-white">{title}</h3>
      {children}
    </section>
  );
}

function HotkeyRow({
  action,
  label,
  fullLabel,
  combo,
  warning,
  onChange,
}: {
  action: string;
  label: string;
  fullLabel: string;
  combo: string | null;
  warning: string | null;
  onChange: (combo: string | null) => void;
}) {
  const t = useTranslations("hotkeys");
  const [capturing, setCapturingState] = useState(false);
  const [problem, setProblem] = useState<HotkeyProblem | "reserved" | null>(null);
  // Snapshots re-render often; the key listener reads the latest values without re-subscribing.
  const latest = useRef({ combo, onChange });
  useEffect(() => {
    latest.current = { combo, onChange };
  });

  useEffect(() => {
    if (!capturing) return;
    setCapturing(true);
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const plain = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
      if (plain && event.code === "Escape") {
        setCapturingState(false);
        return;
      }
      const next = hotkeyFromKeyEvent(event);
      if (!next) return; // Only modifiers so far.
      const found = isReservedHotkey(next, window.platform) ? "reserved" : hotkeyProblem(action, next);
      setProblem(found);
      if (found) return;
      setCapturingState(false);
      if (next !== latest.current.combo) latest.current.onChange(next);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setCapturing(false);
    };
  }, [capturing, action]);

  const message =
    problem === "reserved" ? t("reserved") : problem === "needsModifier" ? t(isMac ? "needsModifierMac" : "needsModifier") : problem === "invalid" ? t("invalid") : warning;
  const messageId = useId();

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        <button
          type="button"
          aria-label={t("setLabel", { action: fullLabel })}
          aria-describedby={message ? messageId : undefined}
          aria-pressed={capturing}
          onClick={() => {
            setProblem(null);
            setCapturingState((value) => !value);
          }}
          onBlur={() => {
            setCapturingState(false);
            setProblem(null);
          }}
          className={cn(
            "inline-flex h-8 min-w-36 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
            capturing && "border-primary ring-[3px] ring-ring/50",
            !combo && !capturing && "text-muted-foreground",
          )}
        >
          <KeyboardIcon aria-hidden className="size-4 shrink-0" />
          {capturing ? t("pressKeys") : combo ? displayHotkey(combo, window.platform) : t("notSet")}
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("clearLabel", { action: fullLabel })}
          title={t("clear")}
          disabled={!combo}
          className={cn(!combo && "invisible")}
          onClick={() => onChange(null)}
        >
          <XIcon />
        </Button>
      </div>
      {message && (
        <p id={messageId} role={problem ? "alert" : undefined} className={cn("text-xs", problem ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
          {message}
        </p>
      )}
    </div>
  );
}
