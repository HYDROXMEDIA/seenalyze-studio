import {
  ArrowLeftIcon,
  CircleDotIcon,
  FolderOpenIcon,
  Loader2Icon,
  LogInIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SunIcon,
  UsersIcon,
  VideoIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { SeenalyzeAccount } from "../../shared/overlays";
import { RECORDING_FORMATS, SCALE_FILTERS, type DeviceCodePrompt, type RecordingFormat, type ScaleFilter, type VideoSettings } from "../../shared/types";
import { PlatformIcon } from "@/components/PlatformIcon";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Switch } from "@/components/ui/form";
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
import { readTheme, saveTheme, type ThemePreference } from "@/lib/theme";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { isActive } from "./DestinationsDock";
import { TwitchCodeDialog } from "./TwitchCodeDialog";

const CANVAS_PRESETS = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1280, height: 720 },
];
const FPS_OPTIONS = [24, 25, 30, 48, 50, 60];
const SECTIONS = [
  ["general", SlidersHorizontalIcon],
  ["video", VideoIcon],
  ["recording", CircleDotIcon],
  ["accounts", UsersIcon],
  ["permissions", ShieldCheckIcon],
  ["appearance", PaletteIcon],
] as const;
const PERMISSION_KINDS = ["camera", "microphone", "screen"] as const;
type Section = (typeof SECTIONS)[number][0];
/** Common output sizes (16:9 ladder); only those no larger than the canvas are offered. */
const OUTPUT_LADDER = [
  { width: 3840, height: 2160 },
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
  { width: 1152, height: 648 },
  { width: 960, height: 540 },
  { width: 852, height: 480 },
];
const RECORDING_QUALITIES = [
  { id: "low", kbps: 6000 },
  { id: "medium", kbps: 12000 },
  { id: "high", kbps: 25000 },
  { id: "ultra", kbps: 50000 },
] as const;

function outputPresets(baseWidth: number, baseHeight: number): { width: number; height: number }[] {
  const presets = [{ width: baseWidth, height: baseHeight }];
  for (const size of OUTPUT_LADDER) {
    if (size.width <= baseWidth && size.height <= baseHeight && !(size.width === baseWidth && size.height === baseHeight)) presets.push(size);
  }
  return presets;
}

function qualityOptions(current: number): { id: (typeof RECORDING_QUALITIES)[number]["id"] | "custom"; kbps: number }[] {
  return RECORDING_QUALITIES.some((quality) => quality.kbps === current) ? [...RECORDING_QUALITIES] : [...RECORDING_QUALITIES, { id: "custom", kbps: current }];
}

