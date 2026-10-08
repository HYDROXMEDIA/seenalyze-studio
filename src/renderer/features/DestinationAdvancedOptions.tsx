import { ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { supportsEncoderPreset } from "../../shared/encoder-presets";
import { AUDIO_BITRATES, PLATFORM_SPECS } from "../../shared/platforms";
import { ENCODER_PRESETS, type DestinationProfile, type Platform } from "../../shared/types";
import { Field } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";

/** Audio bitrate, keyframe interval and encoder speed, hidden until asked for. */
export function DestinationAdvancedOptions({
  platform,
  profile,
  onChange,
}: {
  platform: Platform;
  profile: DestinationProfile;
  onChange: (profile: DestinationProfile) => void;
}) {
  const t = useTranslations("destinations.advanced");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const spec = PLATFORM_SPECS[platform];
  const encoder = useStudio((state) => state.snapshot?.selectedEncoder ?? "");
  const presetSupported = supportsEncoderPreset(encoder);
  const audioOptions = AUDIO_BITRATES.filter((kbps) => kbps <= spec.maxAudioBitrateKbps);
  const preset = profile.encoderPreset ?? "balanced";

  return (
    <div className="grid gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="flex w-fit items-center gap-1 rounded-md text-sm font-medium outline-none hover:text-foreground/80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronRightIcon aria-hidden className={cn("size-4 transition-transform", open && "rotate-90")} />
        {t("title")}
      </button>
      {open && (
        <div id={panelId} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("audioBitrate")} htmlFor="destination-audio">
              <Select value={String(profile.audioBitrateKbps)} onValueChange={(value) => onChange({ ...profile, audioBitrateKbps: Number(value) })}>
                <SelectTrigger id="destination-audio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {audioOptions.map((kbps) => (
                    <SelectItem key={kbps} value={String(kbps)}>
                      {t("kbps", { value: kbps })}
                      {kbps === spec.defaultProfile.audioBitrateKbps ? ` · ${t("recommended")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("keyframe")} htmlFor="destination-keyframe">
              <Select
                value={String(profile.keyframeSec)}
                disabled={spec.keyframeOptions.length < 2}
                onValueChange={(value) => onChange({ ...profile, keyframeSec: Number(value) })}
              >
                <SelectTrigger id="destination-keyframe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {spec.keyframeOptions.map((seconds) => (
                    <SelectItem key={seconds} value={String(seconds)}>
                      {t("seconds", { value: seconds })}
                      {seconds === spec.keyframeSec ? ` · ${t("recommended")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{t("audioShared")}</p>

          <div className="grid gap-2">
            <span className="text-sm font-medium" id={`${panelId}-preset`}>
              {t("preset")}
            </span>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby={`${panelId}-preset`}>
              {ENCODER_PRESETS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={preset === option}
                  disabled={!presetSupported}
                  onClick={() => onChange({ ...profile, encoderPreset: option })}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
                    preset === option && "border-primary bg-accent",
                  )}
                >
                  {t(`presets.${option}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{presetSupported ? t("presetHint") : t("presetUnavailable")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
