import type { ReactNode } from "react";
import { Label, Switch } from "@/components/ui/form";

/** One titled card on the settings page. */
export function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-6">
      <h3 className="text-xl font-bold text-neutral-900 dark:text-white">{title}</h3>
      {children}
    </section>
  );
}

/** A labelled switch with a short hint. */
export function ToggleRow({
  id,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="grid min-w-0 flex-1 gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