/** Full-page settings view inside the app window. */
export function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tp = useTranslations("permissions");
  const run = useAction();
  const snapshot = useStudio((state) => state.snapshot);
  const setView = useStudio((state) => state.setView);
  const [section, setSection] = useState<Section>("general");
  const [video, setVideo] = useState<VideoSettings | null>(snapshot?.video ?? null);
  const [encoder, setEncoder] = useState(snapshot?.selectedEncoder ?? "");
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  const [pending, setPending] = useState(false);
  const [disconnecting, setDisconnecting] = useState<{ id: string; name: string } | null>(null);
  const [twitchPrompt, setTwitchPrompt] = useState<DeviceCodePrompt | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!snapshot || !video) return null;
  const prefs = snapshot.preferences;
  const locked = snapshot.recording.active || snapshot.destinationStatus.some((status) => isActive(status));
  const videoChanged = JSON.stringify(video) !== JSON.stringify(snapshot.video);
  const dirty = videoChanged || encoder !== snapshot.selectedEncoder;

  const save = async () => {
    setPending(true);
    const ok = await run(async () => {
      if (videoChanged) await studio.setVideoSettings(video);
      if (encoder !== snapshot.selectedEncoder) await studio.setEncoder(encoder);
      return true;
    });
    setPending(false);
    if (ok) toast.success(t("saved"));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-ui-fade">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("back")}
          title={t("back")}
          onClick={() => (dirty ? setConfirmLeave(true) : setView("studio"))}
        >
          <ArrowLeftIcon />
        </Button>
        <h2 className="text-xl font-bold text-neutral-900 dark:text-white">{t("title")}</h2>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setVideo(snapshot.video);
                setEncoder(snapshot.selectedEncoder);
              }}
            >
              {tc("cancel")}
            </Button>
          )}
          <Button size="sm" disabled={!dirty || pending || locked} onClick={() => void save()}>
            {tc("save")}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 border-r p-3" aria-label={t("title")}>
          <ul className="grid gap-1">
            {SECTIONS.map(([entry, Icon]) => (
              <li key={entry}>
                <button
                  type="button"
                  aria-current={section === entry ? "page" : undefined}
                  onClick={() => setSection(entry)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    section === entry && "bg-accent font-medium",
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {t(entry)}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div key={section} className="mx-auto grid max-w-2xl gap-6 animate-ui-rise">
            {section === "general" && (
              <SettingsCard title={t("general")}>
                <ToggleRow
                  id="settings-confirm-live"
                  label={t("confirmGoLive")}
                  hint={t("confirmGoLiveHint")}
                  checked={prefs.confirmGoLive}
                  onChange={(value) => void run(() => studio.setPreferences({ confirmGoLive: value }))}
                />
                <ToggleRow
                  id="settings-keep-awake"
                  label={t("keepAwake")}
                  hint={t("keepAwakeHint")}
                  checked={prefs.keepAwakeWhileLive}
                  onChange={(value) => void run(() => studio.setPreferences({ keepAwakeWhileLive: value }))}
                />
              </SettingsCard>
            )}

            {section === "video" && (
              <>
                {locked && <p className="text-sm text-muted-foreground">{t("lockedWhileLive")}</p>}
                <SettingsCard title={t("videoCanvasGroup")}>
                  <ResolutionField
                    id="settings-canvas"
                    label={t("canvas")}
                    hint={t("canvasHint")}
                    disabled={locked}
                    presets={CANVAS_PRESETS}
                    width={video.baseWidth}
                    height={video.baseHeight}
                    onChange={(width, height) => {
                      const keepSame = video.outputWidth === video.baseWidth && video.outputHeight === video.baseHeight;
                      const fits = video.outputWidth <= width && video.outputHeight <= height;
                      setVideo({
                        ...video,
                        baseWidth: width,
                        baseHeight: height,
                        ...(keepSame || !fits ? { outputWidth: width, outputHeight: height } : {}),
                      });
                    }}
                  />
                  <ResolutionField
                    id="settings-output"
                    label={t("output")}
                    hint={t("outputHint")}
                    disabled={locked}
                    presets={outputPresets(video.baseWidth, video.baseHeight)}
                    width={video.outputWidth}
                    height={video.outputHeight}
                    onChange={(width, height) => setVideo({ ...video, outputWidth: width, outputHeight: height })}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Field label={t("fps")} htmlFor="settings-fps">
                      <Select disabled={locked} value={String(video.fps)} onValueChange={(value) => setVideo({ ...video, fps: Number(value) })}>
                        <SelectTrigger id="settings-fps">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FPS_OPTIONS.map((fps) => (
                            <SelectItem key={fps} value={String(fps)}>
                              {fps}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t("scaleFilter")} htmlFor="settings-scale">
                      <Select disabled={locked} value={video.scaleFilter} onValueChange={(value) => setVideo({ ...video, scaleFilter: value as ScaleFilter })}>
                        <SelectTrigger id="settings-scale">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SCALE_FILTERS.map((filter) => (
                            <SelectItem key={filter} value={filter}>
                              {t(`scaleFilters.${filter}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("scaleFilterHint")}</p>
                </SettingsCard>
                <SettingsCard title={t("encoderGroup")}>
                  <Field label={t("encoder")} htmlFor="settings-encoder">
                    <Select disabled={locked || snapshot.encoders.length === 0} value={encoder} onValueChange={setEncoder}>
                      <SelectTrigger id="settings-encoder">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {snapshot.encoders.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {t(`encoders.${option.id}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <p className="text-xs text-muted-foreground">{t("encoderHint")}</p>
                </SettingsCard>
              </>
            )}

            {section === "recording" && (
              <SettingsCard title={t("recording")}>
                {snapshot.recording.active && <p className="text-sm text-muted-foreground">{t("recordingLockedWhileActive")}</p>}
                <Field label={t("recordingFolder")} htmlFor="settings-folder">
                  <div className="flex gap-2">
                    <Input id="settings-folder" readOnly value={snapshot.recordingFolder} />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("chooseFolder")}
                      title={t("chooseFolder")}
                      onClick={() => void run(() => studio.chooseRecordingFolder())}
                    >
                      <FolderOpenIcon />
                    </Button>
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t("recordingFormat")} htmlFor="settings-format">
                    <Select
                      disabled={snapshot.recording.active}
                      value={prefs.recordingFormat}
                      onValueChange={(value) => void run(() => studio.setPreferences({ recordingFormat: value as RecordingFormat }))}
                    >
                      <SelectTrigger id="settings-format">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RECORDING_FORMATS.map((format) => (
                          <SelectItem key={format} value={format}>
                            {t(`recordingFormats.${format}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("recordingQuality")} htmlFor="settings-quality">
                    <Select
                      disabled={snapshot.recording.active}
                      value={String(prefs.recordingBitrateKbps)}
                      onValueChange={(value) => void run(() => studio.setPreferences({ recordingBitrateKbps: Number(value) }))}
                    >
                      <SelectTrigger id="settings-quality">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {qualityOptions(prefs.recordingBitrateKbps).map(({ id, kbps }) => (
                          <SelectItem key={kbps} value={String(kbps)}>
                            {id === "custom" ? t("recordingBitrate", { kbps }) : t(`recordingQualities.${id}`, { kbps })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">{t("recordingFormatHint")}</p>
                <p className="text-xs text-muted-foreground">{t("recordingQualityHint")}</p>
              </SettingsCard>
            )}

            {section === "accounts" && (
              <SettingsCard title={t("accounts")}>
                <SeenalyzeAccountRow />
                {snapshot.accounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noAccounts")}</p>
                ) : (
                  <ul className="grid gap-2">
                    {snapshot.accounts.map((account) => (
                      <li key={account.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                        <PlatformIcon platform={account.platform} />
                        <span className="min-w-0 flex-1 truncate text-sm">{account.displayName}</span>
                        {account.platform === "twitch" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              const prompt = await run(() => studio.connectTwitch());
                              if (prompt) setTwitchPrompt(prompt);
                            }}
                          >
                            <RefreshCwIcon />
                            {t("reconnect")}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setDisconnecting({ id: account.id, name: account.displayName })}>
                          <LogOutIcon />
                          {t("disconnect")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </SettingsCard>
            )}

            {section === "permissions" && (
              <SettingsCard title={t("permissions")}>
                {PERMISSION_KINDS.every((kind) => snapshot.permissions[kind] === "unsupported") ? (
                  <p className="text-sm text-muted-foreground">{tp("noneNeeded")}</p>
                ) : (
                  <ul className="grid gap-2">
                    {PERMISSION_KINDS.filter((kind) => snapshot.permissions[kind] !== "unsupported").map((kind) => {
                      const state = snapshot.permissions[kind];
                      return (
                        <li key={kind} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                          <span className="min-w-0 flex-1 text-sm">{tp(`${kind}.label`)}</span>
                          <span className={cn("text-sm", state === "granted" ? "text-brand-green" : "text-muted-foreground")}>{tp(`states.${state}`)}</span>
                          {state === "not-determined" && (
                            <Button size="sm" variant="outline" onClick={() => void run(() => studio.requestPermission(kind))}>
                              {tp("allow")}
                            </Button>
                          )}
                          {(state === "denied" || state === "restricted") && (
                            <Button size="sm" variant="outline" onClick={() => void run(() => studio.openPermissionSettings(kind))}>
                              {tp("openSettings")}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </SettingsCard>
            )}

            {section === "appearance" && (
              <SettingsCard title={t("appearance")}>
                <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label={t("appearance")}>
                  {(
                    [
                      ["dark", MoonIcon],
                      ["light", SunIcon],
                      ["system", MonitorIcon],
                    ] as const
                  ).map(([option, Icon]) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={theme === option}
                      onClick={() => {
                        setTheme(option);
                        saveTheme(option);
                      }}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-lg border p-4 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        theme === option && "border-primary bg-accent",
                      )}
                    >
                      <Icon aria-hidden className="size-12" strokeWidth={1.5} />
                      {t(`themes.${option}`)}
                    </button>
                  ))}
                </div>
              </SettingsCard>
            )}
          </div>
        </div>
      </div>

      <TwitchCodeDialog prompt={twitchPrompt} onClose={() => setTwitchPrompt(null)} />
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        {confirmLeave && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("discardTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("discardDescription")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{t("keepEditing")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => setView("studio")}>{t("discard")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <AlertDialog open={disconnecting !== null} onOpenChange={(value) => !value && setDisconnecting(null)}>
        {disconnecting && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("disconnectTitle", { name: disconnecting.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t("disconnectDescription")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(() => studio.disconnectAccount(disconnecting.id))}>{t("disconnect")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-6">
      <h3 className="text-xl font-bold text-neutral-900 dark:text-white">{title}</h3>
      {children}
    </section>
  );
}

function ToggleRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start gap-4">
      <div className="grid min-w-0 flex-1 gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Resolution picker: presets plus a custom width × height entry. */
function ResolutionField({
  id,
  label,
  hint,
  disabled,
  presets,
  width,
  height,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  disabled: boolean;
  presets: { width: number; height: number }[];
  width: number;
  height: number;
  onChange: (width: number, height: number) => void;
}) {
  const t = useTranslations("settings");
  const current = `${width}x${height}`;
  const isPreset = presets.some((size) => `${size.width}x${size.height}` === current);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState({ width: String(width), height: String(height) });
  const commit = (next: { width: string; height: string }) => {
    setDraft(next);
    const w = Math.round(Number(next.width));
    const h = Math.round(Number(next.height));
    if (w >= 128 && h >= 128 && w <= 7680 && h <= 7680) onChange(w - (w % 2), h - (h % 2));
  };
  return (
    <div className="grid gap-2">
      <Field label={label} htmlFor={id}>
        <Select
          disabled={disabled}
          value={custom || !isPreset ? "custom" : current}
          onValueChange={(value) => {
            if (value === "custom") {
              setCustom(true);
              setDraft({ width: String(width), height: String(height) });
              return;
            }
            setCustom(false);
            const [w, h] = value.split("x").map(Number);
            onChange(w, h);
          }}
        >
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((size) => (
              <SelectItem key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>
                {t("resolutionValue", size)}
              </SelectItem>
            ))}
            <SelectItem value="custom">{t("custom")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {(custom || !isPreset) && (
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("width")} htmlFor={`${id}-width`}>
            <Input
              id={`${id}-width`}
              type="number"
              inputMode="numeric"
              min={128}
              max={7680}
              step={2}
              disabled={disabled}
              value={draft.width}
              onChange={(event) => commit({ ...draft, width: event.target.value })}
            />
          </Field>
          <Field label={t("height")} htmlFor={`${id}-height`}>
            <Input
              id={`${id}-height`}
              type="number"
              inputMode="numeric"
              min={128}
              max={7680}
              step={2}
              disabled={disabled}
              value={draft.height}
              onChange={(event) => commit({ ...draft, height: event.target.value })}
            />
          </Field>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** The SEENALYZE account used for the AI overlay designer and credits. */
function SeenalyzeAccountRow() {
  const t = useTranslations("settings");
  const te = useTranslations("errors.codes");
  const [account, setAccount] = useState<SeenalyzeAccount | null | undefined>(undefined);
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

  const act = async (call: () => Promise<SeenalyzeAccount | null>) => {
    setBusy(true);
    try {
      setAccount(await call());
    } catch (error) {
      const code = errorCode(error);
      toast.error(te.has(code) ? te(code) : te("generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{t("seenalyzeAccount")}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {account === undefined ? "" : account ? (account.email ?? account.displayName ?? "") : t("seenalyzeSignedOut")}
        </span>
      </span>
      {account === undefined ? (
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      ) : account ? (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(async () => (await studio.signOutSeenalyze(), null))}>
          <LogOutIcon />
          {t("signOut")}
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => studio.signInSeenalyze())}>
          {busy ? <Loader2Icon className="animate-spin" /> : <LogInIcon />}
          {t("signIn")}
        </Button>
      )}
    </div>
  );
}
