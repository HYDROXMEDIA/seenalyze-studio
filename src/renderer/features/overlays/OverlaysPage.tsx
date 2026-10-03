import {
  ArrowLeftIcon,
  CopyIcon,
  Loader2Icon,
  LogInIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import aiDesignerIcon from "@/assets/icons/ai-designer.png";
import overlayIcon from "@/assets/icons/overlay.png";
import { useTranslations } from "use-intl";
import {
  OVERLAY_KINDS,
  type OverlayDefinition,
  type OverlayKind,
  type OverlaySummary,
  type OverlayValue,
  type PresetSummary,
  type SeenalyzeAccount,
} from "../../../shared/overlays";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Textarea } from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
  DialogHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/overlays";
import { errorCode, studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { OverlayPreview } from "./OverlayPreview";
import { SettingsPanel } from "./SettingsPanel";

type Selection = { type: "overlay"; id: string } | { type: "preset"; id: string } | null;
const SAVE_DELAY_MS = 250;

export function OverlaysPage() {
  const t = useTranslations("overlays");
  const tc = useTranslations("common");
  const run = useAction();
  const setView = useStudio((state) => state.setView);
  const scenes = useStudio((state) => state.snapshot?.scenes ?? []);
  const activeScene = useStudio((state) => state.snapshot?.activeScene ?? null);
  const twitchFollows = useStudio((state) => state.snapshot?.overlayData.twitchFollows ?? "unavailable");

  const [tab, setTab] = useState<"mine" | "presets">("mine");
  const [kindFilter, setKindFilter] = useState<OverlayKind | "all">("all");
  const [overlays, setOverlays] = useState<OverlaySummary[] | null>(null);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [overlay, setOverlay] = useState<OverlayDefinition | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [targetScene, setTargetScene] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "reset" | null>(null);
  const pendingValues = useRef<Record<string, OverlayValue>>({});
  const saveTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const [mine, gallery] = await Promise.all([run(() => studio.listOverlays()), run(() => studio.listOverlayPresets())]);
    if (mine) setOverlays(mine);
    if (gallery) setPresets(gallery);
    return mine;
  }, [run]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([studio.listOverlays(), studio.listOverlayPresets()])
      .then(([mine, gallery]) => {
        if (cancelled) return;
        setOverlays(mine);
        setPresets(gallery);
        // First visit: start in the preset gallery.
        if (mine.length === 0) setTab("presets");
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setOverlays([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the selected overlay or preset and its preview address.
  useEffect(() => {
    let cancelled = false;
    if (!selection) return;
    void (async () => {
      const url = await run(() => studio.overlayPreviewUrl(selection.type === "overlay" ? { overlayId: selection.id } : { presetId: selection.id }));
      const definition = selection.type === "overlay" ? await run(() => studio.getOverlay(selection.id)) : null;
      if (cancelled) return;
      setPreviewUrl(url ?? null);
      setOverlay(definition ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, run]);

  const flush = useCallback(async () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const values = pendingValues.current;
    pendingValues.current = {};
    if (!overlay || Object.keys(values).length === 0) return;
    await run(() => studio.updateOverlay(overlay.id, { values }));
  }, [overlay, run]);

  useEffect(() => () => void flush(), [flush]);

  const changeValue = (key: string, value: OverlayValue) => {
    if (!overlay) return;
    setOverlay({ ...overlay, values: { ...overlay.values, [key]: value } });
    pendingValues.current[key] = value;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  const patchOverlay = async (patch: { name?: string; width?: number; height?: number }) => {
    if (!overlay) return;
    const next = await run(() => studio.updateOverlay(overlay.id, patch));
    if (next) {
      setOverlay(next);
      void refresh();
    }
  };

  const select = async (next: Selection) => {
    await flush();
    setSelection(next);
    if (!next) setOverlay(null);
  };

  const addPreset = async (presetId: string) => {
    const created = await run(() => studio.createOverlayFromPreset(presetId));
    if (!created) return;
    toast.success(t("added", { name: created.name }));
    setTab("mine");
    await refresh();
    await select({ type: "overlay", id: created.id });
  };

  const scene = targetScene && scenes.some((entry) => entry.name === targetScene) ? targetScene : activeScene;
  const visiblePresets = presets.filter((preset) => kindFilter === "all" || preset.kind === kindFilter);
  const visibleOverlays = (overlays ?? []).filter((entry) => kindFilter === "all" || entry.kind === kindFilter);
  const selectedPreset = selection?.type === "preset" ? presets.find((preset) => preset.id === selection.id) : undefined;
  const usedKinds = useMemo(
    () => new Set<OverlayKind>([...presets.map((preset) => preset.kind), ...(overlays ?? []).map((entry) => entry.kind)]),
    [presets, overlays],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="sm" onClick={() => void flush().then(() => setView("studio"))}>
          <ArrowLeftIcon />
          {t("back")}
        </Button>
        <h2 className="text-xl font-bold text-neutral-900 dark:text-white">{t("title")}</h2>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Library and presets */}
        <aside className="flex w-72 shrink-0 flex-col border-r">
          <div className="grid grid-cols-2 gap-1 p-2" role="tablist">
            {(["mine", "presets"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={tab === entry}
                onClick={() => setTab(entry)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  tab === entry && "bg-accent font-medium",
                )}
              >
                {t(`tabs.${entry}`)}
              </button>
            ))}
          </div>
          <div className="px-2 pb-2">
            <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as OverlayKind | "all")}>
              <SelectTrigger aria-label={t("filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("kinds.all")}</SelectItem>
                {OVERLAY_KINDS.filter((kind) => usedKinds.has(kind)).map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`kinds.${kind}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {tab === "presets" ? (
              <ul className="grid gap-2">
                {visiblePresets.map((preset) => (
                  <li key={preset.id}>
                    <button
                      type="button"
                      onClick={() => void select({ type: "preset", id: preset.id })}
                      className={cn(
                        "w-full overflow-hidden rounded-lg border text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        selection?.type === "preset" && selection.id === preset.id && "border-primary",
                      )}
                    >
                      <span className="block h-1.5" style={{ background: `linear-gradient(90deg, ${preset.accent}, transparent)` }} />
                      <span className="block px-3 py-2">
                        <span className="block text-sm font-semibold">{preset.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{preset.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : overlays === null ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-label={tc("loading")} />
              </div>
            ) : visibleOverlays.length === 0 ? (
              <div className="grid gap-2 p-4 text-center">
                <p className="text-sm text-muted-foreground">{t("emptyMine")}</p>
                <Button size="sm" variant="outline" onClick={() => setTab("presets")}>
                  {t("browsePresets")}
                </Button>
              </div>
            ) : (
              <ul className="grid gap-1">
                {visibleOverlays.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => void select({ type: "overlay", id: entry.id })}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        selection?.type === "overlay" && selection.id === entry.id && "bg-accent",
                      )}
                    >
                      <img src={entry.origin === "ai" ? aiDesignerIcon : overlayIcon} alt="" draggable={false} className="size-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      <span className="text-xs text-muted-foreground">{t(`kinds.${entry.kind}`)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <AiDesigner
            editing={overlay}
            onCreated={async (id) => {
              setTab("mine");
              await refresh();
              await select({ type: "overlay", id });
            }}
            onUpdated={async (id) => {
              await refresh();
              const next = await run(() => studio.getOverlay(id));
              if (next) setOverlay(next);
              // The design changed: reload the preview frame.
              setPreviewUrl(null);
              const url = await run(() => studio.overlayPreviewUrl({ overlayId: id }));
              setPreviewUrl(url ?? null);
            }}
          />
        </aside>

        {/* Preview */}
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          {twitchFollows === "needsReconnect" && (
            <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <span className="flex-1">{t("twitchReconnect")}</span>
              <Button size="sm" variant="outline" onClick={() => setView("settings")}>
                {t("openAccounts")}
              </Button>
            </div>
          )}
          {selection && previewUrl ? (
            <OverlayPreview
              url={previewUrl}
              width={overlay?.width ?? selectedPreset?.width ?? 800}
              height={overlay?.height ?? selectedPreset?.height ?? 600}
              fields={overlay?.fields}
              values={overlay?.values}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <img src={overlayIcon} alt="" draggable={false} className="size-16" />
              <p className="text-sm text-muted-foreground">{t("pick")}</p>
            </div>
          )}
        </main>

        {/* Inspector */}
        <aside className="flex w-[340px] shrink-0 flex-col border-l">
          {selectedPreset ? (
            <div className="grid gap-3 p-4">
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white">{selectedPreset.name}</h3>
              <p className="text-sm text-muted-foreground">{selectedPreset.description}</p>
              <Button onClick={() => void addPreset(selectedPreset.id)}>
                <PlusIcon />
                {t("usePreset")}
              </Button>
            </div>
          ) : overlay ? (
            <>
              <div className="grid gap-3 border-b p-4">
                <Field label={tc("name")} htmlFor="overlay-name">
                  <Input
                    id="overlay-name"
                    key={`${overlay.id}-name`}
                    defaultValue={overlay.name}
                    maxLength={60}
                    onBlur={(event) => {
                      if (event.target.value.trim() && event.target.value !== overlay.name) void patchOverlay({ name: event.target.value });
                    }}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  {(["width", "height"] as const).map((dimension) => (
                    <Field key={dimension} label={t(`editor.${dimension}`)} htmlFor={`overlay-${dimension}`}>
                      <Input
                        id={`overlay-${dimension}`}
                        key={`${overlay.id}-${dimension}-${overlay[dimension]}`}
                        type="number"
                        min={40}
                        max={3840}
                        defaultValue={overlay[dimension]}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value) && value !== overlay[dimension]) void patchOverlay({ [dimension]: value });
                        }}
                      />
                    </Field>
                  ))}
                </div>
                <div className="grid gap-2">
                  <Label>{t("editor.addTo")}</Label>
                  <div className="flex gap-2">
                    <Select value={scene ?? undefined} onValueChange={setTargetScene}>
                      <SelectTrigger aria-label={t("editor.scene")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {scenes.map((entry) => (
                          <SelectItem key={entry.name} value={entry.name}>
                            {entry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={!scene}
                      onClick={async () => {
                        if (!scene) return;
                        await flush();
                        const name = await run(() => studio.addOverlayToScene(overlay.id, scene));
                        if (name) toast.success(t("addedToScene", { name: overlay.name, scene }));
                      }}
                    >
                      <PlusIcon />
                      {tc("add")}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const copy = await run(() => studio.duplicateOverlay(overlay.id));
                      if (!copy) return;
                      await refresh();
                      await select({ type: "overlay", id: copy.id });
                    }}
                  >
                    <CopyIcon />
                    {t("editor.duplicate")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm("reset")}>
                    <RotateCcwIcon />
                    {t("editor.reset")}
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-red-600 dark:text-red-400" onClick={() => setConfirm("delete")}>
                    <Trash2Icon />
                    {tc("remove")}
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {overlay.fields.length === 0 ? (
                  <p className="p-2 text-sm text-muted-foreground">{t("editor.noSettings")}</p>
                ) : (
                  <SettingsPanel overlay={overlay} onChange={changeValue} />
                )}
              </div>
            </>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("pick")}</p>
          )}
        </aside>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        {confirm && overlay && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t(confirm === "delete" ? "editor.deleteTitle" : "editor.resetTitle", { name: overlay.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t(confirm === "delete" ? "editor.deleteDescription" : "editor.resetDescription")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (confirm === "delete") {
                    pendingValues.current = {};
                    const done = await run(async () => {
                      await studio.deleteOverlay(overlay.id);
                      return true;
                    });
                    if (done) {
                      await select(null);
                      await refresh();
                    }
                  } else {
                    pendingValues.current = {};
                    const next = await run(() => studio.resetOverlay(overlay.id));
                    if (next) setOverlay(next);
                  }
                }}
              >
                {t(confirm === "delete" ? "editor.deleteConfirm" : "editor.resetConfirm")}
              </AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}

/** Describe-to-create (and describe-to-change) overlay designer. */
function AiDesigner({
  editing,
  onCreated,
  onUpdated,
}: {
  editing: OverlayDefinition | null;
  onCreated: (id: string) => Promise<void>;
  onUpdated: (id: string) => Promise<void>;
}) {
  const t = useTranslations("overlays.ai");
  const tk = useTranslations("overlays.kinds");
  const te = useTranslations("errors.codes");
  const [account, setAccount] = useState<SeenalyzeAccount | null | undefined>(undefined);
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<OverlayKind>("alert");
  const [mode, setMode] = useState<"new" | "change">("new");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    studio
      .getSeenalyzeAccount()
      .then((result) => {
        if (!cancelled) setAccount(result);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setAccount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fail = (error: unknown) => {
    const code = errorCode(error);
    toast.error(te.has(code) ? te(code) : te("generic"));
    if (code === "seenalyze-signed-out") setAccount(null);
  };

  if (account === undefined) {
    return (
      <div className="flex h-16 items-center justify-center border-t">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (account === null) {
    return (
      <div className="grid gap-2 border-t p-3">
        <p className="text-sm font-semibold">{t("title")}</p>
        <p className="text-xs text-muted-foreground">{t("signInHint")}</p>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setAccount(await studio.signInSeenalyze());
            } catch (error) {
              fail(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2Icon className="animate-spin" /> : <LogInIcon />}
          {busy ? t("waitingForBrowser") : t("signIn")}
        </Button>
      </div>
    );
  }

  if (!account.canUseDesigner) {
    return (
      <div className="grid gap-1 border-t p-3">
        <p className="text-sm font-semibold">{t("title")}</p>
        <p className="text-xs text-muted-foreground">{t("notAvailable")}</p>
      </div>
    );
  }

  const changing = mode === "change" && editing !== null;
  const submit = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const result = await studio.designOverlay({ prompt: text, kind: changing && editing ? editing.kind : kind, overlayId: changing && editing ? editing.id : undefined });
      toast.success(
        result.creditsCharged !== null ? t("doneWithCredits", { name: result.overlay.name, credits: result.creditsCharged }) : t("done", { name: result.overlay.name }),
      );
      setPrompt("");
      if (changing) await onUpdated(result.overlay.id);
      else await onCreated(result.overlay.id);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2 border-t p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <SparklesIcon className="size-4 text-violet-500" />
        {t("title")}
      </p>
      {editing && (
        <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label={t("title")}>
          {(["new", "change"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={mode === entry}
              onClick={() => setMode(entry)}
              className={cn("rounded-md border px-2 py-1 text-xs outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50", mode === entry && "border-primary bg-accent")}
            >
              {t(`modes.${entry}`)}
            </button>
          ))}
        </div>
      )}
      {!changing && (
        <Select value={kind} onValueChange={(value) => setKind(value as OverlayKind)}>
          <SelectTrigger aria-label={t("kind")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OVERLAY_KINDS.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {tk(entry)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Textarea
        value={prompt}
        maxLength={2000}
        rows={3}
        placeholder={changing ? t("changePlaceholder") : t("placeholder")}
        aria-label={t("title")}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
        }}
      />
      <Button size="sm" disabled={busy || !prompt.trim()} onClick={() => void submit()}>
        {busy ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
        {busy ? t("designing") : changing ? t("change") : t("create")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("creditsNote")}</p>
    </div>
  );
}
