import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import {
  AUDIO_FILTER_SPECS,
  MONITORING_MODES,
  NO_SIDECHAIN,
  SYNC_OFFSET_RANGE_MS,
  type AudioChange,
  type AudioFilterParam,
  type AudioFilterState,
  type AudioFilterValue,
  type AudioSourceDetails,
  type MonitoringDevices,
  type MonitoringMode,
} from "../../shared/audio";
import { Button } from "@/components/ui/button";
import { Input, Label, Slider, Switch } from "@/components/ui/form";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { ALL_TRACKS } from "../../shared/formats";
import { TrackToggles } from "./settings/advanced-parts";

/** Audio cleanup, monitoring and filters of one audio source. Changes apply live. */
export function AudioSettingsDialog({ source, microphone, onClose }: { source: string | null; microphone: boolean; onClose: () => void }) {
  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      {source !== null && <AudioSettingsForm key={source} source={source} microphone={microphone} onClose={onClose} />}
    </Dialog>
  );
}

function AudioSettingsForm({ source, microphone, onClose }: { source: string; microphone: boolean; onClose: () => void }) {
  const t = useTranslations("mixer");
  const tw = useTranslations("workspace");
  const tc = useTranslations("common");
  const run = useAction();
  const [details, setDetails] = useState<AudioSourceDetails | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [monitorDevices, setMonitorDevices] = useState<MonitoringDevices | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void run(() => studio.getAudioDetails(source)).then((result) => {
      if (cancelled) return;
      setLoadFailed(result === undefined);
      setDetails(result ?? null);
    });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [source, run]);

  const monitoring = details?.monitoring ?? "off";
  useEffect(() => {
    if (monitoring === "off" || monitorDevices) return;
    let cancelled = false;
    void run(() => studio.getMonitoringDevices()).then((result) => {
      if (!cancelled && result) setMonitorDevices(result);
    });
    return () => {
      cancelled = true;
    };
  }, [monitoring, monitorDevices, run]);

  /** Changes run one after another; the engine's answer replaces the shown state. */
  const apply = (change: AudioChange) => {
    const next = queue.current.then(async () => {
      const result = await run(() => studio.changeAudio(source, change));
      if (!mounted.current) return;
      if (result) setDetails(result);
      else {
        // Show the real state again after a failed change.
        const fresh = await run(() => studio.getAudioDetails(source));
        if (fresh && mounted.current) setDetails(fresh);
      }
    });
    queue.current = next;
  };

  /** Local edit while dragging; sent to the engine on commit. */
  const editFilterLocally = (id: string, settings: Record<string, AudioFilterValue>) =>
    setDetails((current) => current && { ...current, filters: current.filters.map((filter) => (filter.id === id ? { ...filter, settings: { ...filter.settings, ...settings } } : filter)) });

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("audioSettings", { name: source })}</DialogTitle>
      </DialogHeader>
      <div className="-mx-6 max-h-[65vh] overflow-y-auto px-6">
        {loadFailed ? (
          <p role="alert" className="py-6 text-center text-sm text-destructive">{t("loadFailed")}</p>
        ) : !details ? (
          <div className="flex h-24 items-center justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-label={tc("loading")} />
          </div>
        ) : (
          <div className="grid gap-5 py-1">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-1">
                <Label htmlFor="audio-cleanup">{microphone ? t("cleanupMic") : t("cleanupAudio")}</Label>
                <p className="text-sm text-muted-foreground">{t("cleanupHint")}</p>
              </div>
              <Switch
                id="audio-cleanup"
                checked={details.cleanup}
                onCheckedChange={(checked) => {
                  setDetails({ ...details, cleanup: checked });
                  apply({ type: "cleanup", enabled: checked });
                }}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="audio-monitoring">{t("monitoring")}</Label>
                <Select
                  value={details.monitoring}
                  onValueChange={(value) => {
                    const mode = value as MonitoringMode;
                    setDetails({ ...details, monitoring: mode });
                    apply({ type: "properties", monitoring: mode });
                  }}
                >
                  <SelectTrigger id="audio-monitoring">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONITORING_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>{t(`monitoringModes.${mode}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {details.monitoring !== "off" && (
                <div className="grid gap-2">
                  <Label htmlFor="audio-headphones">{t("headphones")}</Label>
                  <Select
                    disabled={!monitorDevices}
                    value={monitorDevices?.current}
                    onValueChange={(id) => {
                      setMonitorDevices((current) => current && { ...current, current: id });
                      void run(() => studio.setMonitoringDevice(id));
                    }}
                  >
                    <SelectTrigger id="audio-headphones">
                      <SelectValue placeholder={t("systemDefault")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(monitorDevices?.devices ?? []).map((device) => (
                        <SelectItem key={device.id} value={device.id}>{device.id === "default" ? t("systemDefault") : device.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="grid gap-4">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 justify-self-start"
                aria-expanded={advanced}
                aria-controls="audio-advanced"
                onClick={() => setAdvanced((open) => !open)}
              >
                <ChevronDownIcon className={cn("transition-transform motion-reduce:transition-none", !advanced && "-rotate-90")} />
                {t("advanced")}
              </Button>
              {advanced && (
                <div id="audio-advanced" className="grid gap-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SyncOffsetField value={details.syncOffsetMs} onCommit={(syncOffsetMs) => {
                      setDetails({ ...details, syncOffsetMs });
                      apply({ type: "properties", syncOffsetMs });
                    }} />
                    <div className="flex items-center justify-between gap-4 self-end pb-2">
                      <Label htmlFor="audio-mono">{t("mono")}</Label>
                      <Switch id="audio-mono" checked={details.mono} onCheckedChange={(mono) => {
                        setDetails({ ...details, mono });
                        apply({ type: "properties", mono });
                      }} />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">{tw("sourceTracks")}</span>
                    <TrackToggles label={tw("sourceTracks")} value={details.tracks ?? ALL_TRACKS} allowNone onChange={(tracks) => {
                      setDetails({ ...details, tracks });
                      apply({ type: "properties", tracks });
                    }} />
                  </div>
                  <FilterList details={details} apply={apply} editLocally={editFilterLocally} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onClose}>{tc("done")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function SyncOffsetField({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const t = useTranslations("mixer");
  // null shows the saved value; a string is an edit in progress.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const next = Math.round(Number(draft));
    if (draft.trim() === "" || !Number.isFinite(next)) return;
    const clamped = Math.min(SYNC_OFFSET_RANGE_MS.max, Math.max(SYNC_OFFSET_RANGE_MS.min, next));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <div className="grid gap-2">
      <Label htmlFor="audio-sync">{t("syncOffset")}</Label>
      <Input
        id="audio-sync"
        type="number"
        step={10}
        min={SYNC_OFFSET_RANGE_MS.min}
        max={SYNC_OFFSET_RANGE_MS.max}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
      />
    </div>
  );
}

function FilterList({
  details,
  apply,
  editLocally,
}: {
  details: AudioSourceDetails;
  apply: (change: AudioChange) => void;
  editLocally: (id: string, settings: Record<string, AudioFilterValue>) => void;
}) {
  const t = useTranslations("mixer");
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("filters")}</h3>
        <Select value="" onValueChange={(kind) => apply({ type: "addFilter", kind: kind as AudioFilterState["kind"] })} disabled={details.availableFilters.length === 0}>
          <SelectTrigger className="h-8 w-auto gap-1.5" aria-label={t("addFilter")}>
            <PlusIcon className="size-4" />
            <span>{t("addFilter")}</span>
          </SelectTrigger>
          <SelectContent align="end" className="w-56">
            {details.availableFilters.map((kind) => (
              <SelectItem key={kind} value={kind}>{t(`filterKinds.${kind}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {details.filters.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noFilters")}</p>
      ) : (
        <ol className="grid gap-3">
          {details.filters.map((filter, index) => (
            <FilterCard
              key={filter.id}
              filter={filter}
              first={index === 0}
              last={index === details.filters.length - 1}
              sidechainSources={details.sidechainSources}
              apply={apply}
              editLocally={editLocally}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function FilterCard({
  filter,
  first,
  last,
  sidechainSources,
  apply,
  editLocally,
}: {
  filter: AudioFilterState;
  first: boolean;
  last: boolean;
  sidechainSources: string[];
  apply: (change: AudioChange) => void;
  editLocally: (id: string, settings: Record<string, AudioFilterValue>) => void;
}) {
  const t = useTranslations("mixer");
  const name = t(`filterKinds.${filter.kind}`);
  const params = AUDIO_FILTER_SPECS[filter.kind].params.filter((param) => param.key !== "suppress_level" || filter.settings.method === "speex");
  return (
    <li className="grid gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Switch
          checked={filter.enabled}
          aria-label={t("enableFilter", { name })}
          onCheckedChange={(enabled) => apply({ type: "updateFilter", id: filter.id, enabled })}
        />
        <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", !filter.enabled && "text-muted-foreground")}>{name}</span>
        <Button variant="ghost" size="icon-sm" disabled={first} aria-label={t("moveUp", { name })} onClick={() => apply({ type: "moveFilter", id: filter.id, direction: "up" })}><ArrowUpIcon /></Button>
        <Button variant="ghost" size="icon-sm" disabled={last} aria-label={t("moveDown", { name })} onClick={() => apply({ type: "moveFilter", id: filter.id, direction: "down" })}><ArrowDownIcon /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={t("removeFilter", { name })} onClick={() => apply({ type: "removeFilter", id: filter.id })}><Trash2Icon /></Button>
      </div>
      {params.length > 0 && (
        <div className="grid gap-3">
          {params.map((param) => (
            <FilterParam
              key={param.key}
              id={`${filter.id}-${param.key}`}
              param={param}
              value={filter.settings[param.key]}
              disabled={!filter.enabled}
              sidechainSources={sidechainSources}
              onEdit={(value) => editLocally(filter.id, { [param.key]: value })}
              onCommit={(value) => apply({ type: "updateFilter", id: filter.id, settings: { [param.key]: value } })}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function FilterParam({
  id,
  param,
  value,
  disabled,
  sidechainSources,
  onEdit,
  onCommit,
}: {
  id: string;
  param: AudioFilterParam;
  value: AudioFilterValue | undefined;
  disabled: boolean;
  sidechainSources: string[];
  onEdit: (value: AudioFilterValue) => void;
  onCommit: (value: AudioFilterValue) => void;
}) {
  const t = useTranslations("mixer");
  const label = t(`params.${param.key}`);
  if (param.type === "choice" || param.type === "source") {
    const options = param.type === "choice" ? [...param.options] : [NO_SIDECHAIN, ...sidechainSources];
    const current = String(value ?? options[0]);
    const all = options.includes(current) ? options : [...options, current];
    return (
      <div className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3">
        <Label htmlFor={id}>{label}</Label>
        <Select disabled={disabled} value={current} onValueChange={(next) => onCommit(next)}>
          <SelectTrigger id={id} className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {all.map((option) => (
              <SelectItem key={option} value={option}>
                {param.type === "choice" ? t(`choices.${option}`) : option === NO_SIDECHAIN ? t("noSidechain") : option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  const number = typeof value === "number" && Number.isFinite(value) ? value : param.min;
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
      <Label htmlFor={id}>{label}</Label>
      <Slider
        disabled={disabled}
        min={param.min}
        max={param.max}
        step={param.step}
        value={[number]}
        aria-label={label}
        onValueChange={([next]) => onEdit(next)}
        onValueCommit={([next]) => onCommit(next)}
      />
      <div className="flex items-center gap-1.5">
        <NumberField id={id} value={number} min={param.min} max={param.max} step={param.step} disabled={disabled} onCommit={onCommit} />
        <span className="w-6 text-xs text-muted-foreground">{t(`units.${param.unit}`)}</span>
      </div>
    </div>
  );
}

function NumberField({ id, value, min, max, step, disabled, onCommit }: { id: string; value: number; min: number; max: number; step: number; disabled: boolean; onCommit: (value: number) => void }) {
  // null shows the current value; a string is an edit in progress.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const next = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(next)) return;
    const clamped = Math.min(max, Math.max(min, next));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <Input
      id={id}
      type="number"
      className="h-8 w-20"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && commit()}
    />
  );
}
