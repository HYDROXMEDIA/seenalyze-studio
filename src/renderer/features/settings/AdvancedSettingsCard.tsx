import { useState } from "react";
import { useTranslations } from "use-intl";
import { ADVANCED_STREAM_RANGES, DEFAULT_ADVANCED_STREAM, type AdvancedStreamSettings } from "../../../shared/types";
import { Field, Input } from "@/components/ui/form";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";
import { isActive } from "../DestinationsDock";
import { SettingsCard, ToggleRow } from "./parts";

type NumberKey = keyof AdvancedStreamSettings;

/** Settings › Advanced: stream delay and reconnect behaviour. */
export function AdvancedSettingsCard() {
  const t = useTranslations("settings.advancedOptions");
  const tRoot = useTranslations("settings");
  const run = useAction();
  const advanced = useStudio((state) => state.snapshot?.advanced ?? DEFAULT_ADVANCED_STREAM);
  const locked = useStudio((state) => state.snapshot?.destinationStatus.some((status) => isActive(status)) ?? false);
  const save = (patch: Partial<AdvancedStreamSettings>) => void run(() => studio.setAdvancedSettings(patch));
  const delayOn = advanced.streamDelaySec > 0;

  return (
    <SettingsCard title={tRoot("advanced")}>
      {locked && <p className="text-sm text-muted-foreground">{tRoot("streamingLockedWhileLive")}</p>}
      <ToggleRow
        id="settings-stream-delay"
        label={t("streamDelay")}
        hint={t("streamDelayHint")}
        checked={delayOn}
        disabled={locked}
        onChange={(value) => save({ streamDelaySec: value ? 20 : 0 })}
      />
      {delayOn && (
        <NumberField
          id="settings-stream-delay-seconds"
          label={t("delaySeconds")}
          name="streamDelaySec"
          min={1}
          value={advanced.streamDelaySec}
          disabled={locked}
          onCommit={save}
        />
      )}
      <div className="grid grid-cols-2 gap-4">
        <NumberField
          id="settings-reconnect-delay"
          label={t("reconnectDelay")}
          name="reconnectDelaySec"
          value={advanced.reconnectDelaySec}
          disabled={locked}
          onCommit={save}
        />
        <NumberField
          id="settings-reconnect-retries"
          label={t("reconnectRetries")}
          name="reconnectMaxRetries"
          value={advanced.reconnectMaxRetries}
          disabled={locked}
          onCommit={save}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("reconnectHint")}</p>
    </SettingsCard>
  );
}

/** Whole-number input that saves when it loses focus or on Enter, within its allowed range. */
function NumberField({
  id,
  label,
  name,
  value,
  min,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  name: NumberKey;
  value: number;
  min?: number;
  disabled: boolean;
  onCommit: (patch: Partial<AdvancedStreamSettings>) => void;
}) {
  const range = ADVANCED_STREAM_RANGES[name];
  const lowest = Math.max(range.min, min ?? range.min);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Math.round(Number(draft));
    setDraft(null);
    if (!Number.isFinite(parsed) || draft.trim() === "") return;
    const next = Math.min(Math.max(parsed, lowest), range.max);
    if (next !== value) onCommit({ [name]: next });
  };
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={lowest}
        max={range.max}
        step={1}
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(null);
        }}
      />
    </Field>
  );
}
