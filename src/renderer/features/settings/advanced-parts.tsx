import { ChevronDownIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { AUDIO_TRACK_COUNT, toggleTrack } from "../../../shared/formats";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** "Advanced" toggle that reveals rarely needed controls; closed unless they hold non-default values. */
export function AdvancedDisclosure({ initiallyOpen = false, children }: { initiallyOpen?: boolean; children: ReactNode }) {
  const t = useTranslations("workspace");
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  return (
    <div className="grid gap-4">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 justify-self-start"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDownIcon className={cn("transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
        {t("advanced")}
      </Button>
      {open && (
        <div id={id} className="grid gap-4">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Six toggle buttons, one per audio track. `allowNone` lets every track be
 * switched off (a source); otherwise the last one stays on (a recording).
 */
export function TrackToggles({
  label,
  value,
  disabled = false,
  allowNone = false,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  allowNone?: boolean;
  onChange: (value: number) => void;
}) {
  const t = useTranslations("workspace");
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {Array.from({ length: AUDIO_TRACK_COUNT }, (_, index) => index + 1).map((track) => {
        const on = (value & (1 << (track - 1))) !== 0;
        const next = toggleTrack(value, track, !on);
        return (
          <Button
            key={track}
            type="button"
            size="icon-sm"
            variant={on ? "default" : "outline"}
            aria-pressed={on}
            aria-label={t("track", { number: track })}
            title={t("track", { number: track })}
            disabled={disabled || (!allowNone && next === 0)}
            onClick={() => onChange(next)}
            className="tabular-nums"
          >
            {track}
          </Button>
        );
      })}
    </div>
  );
}
