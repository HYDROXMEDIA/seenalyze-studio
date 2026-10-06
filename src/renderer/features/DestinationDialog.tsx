import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { PLATFORM_SPECS } from "../../shared/platforms";
import type { ConnectionMode, DestinationConfig, DestinationProfile, DeviceCodePrompt, Platform } from "../../shared/types";
import { PlatformIcon } from "@/components/PlatformIcon";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
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
import { TwitchCodeDialog } from "./TwitchCodeDialog";

export type DestinationDialogState =
  | { mode: "create"; platform: Platform }
  | { mode: "edit"; platform: Platform; destination: DestinationConfig };

const RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 854, height: 480 },
];

export function DestinationDialog({ state, onClose }: { state: DestinationDialogState | null; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      {state && <DestinationForm key={state.mode === "edit" ? state.destination.id : state.platform} state={state} onClose={onClose} />}
    </Dialog>
  );
}

function DestinationForm({ state, onClose }: { state: DestinationDialogState; onClose: () => void }) {
  const t = useTranslations("destinations");
  const tc = useTranslations("common");
  const run = useAction();
  const { platform } = state;
  const spec = PLATFORM_SPECS[platform];
  const existing = state.mode === "edit" ? state.destination : undefined;
  const snapshot = useStudio((store) => store.snapshot);
  const accounts = snapshot?.accounts.filter((account) => account.platform === platform) ?? [];
  const configured = useStudio((store) => store.snapshot?.platformsConfigured[platform] ?? false);

  const [name, setName] = useState(existing?.name ?? t(`platforms.${platform}`));
  const [mode, setMode] = useState<ConnectionMode>(existing?.mode ?? (accounts.length > 0 || configured ? "account" : "manual"));
  const [accountId, setAccountId] = useState(existing?.accountId ?? accounts[0]?.id ?? "");
  const [server, setServer] = useState(existing?.server ?? spec.defaultServer);
  const [streamKey, setStreamKey] = useState("");
  const [profile, setProfile] = useState<DestinationProfile>(existing?.profile ?? spec.defaultProfile);
  const [pending, setPending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [twitchPrompt, setTwitchPrompt] = useState<DeviceCodePrompt | null>(null);

  // A freshly connected account is used automatically until the user picks one.
  const selectedAccountId = accounts.some((account) => account.id === accountId) ? accountId : (accounts[0]?.id ?? "");

  const accountSelected = mode === "account" && selectedAccountId !== "";
  const needsKey = mode === "manual" && !existing?.hasStreamKey;
  const canSave = !pending && name.trim().length > 0 && (accountSelected || (mode === "manual" && (!needsKey || streamKey.trim().length > 0)));

  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      if (platform === "twitch") {
        const prompt = await run(() => studio.connectTwitch());
        if (prompt) setTwitchPrompt(prompt);
        return;
      }
      toast.info(t("browserSignIn"));
      await run(() => studio.connectYouTube());
    } finally {
      setConnecting(false);
    }
  };

  const save = async () => {
    setPending(true);
    const id = await run(() =>
      studio.saveDestination({
        id: existing?.id,
        platform,
        name,
        enabled: existing?.enabled ?? true,
        mode: accountSelected ? "account" : "manual",
        server,
        streamKey: mode === "manual" && streamKey.trim() ? streamKey.trim() : undefined,
        accountId: accountSelected ? selectedAccountId : undefined,
        profile,
      }),
    );
    setPending(false);
    if (id) onClose();
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <PlatformIcon platform={platform} />
          {existing ? t("editTitle") : t("addTitle", { platform: t(`platforms.${platform}`) })}
        </DialogTitle>
      </DialogHeader>

      <div className="grid gap-4">
        <Field label={tc("name")} htmlFor="destination-name">
          <Input id="destination-name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        </Field>

        <div className="grid gap-2">
          <span className="text-sm font-medium">{t("connection")}</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("connection")}>
            {(["account", "manual"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                onClick={() => setMode(option)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  mode === option && "border-primary bg-accent",
                )}
              >
                {t(`modes.${option}`)}
              </button>
            ))}
          </div>
        </div>

        {mode === "account" ? (
          accounts.length > 0 ? (
            <Field label={t("account")} htmlFor="destination-account">
              <Select value={selectedAccountId} onValueChange={setAccountId}>
                <SelectTrigger id="destination-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : configured ? (
            <Button variant="outline" disabled={connecting} onClick={() => void connect()}>
              <PlatformIcon platform={platform} className="size-4" />
              {t("connectAccount", { platform: t(`platforms.${platform}`) })}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t("accountUnavailable")}</p>
          )
        ) : (
          <>
            <Field label={t("server")} htmlFor="destination-server">
              <Input id="destination-server" value={server} spellCheck={false} onChange={(event) => setServer(event.target.value)} />
            </Field>
            <Field label={t("streamKey")} htmlFor="destination-key">
              <Input
                id="destination-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={streamKey}
                placeholder={existing?.hasStreamKey ? t("streamKeySaved") : ""}
                onChange={(event) => setStreamKey(event.target.value)}
              />
            </Field>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("resolution")} htmlFor="destination-resolution">
            <Select
              value={`${profile.width}x${profile.height}`}
              onValueChange={(value) => {
                const [width, height] = value.split("x").map(Number);
                setProfile({ ...profile, width, height });
              }}
            >
              <SelectTrigger id="destination-resolution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTIONS.map(({ width, height }) => (
                  <SelectItem key={`${width}x${height}`} value={`${width}x${height}`}>
                    {t("resolutionOption", { height })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("bitrate")} htmlFor="destination-bitrate">
            <Input
              id="destination-bitrate"
              type="number"
              min={500}
              max={spec.maxVideoBitrateKbps}
              step={100}
              value={profile.videoBitrateKbps}
              onChange={(event) => {
                const value = parseInt(event.target.value, 10);
                if (Number.isFinite(value)) setProfile({ ...profile, videoBitrateKbps: value });
              }}
            />
          </Field>
        </div>
        {profile.videoBitrateKbps > spec.maxVideoBitrateKbps && (
          <p className="text-sm text-yellow-600 dark:text-yellow-400">{t("bitrateCapped", { max: spec.maxVideoBitrateKbps })}</p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button disabled={!canSave} onClick={() => void save()}>
          {tc("save")}
        </Button>
      </DialogFooter>

      <TwitchCodeDialog prompt={twitchPrompt} onClose={() => setTwitchPrompt(null)} />
    </DialogContent>
  );
}
