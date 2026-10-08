import { useState } from "react";
import { useTranslations } from "use-intl";
import { RECORDING_BITRATE_RANGE, REPLAY_SECONDS_RANGE, type StudioPreferences } from "../../shared/types";
import { Field, Input, Label, Switch } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";

const RECORDING_QUALITIES = [
  { id: "low", kbps: 6000 },
  { id: "medium", kbps: 12000 },
  { id: "high", kbps: 25000 },
  { id: "ultra", kbps: 50000 },
] as const;
const REPLAY_PRESETS = [15, 30, 60, 120] as const;

type QualityChoice = (typeof RECORDING_QUALITIES)[number]["id"] | "stream" | "custom";

/** Whole number within a range, or null. */
function wholeInRange(value: string, range: { min: number; max: number }): number | null {
  const n = Math.round(Number(value));
  return value.trim() !== "" && Number.isFinite(n) && n >= range.min && n <= range.max ? n : null;
}

/** Recording quality: presets, the stream's quality, or a custom bitrate. */
export function RecordingQualityField({ disabled }: { disabled: boolean }) {
  const t = useTranslations("settings");
  const run = useAction();
  const prefs = useStudio((state) => state.snapshot?.preferences);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  if (!prefs) return null;

  const preset = RECORDING_QUALITIES.find((quality) => quality.kbps === prefs.recordingBitrateKbps);
  const choice: QualityChoice = prefs.recordingMatchStream ? "stream" : customOpen || !preset ? "custom" : preset.id;
  const save = (patch: Partial<StudioPreferences>) => void run(() => studio.setPreferences(patch));
  const value = draft ?? String(prefs.recordingBitrateKbps);
  const valid = wholeInRange(value, RECORDING_BITRATE_RANGE);
  const commit = () => {
    if (valid !== null && valid !== prefs.recordingBitrateKbps) save({ recordingBitrateKbps: valid, recordingMatchStream: false });
    setDraft(null);
  };

  return (
    <div className="grid gap-2">
      <Field label={t("recordingQuality")} htmlFor="settings-quality">
        <Select
          disabled={disabled}
          value={choice}
          onValueChange={(value) => {
            const next = value as QualityChoice;
            setCustomOpen(next === "custom");
            setDraft(null);
            if (next === "custom") {
              if (prefs.recordingMatchStream) save({ recordingMatchStream: false });
            } else if (next === "stream") {
              save({ recordingMatchStream: true });
            } else {
              const quality = RECORDING_QUALITIES.find((entry) => entry.id === next);
              if (quality) save({ recordingBitrateKbps: quality.kbps, recordingMatchStream: false });
            }
          }}
        >
          <SelectTrigger id="settings-quality">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECORDING_QUALITIES.map(({ id, kbps }) => (
              <SelectItem key={id} value={id}>
                {t(`recordingQualities.${id}`, { kbps })}
              </SelectItem>
            ))}
            <SelectItem value="stream">{t("recordingSameAsStream")}</SelectItem>
            <SelectItem value="custom">{choice === "custom" && !customOpen ? t("recordingBitrate", { kbps: prefs.recordingBitrateKbps }) : t("custom")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {choice === "custom" && (
        <Field label={t("recordingCustomBitrate")} htmlFor="settings-quality-kbps">
          <Input
            id="settings-quality-kbps"
            type="number"
            inputMode="numeric"
            min={RECORDING_BITRATE_RANGE.min}
            max={RECORDING_BITRATE_RANGE.max}
            step={500}
            disabled={disabled}
            aria-invalid={valid === null}
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
          />
        </Field>
      )}
      {choice === "custom" && valid === null && (
        <p className="text-xs text-destructive">{t("recordingBitrateRange", RECORDING_BITRATE_RANGE)}</p>
      )}
    </div>
  );
}

/** Auto-record with streams, and instant replay. */
export function RecordingAutomationCard() {
  const t = useTranslations("settings");
  const run = useAction();
  const prefs = useStudio((state) => state.snapshot?.preferences);
  const [secondsDraft, setSecondsDraft] = useState<string | null>(null);
  if (!prefs) return null;
  const save = (patch: Partial<StudioPreferences>) => void run(() => studio.setPreferences(patch));
  const seconds = secondsDraft ?? String(prefs.replayBufferSeconds);
  const validSeconds = wholeInRange(seconds, REPLAY_SECONDS_RANGE);
  const commitSeconds = () => {
    if (validSeconds !== null && validSeconds !== prefs.replayBufferSeconds) save({ replayBufferSeconds: validSeconds });
    setSecondsDraft(null);
  };

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-6">
      <h3 className="text-xl font-bold text-neutral-900 dark:text-white">{t("recordingAutomation")}</h3>
      <SwitchRow id="settings-auto-record" label={t("autoRecord")} checked={prefs.autoRecord} onChange={(value) => save({ autoRecord: value })} />
      {prefs.autoRecord && (
        <SwitchRow
          id="settings-keep-recording"
          label={t("keepRecordingAfterStream")}
          checked={prefs.keepRecordingAfterStream}
          onChange={(value) => save({ keepRecordingAfterStream: value })}
        />
      )}
      <SwitchRow
        id="settings-replay"
        label={t("replayBuffer")}
        hint={t("replayBufferHint")}
        checked={prefs.replayBufferEnabled}
        onChange={(value) => save({ replayBufferEnabled: value })}
      />
      {prefs.replayBufferEnabled && (
        <div className="grid gap-2">
          <Label htmlFor="settings-replay-seconds">{t("replayLength")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label={t("replayLength")}>
              {REPLAY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={prefs.replayBufferSeconds === preset}
                            onClick={() => save({ replayBufferSeconds: preset })}
                  className="rounded-md border px-3 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:font-medium"
                >
                  {t("replaySeconds", { seconds: preset })}
                </button>
              ))}
            </div>
            <Input
              id="settings-replay-seconds"
              type="number"
              inputMode="numeric"
              className="w-24"
              min={REPLAY_SECONDS_RANGE.min}
              max={REPLAY_SECONDS_RANGE.max}
                    aria-invalid={validSeconds === null}
              value={seconds}
              onChange={(event) => setSecondsDraft(event.target.value)}
              onBlur={commitSeconds}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitSeconds();
              }}
            />
          </div>
          {validSeconds === null && <p className="text-xs text-destructive">{t("replayLengthRange", REPLAY_SECONDS_RANGE)}</p>}
        </div>
      )}
    </section>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="grid min-w-0 flex-1 gap-1">
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
