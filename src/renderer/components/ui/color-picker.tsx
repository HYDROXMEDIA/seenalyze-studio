import { ChevronDownIcon } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslations } from "use-intl";
import { clamp, formatColor, hsvToRgb, parseColor, rgbToHsv, toHex, type Hsv } from "@/lib/color";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input, Label } from "./form";
import { Popover, PopoverContent, PopoverTrigger } from "./overlays";

const CHECKERBOARD = {
  backgroundImage: "repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%)",
  backgroundSize: "10px 10px",
};

/** Shared color editor: a color plane, vertical hue strip and exact hex entry. */
export function ColorPicker({
  id,
  value,
  label,
  onChange,
  opacity = true,
  disabled = false,
}: {
  id: string;
  value: string;
  label: string;
  onChange: (value: string) => void;
  opacity?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("colorPicker");
  const color = parseColor(value) ?? { r: 255, g: 255, b: 255, a: 1 };
  const hex = toHex(color);
  const [remembered, setRemembered] = useState({ hex, hsv: rgbToHsv(color) });
  const [draft, setDraft] = useState(hex);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(hex);
  }
  // Hue and saturation remain editable at black, white and grey.
  const hsv = remembered.hex === hex ? remembered.hsv : rgbToHsv(color);
  const hueColor = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));

  const pick = (next: Hsv) => {
    const rgb = hsvToRgb(next);
    setRemembered({ hex: toHex(rgb), hsv: next });
    onChange(formatColor({ ...rgb, a: color.a }));
  };

  const move = (event: PointerEvent<HTMLDivElement>, hue = false) => {
    if (disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = clamp((event.clientX - bounds.left) / bounds.width);
    const y = clamp((event.clientY - bounds.top) / bounds.height);
    pick(hue ? { ...hsv, h: y * 360 } : { ...hsv, s: x, v: 1 - y });
  };

  const start = (event: PointerEvent<HTMLDivElement>, hue = false) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    move(event, hue);
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>, hue = false) => {
    if (disabled) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const end = event.key === "End";
      pick(hue ? { ...hsv, h: end ? 360 : 0 } : { ...hsv, s: end ? 1 : 0 });
      return;
    }
    const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    if (hue) {
      pick({ ...hsv, h: (hsv.h + direction * (event.shiftKey ? 30 : 5) + 360) % 360 });
    } else {
      const step = direction * (event.shiftKey ? 0.1 : 0.01);
      pick(event.key === "ArrowLeft" || event.key === "ArrowRight" ? { ...hsv, s: clamp(hsv.s + step) } : { ...hsv, v: clamp(hsv.v + step) });
    }
  };

  const parsedDraft = /^#[0-9a-f]{3,8}$/iu.test(draft) ? parseColor(draft) : null;
  const validDraft = parsedDraft !== null && (opacity || draft.length === 4 || draft.length === 7);
  const applyHex = (next: string) => {
    const parsed = /^#[0-9A-F]{3,8}$/iu.test(next) ? parseColor(next) : null;
    if (!parsed || (!opacity && next.length !== 4 && next.length !== 7)) return false;
    const withAlpha = { ...parsed, a: opacity && (next.length === 5 || next.length === 9) ? parsed.a : color.a };
    setSynced(formatColor(withAlpha));
    setRemembered({ hex: toHex(parsed), hsv: rgbToHsv(parsed) });
    onChange(formatColor(withAlpha));
    return true;
  };

  return (
    <Popover modal>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" disabled={disabled} aria-label={label} className="h-11 w-full justify-start gap-3 px-3">
          <span className="relative size-6 shrink-0 overflow-hidden rounded-md border" style={CHECKERBOARD}>
            <span className="absolute inset-0" style={{ background: opacity ? formatColor(color) : hex }} />
          </span>
          <span className="flex-1 text-left text-sm tabular-nums">{hex}</span>
          {opacity && color.a < 1 && <span className="text-xs text-muted-foreground tabular-nums">{Math.round(color.a * 100)}%</span>}
          <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={16} aria-label={label} className="grid gap-4">
        <div className={cn("grid h-56 grid-cols-[1fr_2.75rem] overflow-hidden rounded-xl", disabled && "opacity-50")}>
          <div
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label={t("saturation")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            aria-valuetext={t("saturationBrightness", { saturation: Math.round(hsv.s * 100), brightness: Math.round(hsv.v * 100) })}
            className="relative cursor-crosshair touch-none outline-none focus-visible:shadow-[inset_0_0_0_2px_#fff,inset_0_0_0_4px_#000]"
            style={{ backgroundColor: hueColor, backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)" }}
            onPointerDown={(event) => start(event)}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event); }}
            onKeyDown={(event) => keys(event)}
          >
            <span className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_2px_6px_#0006]"
              style={{ left: `clamp(10px, ${hsv.s * 100}%, calc(100% - 10px))`, top: `clamp(10px, ${(1 - hsv.v) * 100}%, calc(100% - 10px))`, backgroundColor: hex }} />
          </div>
          <div
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label={t("hue")}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            className="relative cursor-ns-resize touch-none outline-none focus-visible:shadow-[inset_0_0_0_2px_#fff,inset_0_0_0_4px_#000]"
            style={{ background: "linear-gradient(to bottom, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
            onPointerDown={(event) => start(event, true)}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event, true); }}
            onKeyDown={(event) => keys(event, true)}
          >
            <span className="pointer-events-none absolute inset-x-1 h-1.5 -translate-y-1/2 rounded-full border border-white bg-white shadow-[0_2px_6px_#0006]" style={{ top: `clamp(4px, ${hsv.h / 360 * 100}%, calc(100% - 4px))` }} />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2">
          <span className="relative size-8 shrink-0 overflow-hidden rounded-lg border" style={CHECKERBOARD}>
            <span className="absolute inset-0" style={{ background: opacity ? formatColor(color) : hex }} />
          </span>
          <Label htmlFor={id + "-hex"} className="text-xs text-muted-foreground">{t("hex")}</Label>
          <Input id={id + "-hex"} value={draft} disabled={disabled} maxLength={opacity ? 9 : 7} autoComplete="off" spellCheck={false}
            aria-invalid={!validDraft}
            className="h-8 border-transparent bg-transparent px-1 font-medium shadow-none tabular-nums dark:bg-transparent"
            onBlur={() => setDraft(applyHex(draft) ? toHex(parsedDraft!) : hex)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              setDraft(applyHex(draft) ? toHex(parsedDraft!) : hex);
            }}
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              setDraft(next);
              if (/^#[0-9A-F]{6}([0-9A-F]{2})?$/u.test(next)) applyHex(next);
            }} />
        </div>
        {opacity && (
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t("opacity")}</span>
              <span className="tabular-nums">{Math.round(color.a * 100)}%</span>
            </div>
            <SliderPrimitive.Root min={0} max={1} step={0.01} value={[color.a]} disabled={disabled} onValueChange={([alpha]) => onChange(formatColor({ ...color, a: alpha }))} className="relative flex h-11 touch-none items-center">
              <SliderPrimitive.Track className="relative h-3 grow overflow-hidden rounded-full border" style={CHECKERBOARD}>
                <span className="absolute inset-0" style={{ background: `linear-gradient(to right, transparent, ${hex})` }} />
              </SliderPrimitive.Track>
              <SliderPrimitive.Thumb aria-label={t("opacity")} className="block size-5 rounded-full border-2 border-white shadow-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring" style={{ backgroundColor: hex }} />
            </SliderPrimitive.Root>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
