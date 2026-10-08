import {
  ArrowLeftIcon,
  CircleDotIcon,
  FolderOpenIcon,
  KeyboardIcon,
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
  WandSparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { SeenalyzeAccount } from "../../shared/overlays";
import { RECORDING_FORMATS, SCALE_FILTERS, type DeviceCodePrompt, type RecordingFormat, type ScaleFilter, type VideoSettings } from "../../shared/types";
import { PlatformIcon } from "@/components/PlatformIcon";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Field, Input, Label } from "@/components/ui/form";
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
import { COLOR_PRESETS, CUSTOM_THEME_ID, THEME_ROLES, seedCustomRoles, type ColorPreset, type ColorThemeChoice, type ThemeRole, type ThemeVariant } from "@/lib/color-theme";
import { readColorTheme, readTheme, saveColorTheme, saveTheme, type ThemePreference } from "@/lib/theme";
import { saveLanguage, useLanguage } from "@/lib/language";
import { LOCALE_NAMES, UI_LOCALES, isUiLocale } from "@/i18n";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { isActive } from "./DestinationsDock";
import { TwitchCodeDialog } from "./TwitchCodeDialog";
import { HotkeysSettings } from "./HotkeysSettings";
import { RecordingAutomationCard, RecordingQualityField } from "./RecordingSettings";
import { recommendEncoder } from "../../shared/setup";
import { AdvancedSettingsCard } from "./settings/AdvancedSettingsCard";
import { SettingsCard, ToggleRow } from "./settings/parts";
import { useSetupWizard } from "./setup/SetupWizard";
import { AudioFormatCard, RecordingTracksField, VideoFormatFields } from "./settings/FormatSettings";
import { ProfileCard } from "./settings/ProfileCard";

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
  ["hotkeys", KeyboardIcon],
  ["accounts", UsersIcon],
  ["permissions", ShieldCheckIcon],
  ["appearance", PaletteIcon],
  ["advanced", WrenchIcon],
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

function outputPresets(baseWidth: number, baseHeight: number): { width: number; height: number }[] {
  const presets = [{ width: baseWidth, height: baseHeight }];
  for (const size of OUTPUT_LADDER) {
    if (size.width <= baseWidth && size.height <= baseHeight && !(size.width === baseWidth && size.height === baseHeight)) presets.push(size);
  }
  return presets;
}

