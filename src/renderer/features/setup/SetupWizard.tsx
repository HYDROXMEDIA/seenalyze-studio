import { CameraIcon, CircleCheckIcon, CircleDotIcon, ClapperboardIcon, MonitorIcon, PictureInPicture2Icon, RadioIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { create } from "zustand";
import { bitrateRange } from "../../../shared/platforms";
import {
  layoutSources,
  recommendEncoder,
  recommendVideo,
  setupProfile,
  streams,
  suggestBitrates,
  uniqueSceneName,
  type SetupGoal,
  type StarterLayout,
} from "../../../shared/setup";
import type { DeviceCodePrompt, Platform, StudioSnapshot, VideoSettings } from "../../../shared/types";
import { PlatformIcon } from "@/components/PlatformIcon";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { TwitchCodeDialog } from "../TwitchCodeDialog";
import { ImportDialog } from "../ImportDialog";

/** Opens the setup again from Settings. */
export const useSetupWizard = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

const PLATFORMS: Platform[] = ["youtube", "twitch"];
const GOALS: [SetupGoal, LucideIcon][] = [
  ["stream", RadioIcon],
  ["record", CircleDotIcon],
  ["both", ClapperboardIcon],
];
const LAYOUTS: [StarterLayout | "none", LucideIcon | null][] = [
  ["screenCamera", PictureInPicture2Icon],
  ["cameraOnly", CameraIcon],
  ["screenOnly", MonitorIcon],
  ["none", null],
];
type Step = "goal" | "video" | "accounts" | "layout";

/**
 * First-run setup: shown once to new users (until finished or skipped) and on
 * demand from Settings. Every step can be skipped and closing ends the setup.
 */
export function SetupWizard() {
  const pending = useStudio((state) => Boolean(state.snapshot?.ready && state.snapshot.setupPending));
  const manual = useSetupWizard((state) => state.open);
  const hide = useSetupWizard((state) => state.hide);
  const open = pending || manual;
  const close = () => {
    hide();
    if (pending) studio.completeSetup().catch(console.error);
  };
  const snapshot = useStudio((state) => state.snapshot);
  return (
    <Dialog open={open && snapshot !== null} onOpenChange={(next) => !next && close()}>
      {open && snapshot && <Wizard snapshot={snapshot} firstRun={pending} onClose={close} />}
    </Dialog>
  );
}

function layoutAvailable(option: StarterLayout | "none", kinds: StudioSnapshot["availableSourceKinds"]): boolean {
  if (option === "none") return true;
  return layoutSources(option, 1920, 1080).every((source) => kinds.includes(source.kind));
}

function screenPixels(): { screenWidth: number; screenHeight: number } {
  const ratio = window.devicePixelRatio || 1;
  return { screenWidth: Math.round(window.screen.width * ratio), screenHeight: Math.round(window.screen.height * ratio) };
}

function Wizard({ snapshot, firstRun, onClose }: { snapshot: StudioSnapshot; firstRun: boolean; onClose: () => void }) {
  const t = useTranslations("setup");
  const tc = useTranslations("common");
  const tRoot = useTranslations();
  const run = useAction();
  const [step, setStep] = useState<Step>("goal");
  const [goal, setGoal] = useState<SetupGoal>("stream");
  const [encoderId, setEncoderId] = useState(() => recommendEncoder(snapshot.encoders)?.id ?? snapshot.selectedEncoder);
  const [fps, setFps] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<Set<Step>>(() => new Set());
  const [layout, setLayout] = useState<StarterLayout | "none">(() =>
    firstRun ? (LAYOUTS.map(([option]) => option).find((option) => layoutAvailable(option, snapshot.availableSourceKinds)) ?? "none") : "none",
  );
  const [twitchPrompt, setTwitchPrompt] = useState<DeviceCodePrompt | null>(null);
  const [connecting, setConnecting] = useState<Platform | null>(null);
  const [applying, setApplying] = useState(false);
  // Scene collections from OBS Studio / Streamlabs that can be imported instead of a starter layout.
  const [importable, setImportable] = useState(false);
  const [importing, setImporting] = useState(false);
  const keepOpen = useSetupWizard((state) => state.show);
  useEffect(() => {
    let cancelled = false;
    studio
      .findImports()
      .then((found) => {
        if (!cancelled) setImportable(found.length > 0);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  const recommended = recommendEncoder(snapshot.encoders);
  const encoder = snapshot.encoders.find((entry) => entry.id === encoderId);
  const suggestedVideo = recommendVideo({ ...screenPixels(), goal, hardware: encoder?.hardware ?? false });
  const video: VideoSettings = { ...suggestedVideo, fps: fps ?? suggestedVideo.fps };
  const steps: Step[] = streams(goal) ? ["goal", "video", "accounts", "layout"] : ["goal", "video", "layout"];
  const index = Math.max(0, steps.indexOf(step));
  const last = index === steps.length - 1;

  const accountFor = (platform: Platform) => snapshot.accounts.find((account) => account.platform === platform);
  const hasDestination = (accountId: string) => snapshot.destinations.some((destination) => destination.accountId === accountId);
  // Connected accounts that still need a destination get one with the suggested settings.
  const newDestinations = PLATFORMS.filter((platform) => {
    const account = accountFor(platform);
    return account && !hasDestination(account.id);
  });
  // A skipped video step keeps the current settings, so suggestions follow them.
  const videoFor = (skippedSteps: Set<Step>) => (skippedSteps.has("video") ? snapshot.video : video);
  const bitratesFor = (target: VideoSettings) => suggestBitrates(PLATFORMS.filter((platform) => accountFor(platform)), target.outputHeight, target.fps);
  const bitrates = bitratesFor(videoFor(skipped));
  const next = (skip: boolean) => {
    const updated = new Set(skipped);
    if (skip) updated.add(step);
    else updated.delete(step);
    setSkipped(updated);
    if (last) void finish(updated);
    else setStep(steps[index + 1]);
  };

  const connect = async (platform: Platform) => {
    if (connecting) return;
    setConnecting(platform);
    try {
      if (platform === "twitch") {
        const prompt = await run(() => studio.connectTwitch());
        if (prompt) setTwitchPrompt(prompt);
        return;
      }
      toast.info(tRoot("destinations.browserSignIn"));
      await run(() => studio.connectYouTube());
    } finally {
      setConnecting(null);
    }
  };

  const addLayout = async (choice: StarterLayout, target: VideoSettings) => {
    const scene = uniqueSceneName(t(`layouts.${choice}`), snapshot.scenes.map((entry) => entry.name));
    const created = await run(async () => {
      await studio.createScene(scene);
      return true;
    });
    if (!created) return;
    for (const source of layoutSources(choice, target.baseWidth, target.baseHeight)) {
      const name = await run(() => studio.addSource(scene, source.kind, tRoot(`sources.kinds.${source.kind}`)));
      if (!name || !source.transform) continue;
      const placement = source.transform;
      const latest = await studio.getSnapshot();
      const item = latest.scenes.find((entry) => entry.name === scene)?.items.find((entry) => entry.sourceName === name);
      if (item) await run(() => studio.setItemTransform(scene, item.id, placement));
    }
    await run(() => studio.setActiveScene(scene));
  };

  const finish = async (skippedSteps: Set<Step>) => {
    setApplying(true);
    let target = videoFor(skippedSteps);
    try {
      if (!skippedSteps.has("video")) {
        if (JSON.stringify(video) !== JSON.stringify(snapshot.video)) {
          const applied = await run(async () => {
            await studio.setVideoSettings(video);
            return true;
          });
          // Destinations and the layout follow the video settings actually in use.
          if (!applied) target = snapshot.video;
        }
        if (encoder && encoder.id !== snapshot.selectedEncoder) await run(() => studio.setEncoder(encoder.id));
      }
      const targetBitrates = bitratesFor(target);
      if (streams(goal) && !skippedSteps.has("accounts")) {
        for (const platform of newDestinations) {
          const account = accountFor(platform);
          if (!account) continue;
          await run(() =>
            studio.saveDestination({
              platform,
              name: tRoot(`destinations.platforms.${platform}`),
              enabled: true,
              mode: "account",
              server: "",
              accountId: account.id,
              profile: setupProfile(platform, target, targetBitrates[platform] ?? bitrateRange(platform, target.outputHeight, target.fps).recommended),
            }),
          );
        }
      }
      if (!skippedSteps.has("layout") && layout !== "none" && layoutAvailable(layout, snapshot.availableSourceKinds)) await addLayout(layout, target);
      toast.success(t("done"));
    } finally {
      setApplying(false);
      onClose();
    }
  };

  return (
    <DialogContent className="sm:max-w-xl" onEscapeKeyDown={(event) => applying && event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
      <DialogHeader>
        <p className="text-xs text-muted-foreground">{t("progress", { step: index + 1, total: steps.length })}</p>
        <DialogTitle>{t(`steps.${step}.title`)}</DialogTitle>
        <DialogDescription>{t(`steps.${step}.description`)}</DialogDescription>
      </DialogHeader>

      {step === "goal" && (
        <ChoiceGroup label={t("steps.goal.title")}>
          {GOALS.map(([option, Icon]) => (
            <Choice key={option} selected={goal === option} onSelect={() => setGoal(option)} icon={<Icon aria-hidden className="size-5" />} label={t(`goals.${option}`)} />
          ))}
        </ChoiceGroup>
      )}

      {step === "goal" && importable && (
        <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
          <span className="min-w-0 flex-1 text-sm">{tRoot("workspace.import.setupFound")}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={applying}
            onClick={() => {
              // Importing restarts the studio; this keeps the setup open meanwhile.
              keepOpen();
              setImporting(true);
            }}
          >
            {tRoot("workspace.import.setupAction")}
          </Button>
        </div>
      )}

      {step === "video" && (
        <div className="grid gap-4">
          <Field label={tRoot("settings.encoder")} htmlFor="setup-encoder">
            <Select value={encoderId} onValueChange={setEncoderId} disabled={snapshot.encoders.length === 0}>
              <SelectTrigger id="setup-encoder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {snapshot.encoders.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {tRoot(`settings.encoders.${option.id}`)}
                    {option.id === recommended?.id ? ` · ${t("recommended")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {encoder && (
            <p className={cn("text-sm", encoder.hardware ? "text-brand-green" : "text-muted-foreground")}>
              {encoder.hardware ? t("hardwareFound") : t("softwareOnly")}
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1 rounded-lg border px-3 py-2">
              <span className="text-xs text-muted-foreground">{tRoot("settings.canvas")}</span>
              <span className="text-sm font-medium tabular-nums">{tRoot("settings.resolutionValue", { width: video.baseWidth, height: video.baseHeight })}</span>
            </div>
            <div className="grid gap-1 rounded-lg border px-3 py-2">
              <span className="text-xs text-muted-foreground">{tRoot("settings.output")}</span>
              <span className="text-sm font-medium tabular-nums">{tRoot("settings.resolutionValue", { width: video.outputWidth, height: video.outputHeight })}</span>
            </div>
          </div>
          <Field label={tRoot("settings.fps")} htmlFor="setup-fps">
            <Select value={String(video.fps)} onValueChange={(value) => setFps(Number(value))}>
              <SelectTrigger id="setup-fps">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[30, 60].map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {t(option === 60 ? "fpsSmooth" : "fpsStandard", { fps: option })}
                    {option === suggestedVideo.fps ? ` · ${t("recommended")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      {step === "accounts" && (
        <ul className="grid gap-2">
          {PLATFORMS.map((platform) => {
            const account = accountFor(platform);
            const configured = snapshot.platformsConfigured[platform];
            return (
              <li key={platform} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <PlatformIcon platform={platform} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{account?.displayName ?? tRoot(`destinations.platforms.${platform}`)}</p>
                  {account && bitrates[platform] !== undefined && (
                    <p className="text-xs text-muted-foreground tabular-nums">{t("suggestedBitrate", { kbps: bitrates[platform] ?? 0 })}</p>
                  )}
                </div>
                {account ? (
                  <CircleCheckIcon aria-label={t("connected")} className="size-5 text-brand-green" />
                ) : configured ? (
                  <Button size="sm" variant="outline" disabled={connecting !== null} onClick={() => void connect(platform)}>
                    {tRoot("destinations.connectAccount", { platform: tRoot(`destinations.platforms.${platform}`) })}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("useStreamKeyLater")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {step === "layout" && (
        <ChoiceGroup label={t("steps.layout.title")} columns={2}>
          {LAYOUTS.map(([option, Icon]) => (
            <Choice
              key={option}
              selected={layout === option}
              disabled={!layoutAvailable(option, snapshot.availableSourceKinds)}
              onSelect={() => setLayout(option)}
              icon={Icon ? <Icon aria-hidden className="size-5" /> : null}
              label={t(`layouts.${option}`)}
            />
          ))}
        </ChoiceGroup>
      )}

      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" disabled={applying} onClick={onClose}>
          {t("skipSetup")}
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {index > 0 && (
            <Button variant="outline" disabled={applying} onClick={() => setStep(steps[index - 1])}>
              {t("back")}
            </Button>
          )}
          {step !== "goal" && (
            <Button variant="outline" disabled={applying} onClick={() => next(true)}>
              {t("skipStep")}
            </Button>
          )}
          <Button disabled={applying} onClick={() => next(false)}>
            {last ? t("finish") : t("continue")}
          </Button>
        </div>
      </DialogFooter>

      <TwitchCodeDialog prompt={twitchPrompt} onClose={() => setTwitchPrompt(null)} />
      <ImportDialog open={importing} onOpenChange={setImporting} onImported={() => setLayout("none")} />
      {applying && <span className="sr-only" role="status">{tc("loading")}</span>}
    </DialogContent>
  );
}

function ChoiceGroup({ label, columns = 3, children }: { label: string; columns?: 2 | 3; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {children}
    </div>
  );
}

function Choice({ selected, disabled = false, onSelect, icon, label }: { selected: boolean; disabled?: boolean; onSelect: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border px-3 py-3 text-center text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        selected && "border-primary bg-accent font-medium",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
