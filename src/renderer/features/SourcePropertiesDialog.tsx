import { FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { PropertyDTO } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Input, Label, Slider, Switch, Textarea } from "@/components/ui/form";
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
import { formatColor, packSourceColor, parseColor, toHex, unpackSourceColor } from "@/lib/color";
import { useAction } from "@/lib/use-action";

/** Edits a source's engine properties. Changes apply live, like OBS. */
export function SourcePropertiesDialog({ source, onClose }: { source: string | null; onClose: () => void }) {
  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      {source !== null && <PropertiesForm key={source} source={source} onClose={onClose} />}
    </Dialog>
  );
}

function PropertiesForm({ source, onClose }: { source: string; onClose: () => void }) {
  const t = useTranslations("properties");
  const tc = useTranslations("common");
  const run = useAction();
  const [properties, setProperties] = useState<PropertyDTO[] | null>(null);
  const pendingUpdate = useRef<Record<string, unknown>>({});
  const timer = useRef<number | null>(null);
  const updates = useRef<Promise<boolean>>(Promise.resolve(true));
  const mounted = useRef(true);
  const updateVersion = useRef(0);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void run(() => studio.getSourceProperties(source)).then((result) => {
      if (!cancelled) {
        setLoadFailed(result === undefined);
        setProperties(result ?? []);
      }
    });
    return () => {
      cancelled = true;
      mounted.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
      const settings = pendingUpdate.current;
      pendingUpdate.current = {};
      if (Object.keys(settings).length > 0) {
        void updates.current.then(() => run(() => studio.updateSourceSettings(source, settings)));
      }
    };
  }, [source, run]);

  const flush = async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const settings = pendingUpdate.current;
    pendingUpdate.current = {};
    if (Object.keys(settings).length === 0) return updates.current;
    const version = ++updateVersion.current;
    const update = updates.current.then(async () => {
      const next = await run(() => studio.updateSourceSettings(source, settings));
      if (!next) {
        if (version === updateVersion.current) pendingUpdate.current = { ...settings, ...pendingUpdate.current };
        return false;
      }
      if (mounted.current && version === updateVersion.current) setProperties(next.map((property) => Object.hasOwn(pendingUpdate.current, property.name) ? { ...property, value: pendingUpdate.current[property.name] } : property));
      return true;
    });
    updates.current = update;
    return update;
  };

  const change = (name: string, value: unknown, immediate = false) => {
    setProperties((current) => current?.map((property) => (property.name === name ? { ...property, value } : property)) ?? null);
    pendingUpdate.current[name] = value;
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (immediate) void flush();
    else timer.current = window.setTimeout(() => void flush(), 250);
  };

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("title", { name: source })}</DialogTitle>
      </DialogHeader>
      <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6">
        {properties === null ? (
          <div className="flex h-24 items-center justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-label={tc("loading")} />
          </div>
        ) : loadFailed ? (
          <p role="alert" className="py-6 text-center text-sm text-destructive">{t("loadFailed")}</p>
        ) : properties.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <div className="grid gap-4 py-1">
            {properties.map((property) => (
              <PropertyField
                key={property.name}
                property={property}
                onChange={change}
                onButton={async () => {
                  if (!await flush()) return;
                  const next = await run(() => studio.clickSourceButton(source, property.name));
                  if (next) setProperties(next);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={async () => {
          if (!await flush()) return;
          const next = await run(() => studio.getSourceProperties(source));
          if (next && mounted.current) { setLoadFailed(false); setProperties(next); }
        }}>
          <RefreshCwIcon />
          {t("refresh")}
        </Button>
        <Button
          onClick={async () => {
            if (!await flush()) return;
            onClose();
          }}
        >
          {tc("done")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function PropertyField({
  property,
  onChange,
  onButton,
}: {
  property: PropertyDTO;
  onChange: (name: string, value: unknown, immediate?: boolean) => void;
  onButton: () => void;
}) {
  const t = useTranslations("properties");
  const id = `prop-${property.name}`;
  const disabled = !property.enabled;

  switch (property.kind) {
    case "boolean":
      return (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={id}>{property.label}</Label>
          <Switch id={id} disabled={disabled} checked={Boolean(property.value)} onCheckedChange={(checked) => onChange(property.name, checked, true)} />
        </div>
      );
    case "int":
    case "float": {
      const value = Number(property.value ?? 0);
      const bounded = property.max !== undefined && property.max > (property.min ?? 0) && property.max - (property.min ?? 0) <= 10000;
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{property.label}</Label>
          <div className="flex items-center gap-3">
            {bounded && (
              <Slider
                disabled={disabled}
                min={property.min}
                max={property.max}
                step={property.step || 1}
                value={[value]}
                onValueChange={([next]) => onChange(property.name, next)}
                aria-label={property.label}
              />
            )}
            <Input
              id={id}
              type="number"
              disabled={disabled}
              className={bounded ? "w-24" : undefined}
              min={property.min}
              max={property.max}
              step={property.step || 1}
              value={Number.isFinite(value) ? value : 0}
              onChange={(event) => {
                const next = property.kind === "int" ? parseInt(event.target.value, 10) : parseFloat(event.target.value);
                if (Number.isFinite(next)) onChange(property.name, next);
              }}
            />
          </div>
        </div>
      );
    }
    case "text":
    case "password":
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{property.label}</Label>
          <Input
            id={id}
            type={property.kind === "password" ? "password" : "text"}
            disabled={disabled}
            value={String(property.value ?? "")}
            onChange={(event) => onChange(property.name, event.target.value)}
          />
        </div>
      );
    case "multiline":
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{property.label}</Label>
          <Textarea id={id} disabled={disabled} value={String(property.value ?? "")} onChange={(event) => onChange(property.name, event.target.value)} />
        </div>
      );
    case "info":
      return <p className="text-sm text-muted-foreground">{property.label}</p>;
    case "path":
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{property.label}</Label>
          <div className="flex gap-2">
            <Input id={id} disabled={disabled} value={String(property.value ?? "")} onChange={(event) => onChange(property.name, event.target.value)} />
            <Button
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label={t("browse")}
              onClick={async () => {
                const picked = await studio.pickFile(property.pathFilter, Boolean(property.directory));
                if (picked) onChange(property.name, picked, true);
              }}
            >
              <FolderOpenIcon />
            </Button>
          </div>
        </div>
      );
    case "list": {
      const options = property.options ?? [];
      const current = String(property.value ?? "");
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{property.label}</Label>
          <Select
            disabled={disabled || options.length === 0}
            value={options.some((option) => String(option.value) === current) ? `option-${options.findIndex((option) => String(option.value) === current)}` : undefined}
            onValueChange={(next) => {
              const option = options[Number(next.slice("option-".length))];
              if (option) onChange(property.name, option.value, true);
            }}
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder={t("choose")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option, index) => (
                <SelectItem key={String(option.value)} value={`option-${index}`}>
                  {option.label || String(option.value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {options.length === 0 && <p className="text-sm text-muted-foreground">{t("noOptions")}</p>}
        </div>
      );
    }
    case "editableList": {
      const entries = Array.isArray(property.value) ? property.value as { value: string }[] : [];
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{property.label}</Label>
          <Textarea id={id} disabled={disabled} value={entries.map((entry) => entry.value).join("\n")} placeholder={t("onePerLine")}
            onChange={(event) => onChange(property.name, event.target.value.split("\n").map((value) => ({ value })))} />
          <Button variant="outline" disabled={disabled} className="justify-self-start" onClick={async () => {
            const picked = await studio.pickFile(property.pathFilter, false);
            if (picked) onChange(property.name, [...entries.filter((entry) => entry.value), { value: picked }], true);
          }}><FolderOpenIcon />{t("browse")}</Button>
        </div>
      );
    }
    case "font": {
      const value = property.value && typeof property.value === "object" ? property.value as Record<string, unknown> : {};
      const flags = Number(value.flags) || 0;
      const change = (patch: Record<string, unknown>) => onChange(property.name, { ...value, ...patch });
      return (
        <fieldset disabled={disabled} aria-label={property.label} className="grid gap-3">
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="grid gap-2"><Label htmlFor={id}>{t("fontFamily")}</Label><Input id={id} value={String(value.face ?? "")} onChange={(event) => change({ face: event.target.value })} /></div>
            <div className="grid gap-2"><Label htmlFor={`${id}-size`}>{t("fontSize")}</Label><Input id={`${id}-size`} type="number" min={1} max={1000} value={Number(value.size) || 72} onChange={(event) => {
              const size = Number(event.target.value);
              if (size >= 1 && size <= 1000) change({ size });
            }} /></div>
          </div>
          <div className="flex gap-4">
            {([1, 2] as const).map((flag) => <label key={flag} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(flags & flag) !== 0} onChange={(event) => {
              const next = event.target.checked ? flags | flag : flags & ~flag;
              change({ flags: next, style: next & 1 ? next & 2 ? "Bold Italic" : "Bold" : next & 2 ? "Italic" : "Regular" });
            }} />{t(flag === 1 ? "bold" : "italic")}</label>)}
          </div>
        </fieldset>
      );
    }
    case "color": {
      const color = unpackSourceColor(Number(property.value ?? 0xffffffff));
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{property.label}</Label>
          <ColorPicker
            id={id}
            label={property.label}
            disabled={disabled}
            value={property.allowAlpha ? formatColor(color) : toHex(color)}
            opacity={Boolean(property.allowAlpha)}
            onChange={(next) => {
              const parsed = parseColor(next);
              if (parsed) onChange(property.name, packSourceColor({ ...parsed, a: property.allowAlpha ? parsed.a : color.a }));
            }}
          />
        </div>
      );
    }
    case "button":
      return (
        <Button variant="outline" disabled={disabled} onClick={onButton} className="justify-self-start">
          {property.label}
        </Button>
      );
    default:
      return null;
  }
}
