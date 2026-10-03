import { useState } from "react";
import { useTranslations } from "use-intl";
import { Input, Slider } from "@/components/ui/form";

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() and "transparent". */
export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/u.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = digits.split("").map((d) => d + d).join("");
    const n = (offset: number) => parseInt(digits.slice(offset, offset + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/u.exec(text);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  return null;
}

function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0")).join("")}`;
}

export function formatColor(color: Rgba): string {
  if (color.a >= 1) return toHex(color);
  return `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${Number(color.a.toFixed(2))})`;
}

/** Color picker with opacity, since overlays often use translucent panels. */
export function ColorField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const t = useTranslations("overlays.editor");
  const color = parseColor(value) ?? { r: 255, g: 255, b: 255, a: 1 };
  // The text box keeps what the user is typing until it forms a valid color.
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span
          className="relative size-9 shrink-0 overflow-hidden rounded-md border"
          style={{ backgroundImage: "repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%)", backgroundSize: "10px 10px" }}
        >
          <span className="absolute inset-0" style={{ background: formatColor(color) }} />
          <input
            id={id}
            type="color"
            aria-label={t("pickColor")}
            value={toHex(color)}
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(event) => {
              const next = parseColor(event.target.value);
              if (next) onChange(formatColor({ ...next, a: color.a }));
            }}
          />
        </span>
        <Input
          value={draft}
          spellCheck={false}
          aria-label={t("colorValue")}
          aria-invalid={parseColor(draft) === null}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (parseColor(next)) {
              setSynced(next.trim());
              onChange(next.trim());
            }
          }}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="w-16 text-xs text-muted-foreground">{t("opacity")}</span>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[color.a]}
          aria-label={t("opacity")}
          onValueChange={([alpha]) => onChange(formatColor({ ...color, a: alpha }))}
        />
        <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{Math.round(color.a * 100)}%</span>
      </div>
    </div>
  );
}
