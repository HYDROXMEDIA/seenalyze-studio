import { HeartIcon, MessageSquareIcon, MoonIcon, RadioIcon, SparklesIcon, StarIcon, SunIcon, UsersIcon, ZapIcon, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { resolveValues, settingsToCss, type OverlayField, type OverlayValue } from "../../../shared/overlays";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TESTS: { key: string; icon: LucideIcon; message: { kind: "chat" } | { kind: "event"; eventType: string } }[] = [
  { key: "chat", icon: MessageSquareIcon, message: { kind: "chat" } },
  { key: "follow", icon: HeartIcon, message: { kind: "event", eventType: "follow" } },
  { key: "subscription", icon: StarIcon, message: { kind: "event", eventType: "subscription" } },
  { key: "superChat", icon: SparklesIcon, message: { kind: "event", eventType: "superChat" } },
  { key: "cheer", icon: ZapIcon, message: { kind: "event", eventType: "cheer" } },
  { key: "raid", icon: UsersIcon, message: { kind: "event", eventType: "raid" } },
  { key: "membership", icon: RadioIcon, message: { kind: "event", eventType: "membership" } },
];

/**
 * Live preview of an overlay at its real size, scaled to fit. The page runs in
 * a sandboxed frame with demo data; settings are posted in instantly.
 */
export function OverlayPreview({
  url,
  width,
  height,
  fields,
  values,
}: {
  url: string;
  width: number;
  height: number;
  fields?: OverlayField[];
  values?: Record<string, OverlayValue>;
}) {
  const t = useTranslations("overlays.preview");
  const areaRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [dark, setDark] = useState(true);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const fit = () => {
      const box = area.getBoundingClientRect();
      setScale(Math.min(1, (box.width - 32) / width, (box.height - 32) / height));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    fit();
    return () => observer.disconnect();
  }, [width, height]);

  const post = (message: object) => frameRef.current?.contentWindow?.postMessage({ source: "seenalyze-editor", ...message }, "*");

  // Settings reach the frame immediately; saving to disk happens separately.
  useEffect(() => {
    if (!fields || !values) return;
    post({ kind: "settings", values: resolveValues(fields, values), css: settingsToCss(fields, values) });
  }, [fields, values]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">{t("test")}</span>
        {TESTS.map(({ key, icon: Icon, message }) => (
          <Button key={key} size="sm" variant="outline" onClick={() => post(message)}>
            <Icon />
            {t(`tests.${key}`)}
          </Button>
        ))}
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          aria-label={dark ? t("lightBackground") : t("darkBackground")}
          onClick={() => setDark(!dark)}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </Button>
      </div>
      <div
        ref={areaRef}
        className={cn("relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border", dark ? "bg-neutral-900" : "bg-neutral-200")}
        style={{
          backgroundImage: `repeating-conic-gradient(${dark ? "#ffffff0d" : "#0000000d"} 0% 25%, transparent 0% 50%)`,
          backgroundSize: "24px 24px",
        }}
      >
        <div style={{ width: width * scale, height: height * scale }} className="relative">
          <iframe
            ref={frameRef}
            key={url}
            src={url}
            title={t("label")}
            sandbox="allow-scripts"
            className="absolute top-0 left-0 origin-top-left border-0"
            style={{ width, height, transform: `scale(${scale})` }}
          />
          <div className="pointer-events-none absolute inset-0 rounded-sm outline outline-1 outline-dashed outline-white/25" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">{t("size", { width, height, scale: Math.round(scale * 100) })}</p>
    </div>
  );
}
