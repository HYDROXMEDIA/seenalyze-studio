import { ArrowLeftIcon, FolderOpenIcon, Loader2Icon, LogInIcon, LogOutIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { SeenalyzeAccount } from "../../shared/overlays";
import type { DeviceCodePrompt, VideoSettings } from "../../shared/types";
import darkIcon from "@/assets/icons/dark.png";
import lightIcon from "@/assets/icons/light.png";
import systemIcon from "@/assets/icons/system_desktop.png";
import { PlatformIcon } from "@/components/PlatformIcon";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
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
const SECTIONS = ["video", "recording", "accounts", "permissions", "appearance"] as const;
const PERMISSION_KINDS = ["camera", "microphone", "screen"] as const;
type Section = (typeof SECTIONS)[number];

/** Full-page settings view inside the app window. */
export function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tp = useTranslations("permissions");
  const run = useAction();
  const snapshot = useStudio((state) => state.snapshot);
  const setView = useStudio((state) => state.setView);
  const [section, setSection] = useState<Section>("video");
  const [video, setVideo] = useState<VideoSettings | null>(snapshot?.video ?? null);
  const [encoder, setEncoder] = useState(snapshot?.selectedEncoder ?? "");
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  const [pending, setPending] = useState(false);
  const [disconnecting, setDisconnecting] = useState<{ id: string; name: string } | null>(null);
  const [twitchPrompt, setTwitchPrompt] = useState<DeviceCodePrompt | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!snapshot || !video) return null;
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="sm" onClick={() => (dirty ? setConfirmLeave(true) : setView("studio"))}>
          <ArrowLeftIcon />
          {t("back")}
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
            {SECTIONS.map((entry) => (
              <li key={entry}>
                <button
                  type="button"
                  aria-current={section === entry ? "page" : undefined}
                  onClick={() => setSection(entry)}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    section === entry && "bg-accent font-medium",
                  )}
                >
                  {t(entry)}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto grid max-w-2xl gap-6">
            {section === "video" && (
              <SettingsCard title={t("video")}>
                {locked && <p className="text-sm text-muted-foreground">{t("lockedWhileLive")}</p>}
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t("canvas")} htmlFor="settings-canvas">
                    <Select
                      disabled={locked}
                      value={`${video.baseWidth}x${video.baseHeight}`}
                      onValueChange={(value) => {
                        const [width, height] = value.split("x").map(Number);
                        setVideo({ ...video, baseWidth: width, baseHeight: height, outputWidth: width, outputHeight: height });
                      }}
                    >
                      <SelectTrigger id="settings-canvas">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CANVAS_PRESETS.map(({ width, height }) => (
                          <SelectItem key={`${width}x${height}`} value={`${width}x${height}`}>
                            {t("resolutionValue", { width, height })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
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
                </div>
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
              </SettingsCard>
            )}

            {section === "recording" && (
              <SettingsCard title={t("recording")}>
                <Field label={t("recordingFolder")} htmlFor="settings-folder">
                  <div className="flex gap-2">
                    <Input id="settings-folder" readOnly value={snapshot.recordingFolder} />
                    <Button variant="outline" size="icon" aria-label={t("chooseFolder")} onClick={() => void run(() => studio.chooseRecordingFolder())}>
                      <FolderOpenIcon />
                    </Button>
                  </div>
                </Field>
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
                      ["dark", darkIcon],
                      ["light", lightIcon],
                      ["system", systemIcon],
                    ] as const
                  ).map(([option, icon]) => (
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
                      <img src={icon} alt="" className="size-12" draggable={false} />
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
