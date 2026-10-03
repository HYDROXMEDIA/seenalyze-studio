import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import {
  FONT_CHOICES,
  OVERLAY_FIELD_GROUPS,
  resolveValues,
  type OverlayDefinition,
  type OverlayField,
  type OverlayValue,
} from "../../../shared/overlays";
import { Input, Label, Slider, Switch, Textarea } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { ColorField } from "./ColorField";

/** Every editable setting of an overlay, grouped and collapsible. */
export function SettingsPanel({
  overlay,
  onChange,
}: {
  overlay: OverlayDefinition;
  onChange: (key: string, value: OverlayValue) => void;
}) {
  const t = useTranslations("overlays.groups");
  const values = resolveValues(overlay.fields, overlay.values);
  const groups = OVERLAY_FIELD_GROUPS.map((group) => ({
    group,
    fields: overlay.fields.filter((field) => (field.group ?? "Content") === group),
  })).filter((entry) => entry.fields.length > 0);

  return (
    <div className="grid gap-2">
      {groups.map(({ group, fields }) => (
        <Group key={group} title={t(group)} defaultOpen={group === "Content" || group === "Colors"}>
          {fields.map((field) => (
            <FieldControl key={field.key} field={field} value={values[field.key]} onChange={(value) => onChange(field.key, value)} />
          ))}
        </Group>
      ))}
    </div>
  );
}

function Group({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {title}
        <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="grid gap-4 border-t px-3 py-3">{children}</div>}
    </section>
  );
}

function FieldControl({ field, value, onChange }: { field: OverlayField; value: OverlayValue; onChange: (value: OverlayValue) => void }) {
  const t = useTranslations("overlays.editor");
  const id = `overlay-field-${field.key}`;

  switch (field.type) {
    case "toggle":
      return (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={id}>{field.label}</Label>
          <Switch id={id} checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked)} />
        </div>
      );
    case "color":
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{field.label}</Label>
          <ColorField id={id} value={String(value)} onChange={onChange} />
        </div>
      );
    case "range":
    case "number": {
      const n = Number(value);
      const min = field.min ?? 0;
      const max = field.max ?? Math.max(100, n * 2);
      return (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={id}>{field.label}</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {n}
              {field.unit && field.unit !== "px" ? field.unit : field.unit === "px" ? " px" : ""}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Slider min={min} max={max} step={field.step ?? 1} value={[n]} aria-label={field.label} onValueChange={([next]) => onChange(next)} />
            <Input
              id={id}
              type="number"
              className="w-20"
              min={min}
              max={max}
              step={field.step ?? 1}
              value={Number.isFinite(n) ? n : 0}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) onChange(next);
              }}
            />
          </div>
        </div>
      );
    }
    case "select":
    case "font": {
      const options = field.type === "font" ? FONT_CHOICES : (field.options ?? []);
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{field.label}</Label>
          <Select value={String(value)} onValueChange={onChange}>
            <SelectTrigger id={id}>
              <SelectValue placeholder={t("choose")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    case "textarea":
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{field.label}</Label>
          <Textarea id={id} value={String(value)} maxLength={2000} onChange={(event) => onChange(event.target.value)} />
        </div>
      );
    default:
      return (
        <div className="grid gap-2">
          <Label htmlFor={id}>{field.label}</Label>
          <Input id={id} value={String(value)} maxLength={500} onChange={(event) => onChange(event.target.value)} />
        </div>
      );
  }
}
