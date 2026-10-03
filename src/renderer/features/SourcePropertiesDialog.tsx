import { FolderOpenIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { PropertyDTO } from "../../shared/types";
import { Button } from "@/components/ui/button";
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
import { useAction } from "@/lib/use-action";

/** Edits a source's engine properties. Changes apply live, like OBS. */
export function SourcePropertiesDialog({ source, onClose }: { source: string | null; onClose: () => void }) {
  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      {source !== null && <PropertiesForm source={source} onClose={onClose} />}
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

  useEffect(() => {
    let cancelled = false;
    void run(() => studio.getSourceProperties(source)).then((result) => {
      if (!cancelled) setProperties(result ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [source, run]);

  const flush = async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const settings = pendingUpdate.current;
    pendingUpdate.current = {};
    if (Object.keys(settings).length === 0) return;
    const next = await run(() => studio.updateSourceSettings(source, settings));
    if (next) setProperties(next);
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
                  await flush();
                  const next = await run(() => studio.clickSourceButton(source, property.name));
                  if (next) setProperties(next);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button
          onClick={async () => {
            await flush();
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
            value={options.some((option) => String(option.value) === current) ? current : undefined}
            onValueChange={(next) => {
              const option = options.find((entry) => String(entry.value) === next);
              if (option) onChange(property.name, option.value, true);
            }}
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder={t("choose")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={String(option.value)} value={String(option.value)}>
                  {option.label || String(option.value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    case "color": {
      // libobs stores colors as 0xAABBGGRR.
      const raw = Number(property.value ?? 0xffffffff) >>> 0;
      const hex = `#${[raw & 0xff, (raw >> 8) & 0xff, (raw >> 16) & 0xff].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
      return (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={id}>{property.label}</Label>
          <input
            id={id}
            type="color"
            disabled={disabled}
            value={hex}
            className="h-8 w-14 cursor-pointer rounded-md border bg-transparent"
            onChange={(event) => {
              const value = event.target.value.slice(1);
              const r = parseInt(value.slice(0, 2), 16);
              const g = parseInt(value.slice(2, 4), 16);
              const b = parseInt(value.slice(4, 6), 16);
              const alpha = (raw >>> 24) || 0xff;
              onChange(property.name, ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0);
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