/** Full-page settings view inside the app window. */
export function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tp = useTranslations("permissions");
  const run = useAction();
  const snapshot = useStudio((state) => state.snapshot);
  const setView = useStudio((state) => state.setView);
  const showSetup = useSetupWizard((state) => state.show);
  const [section, setSection] = useState<Section>("general");
  const [video, setVideo] = useState<VideoSettings | null>(snapshot?.video ?? null);
  const [encoder, setEncoder] = useState(snapshot?.selectedEncoder ?? "");
  const [pending, setPending] = useState(false);
  const [disconnecting, setDisconnecting] = useState<{ id: string; name: string } | null>(null);
  const [twitchPrompt, setTwitchPrompt] = useState<DeviceCodePrompt | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Settings changed elsewhere (a profile switch) replace the draft unless it has unsaved edits.
  const [synced, setSynced] = useState({ video: JSON.stringify(snapshot?.video ?? null), encoder: snapshot?.selectedEncoder ?? "" });
  if (snapshot && (JSON.stringify(snapshot.video) !== synced.video || snapshot.selectedEncoder !== synced.encoder)) {
    if (JSON.stringify(video) === synced.video && encoder === synced.encoder) {
      setVideo(snapshot.video);
      setEncoder(snapshot.selectedEncoder);
    }
    setSynced({ video: JSON.stringify(snapshot.video), encoder: snapshot.selectedEncoder });
  }

  if (!snapshot || !video) return null;
  const prefs = snapshot.preferences;
  const streaming = snapshot.destinationStatus.some((status) => isActive(status));
  const locked = snapshot.recording.active || streaming;
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
            {section === "general" && <ProfileCard locked={locked || snapshot.virtualCamera.active} dirty={dirty} />}

            {section === "general" && (
              <SettingsCard title={t("general")}>
                {streaming && <p className="text-sm text-muted-foreground">{t("streamingLockedWhileLive")}</p>}
                <ToggleRow
                  id="settings-confirm-live"
                  label={t("confirmGoLive")}
                  hint={t("confirmGoLiveHint")}
                  checked={prefs.confirmGoLive}
                  disabled={streaming}
                  onChange={(value) => void run(() => studio.setPreferences({ confirmGoLive: value }))}
                />
                <ToggleRow
                  id="settings-confirm-end"
                  label={t("confirmEndStream")}
                  hint={t("confirmEndStreamHint")}
                  checked={prefs.confirmEndStream}
                  disabled={streaming}
                  onChange={(value) => void run(() => studio.setPreferences({ confirmEndStream: value }))}
                />
                <ToggleRow
                  id="settings-keep-awake"
                  label={t("keepAwake")}
                  hint={t("keepAwakeHint")}
                  checked={prefs.keepAwakeWhileLive}
                  disabled={streaming}
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
                      <Select disabled={locked} value={String(video.fps)} onValueChange={(value) => setVideo({ ...video, fps: Number(value), fpsNum: undefined, fpsDen: undefined })}>
                        <SelectTrigger id="settings-fps">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[...new Set([...FPS_OPTIONS, video.fps])].sort((a, b) => a - b).map((fps) => (
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
                  <VideoFormatFields video={video} encoder={encoder} disabled={locked} onChange={setVideo} />
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
                            {option.id === recommendEncoder(snapshot.encoders)?.id ? ` · ${t("recommended")}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <p className="text-xs text-muted-foreground">{t("encoderHint")}</p>
                </SettingsCard>
                <AudioFormatCard disabled={locked || snapshot.virtualCamera.active} />
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
                  <RecordingQualityField disabled={snapshot.recording.active} />
                </div>
                <p className="text-xs text-muted-foreground">{t("recordingFormatHint")}</p>
                <p className="text-xs text-muted-foreground">{t("recordingQualityHint")}</p>
                <RecordingTracksField disabled={locked || snapshot.virtualCamera.active} />
              </SettingsCard>
            )}

            {section === "recording" && <RecordingAutomationCard />}

            {section === "hotkeys" && <HotkeysSettings />}

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
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={snapshot.destinations.some((destination) => destination.accountId === account.id && isActive(snapshot.destinationStatus.find((status) => status.id === destination.id)))}
                          onClick={() => setDisconnecting({ id: account.id, name: account.displayName })}
                        >
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

            {section === "general" && (
              <SettingsCard title={t("setupAgain")}>
                <div className="flex items-center gap-4">
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t("setupAgainHint")}</p>
                  <Button variant="outline" size="sm" disabled={locked} onClick={showSetup}>
                    <WandSparklesIcon />
                    {t("setupAgainAction")}
                  </Button>
                </div>
              </SettingsCard>
            )}

            {section === "appearance" && <AppearanceCard />}

            {section === "advanced" && <AdvancedSettingsCard />}
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

/** Light, dark or system mode, then a color theme: a preset or a custom palette for each role. */
function AppearanceCard() {
  const t = useTranslations("settings");
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  const [colorTheme, setColorTheme] = useState<ColorThemeChoice>(readColorTheme);
  const [editing, setEditing] = useState<ThemeVariant>(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));
  // Swatches show the colors for the appearance in use; the class is already updated when this re-renders.
  const activeVariant: ThemeVariant = document.documentElement.classList.contains("dark") ? "dark" : "light";
  const custom = colorTheme.id === CUSTOM_THEME_ID ? colorTheme.custom : null;

  const choose = (next: ColorThemeChoice) => {
    setColorTheme(next);
    saveColorTheme(next);
  };
  const customize = () => {
    if (!custom) choose({ id: CUSTOM_THEME_ID, custom: seedCustomRoles(colorTheme) });
  };
  const editRole = (role: ThemeRole, value: string) => {
    if (!custom) return;
    choose({ id: CUSTOM_THEME_ID, custom: { ...custom, [editing]: { ...custom[editing], [role]: value } } });
  };

  const presetButton = (preset: ColorPreset) => {
    const name = t(`colorTheme.presets.${preset.id}`);
    const selected = colorTheme.id === preset.id;
    return (
      <button
        key={preset.id}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={name}
        onClick={() => choose({ id: preset.id, custom: null })}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border p-3 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
          selected && "border-primary bg-accent",
        )}
      >
        <span className="size-7 rounded-full border" style={{ background: preset.primary[activeVariant] }} aria-hidden />
        <span className="w-full truncate text-center">{name}</span>
      </button>
    );
  };

  return (
    <SettingsCard title={t("appearance")}>
      <div className="space-y-2">
        <h4 className="text-base font-semibold text-neutral-900 dark:text-white">{t("language")}</h4>
        <LanguageSelect />
      </div>

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

      <h4 className="text-base font-semibold text-neutral-900 dark:text-white">{t("colorTheme.title")}</h4>
      {(["classic", "vibrant"] as const).map((group) => (
        <div key={group} className="grid gap-2">
          <span className="text-xs text-muted-foreground">{t(`colorTheme.${group}`)}</span>
          <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={t(`colorTheme.${group}`)}>
            {COLOR_PRESETS.filter((preset) => preset.group === group).map(presetButton)}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={t("colorTheme.custom")}>
        <button
          type="button"
          role="radio"
          aria-checked={custom !== null}
          onClick={customize}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border p-3 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
            custom && "border-primary bg-accent",
          )}
        >
          <PaletteIcon aria-hidden className="size-7" strokeWidth={1.5} />
          <span className="w-full truncate text-center">{t("colorTheme.custom")}</span>
        </button>
      </div>

      {custom && (
        <div className="grid gap-4 rounded-lg border p-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("colorTheme.editing")}>
            {(["light", "dark"] as const).map((variant) => (
              <button
                key={variant}
                type="button"
                role="radio"
                aria-checked={editing === variant}
                onClick={() => setEditing(variant)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  editing === variant && "border-primary bg-accent font-medium",
                )}
              >
                {t(`themes.${variant}`)}
              </button>
            ))}
          </div>
          {THEME_ROLES.map((role) => (
            <div key={role} className="flex items-center gap-3">
              <Label htmlFor={`theme-role-${role}`} className="min-w-0 flex-1 text-sm font-normal">
                {t(`colorTheme.roles.${role}`)}
              </Label>
              <div className="w-44">
                <ColorPicker
                  id={`theme-role-${role}`}
                  label={t(`colorTheme.roles.${role}`)}
                  value={custom[editing][role]}
                  opacity={false}
                  onChange={(value) => editRole(role, value)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
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

/** Interface language: saved on this device and, when signed in, on the SEENALYZE account. */
function LanguageSelect() {
  const t = useTranslations("settings");
  const language = useLanguage();
  const [busy, setBusy] = useState(false);

  const choose = async (next: string) => {
    if (!isUiLocale(next) || next === language) return;
    const previous = language;
    saveLanguage(next);
    setBusy(true);
    try {
      await studio.setSeenalyzeLanguage(next);
    } catch (error) {
      console.error(error);
      saveLanguage(previous);
      toast.error(t("languageSyncError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      aria-label={t("language")}
      value={language}
      disabled={busy}
      onChange={(event) => void choose(event.target.value)}
      className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
    >
      {UI_LOCALES.map((locale) => (
        <option key={locale} value={locale}>
          {LOCALE_NAMES[locale]}
        </option>
      ))}
    </select>
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

  // A language saved on the account is the source of truth while signed in.
  const accountLanguage = account?.language;
  useEffect(() => {
    if (isUiLocale(accountLanguage)) saveLanguage(accountLanguage);
  }, [accountLanguage]);

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
