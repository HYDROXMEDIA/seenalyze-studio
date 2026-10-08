import { useState } from "react";
import { useTranslations } from "use-intl";
import {
  colorFormatsFor,
  COLOR_RANGES,
  COLOR_SPACES,
  DEFAULT_AUDIO_FORMAT,
  DEFAULT_COLOR,
  formatFrameRate,
  FRAME_RATE_PRESETS,
  frameRateOf,
  SAMPLE_RATES,
  SPEAKER_LAYOUTS,
  validFrameRate,
  type AudioFormat,
  type ColorFormat,
  type ColorRange,
  type ColorSpace,
  type SampleRate,
  type SpeakerLayout,
} from "../../../shared/formats";
import type { VideoSettings } from "../../../shared/types";
import { Field, Input } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";
import { AdvancedDisclosure, TrackToggles } from "./advanced-parts";
import { SettingsCard } from "./parts";

const CUSTOM = "custom";
const WHOLE = "whole";

function rateKey(num: number, den: number): string {
  return `${num}/${den}`;
}

/**
 * Settings › Video › Advanced: exact (fractional or custom) frame rate and
 * color format, space and range. Edits the page's unsaved video draft.
 */
export function VideoFormatFields({ video, encoder, disabled, onChange }: { video: VideoSettings; encoder: string; disabled: boolean; onChange: (video: VideoSettings) => void }) {
  const t = useTranslations("workspace");
  const rate = frameRateOf(video);
  const fractional = video.fpsNum !== undefined && video.fpsDen !== undefined;
  const preset = FRAME_RATE_PRESETS.find((entry) => entry.num === rate.num && entry.den === rate.den && entry.den !== 1);
  const [custom, setCustom] = useState(fractional && !preset);
  const [draft, setDraft] = useState({ num: String(rate.num), den: String(rate.den) });
  const modified = fractional || video.colorFormat !== undefined || video.colorSpace !== undefined || video.colorRange !== undefined;
  const formats = colorFormatsFor(encoder);

  const setRate = (num: number, den: number) => {
    const valid = validFrameRate(num, den);
    if (!valid) return;
    if (valid.den === 1) onChange({ ...video, fps: valid.num, fpsNum: undefined, fpsDen: undefined });
    else onChange({ ...video, fps: Math.max(1, Math.round(valid.num / valid.den)), fpsNum: valid.num, fpsDen: valid.den });
  };
  const commitDraft = (next: { num: string; den: string }) => {
    setDraft(next);
    setRate(Math.round(Number(next.num)), Math.round(Number(next.den)));
  };
  const selected = custom ? CUSTOM : fractional && preset ? rateKey(preset.num, preset.den) : WHOLE;

  return (
    <AdvancedDisclosure initiallyOpen={modified}>
      <Field label={t("frameRate")} htmlFor="settings-exact-fps">
        <Select
          disabled={disabled}
          value={selected}
          onValueChange={(value) => {
            if (value === CUSTOM) {
              setCustom(true);
              setDraft({ num: String(rate.num), den: String(rate.den) });
              return;
            }
            setCustom(false);
            if (value === WHOLE) onChange({ ...video, fpsNum: undefined, fpsDen: undefined });
            else {
              const [num, den] = value.split("/").map(Number);
              setRate(num, den);
            }
          }}
        >
          <SelectTrigger id="settings-exact-fps">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WHOLE}>{t("frameRateWhole", { fps: video.fps })}</SelectItem>
            {FRAME_RATE_PRESETS.filter((entry) => entry.den !== 1).map((entry) => (
              <SelectItem key={rateKey(entry.num, entry.den)} value={rateKey(entry.num, entry.den)}>
                {formatFrameRate(entry)}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM}>{t("frameRateCustom")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {custom && (
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("numerator")} htmlFor="settings-fps-num">
            <Input id="settings-fps-num" type="number" inputMode="numeric" min={1} step={1} disabled={disabled} value={draft.num} onChange={(event) => commitDraft({ ...draft, num: event.target.value })} />
          </Field>
          <Field label={t("denominator")} htmlFor="settings-fps-den">
            <Input id="settings-fps-den" type="number" inputMode="numeric" min={1} step={1} disabled={disabled} value={draft.den} onChange={(event) => commitDraft({ ...draft, den: event.target.value })} />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        <Field label={t("colorFormat")} htmlFor="settings-color-format">
          <Select
            disabled={disabled}
            value={video.colorFormat ?? DEFAULT_COLOR.colorFormat}
            onValueChange={(value) => onChange({ ...video, colorFormat: value === DEFAULT_COLOR.colorFormat ? undefined : (value as ColorFormat) })}
          >
            <SelectTrigger id="settings-color-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...formats, video.colorFormat ?? DEFAULT_COLOR.colorFormat])].map((format) => (
                <SelectItem key={format} value={format}>
                  {t(`colorFormats.${format}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("colorSpace")} htmlFor="settings-color-space">
          <Select
            disabled={disabled}
            value={video.colorSpace ?? DEFAULT_COLOR.colorSpace}
            onValueChange={(value) => onChange({ ...video, colorSpace: value === DEFAULT_COLOR.colorSpace ? undefined : (value as ColorSpace) })}
          >
            <SelectTrigger id="settings-color-space">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLOR_SPACES.map((space) => (
                <SelectItem key={space} value={space}>
                  {t(`colorSpaces.${space}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("colorRange")} htmlFor="settings-color-range">
          <Select
            disabled={disabled}
            value={video.colorRange ?? DEFAULT_COLOR.colorRange}
            onValueChange={(value) => onChange({ ...video, colorRange: value === DEFAULT_COLOR.colorRange ? undefined : (value as ColorRange) })}
          >
            <SelectTrigger id="settings-color-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLOR_RANGES.map((range) => (
                <SelectItem key={range} value={range}>
                  {t(`colorRanges.${range}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </AdvancedDisclosure>
  );
}

/** Settings › Video: audio sample rate and channels (applied by restarting the engine). */
export function AudioFormatCard({ disabled }: { disabled: boolean }) {
  const t = useTranslations("workspace");
  const run = useAction();
  const current = useStudio((state) => state.snapshot?.workspace.audioFormat ?? DEFAULT_AUDIO_FORMAT);
  const switching = useStudio((state) => state.snapshot?.workspace.switching ?? false);
  const modified = current.sampleRate !== DEFAULT_AUDIO_FORMAT.sampleRate || current.speakers !== DEFAULT_AUDIO_FORMAT.speakers;
  const apply = (patch: Partial<AudioFormat>) => void run(() => studio.setOutputFormats({ audio: { ...current, ...patch } }));
  const locked = disabled || switching;

  return (
    <SettingsCard title={t("audio")}>
      <AdvancedDisclosure initiallyOpen={modified}>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("sampleRate")} htmlFor="settings-sample-rate">
            <Select disabled={locked} value={String(current.sampleRate)} onValueChange={(value) => apply({ sampleRate: Number(value) as SampleRate })}>
              <SelectTrigger id="settings-sample-rate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SAMPLE_RATES.map((rate) => (
                  <SelectItem key={rate} value={String(rate)}>
                    {t("sampleRateValue", { rate: rate / 1000 })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("speakers")} htmlFor="settings-speakers">
            <Select disabled={locked} value={current.speakers} onValueChange={(value) => apply({ speakers: value as SpeakerLayout })}>
              <SelectTrigger id="settings-speakers">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEAKER_LAYOUTS.map((layout) => (
                  <SelectItem key={layout} value={layout}>
                    {t(`speakerLayouts.${layout.replace(".", "_")}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{t("audioRestartHint")}</p>
      </AdvancedDisclosure>
    </SettingsCard>
  );
}

/** Settings › Recording › Advanced: which of the six audio tracks recordings keep. */
export function RecordingTracksField({ disabled }: { disabled: boolean }) {
  const t = useTranslations("workspace");
  const run = useAction();
  const tracks = useStudio((state) => state.snapshot?.workspace.recordingTracks ?? 1);
  return (
    <AdvancedDisclosure initiallyOpen={tracks !== 1}>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{t("recordingTracks")}</span>
        <TrackToggles label={t("recordingTracks")} value={tracks} disabled={disabled} onChange={(value) => void run(() => studio.setOutputFormats({ recordingTracks: value }))} />
        <p className="text-xs text-muted-foreground">{t("trackStream")}</p>
      </div>
    </AdvancedDisclosure>
  );
}
