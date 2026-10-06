import { CircleAlertIcon, RadioIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import type { StreamCheck } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";

/** One checked start flow, shared by the main control and individual destinations. */
export function useGoLive() {
  const run = useAction();
  const t = useTranslations("streamCheck");
  const tc = useTranslations("common");
  const root = useTranslations();
  const destinations = useStudio((state) => state.snapshot?.destinations ?? []);
  const [pending, setPending] = useState(false);
  const [check, setCheck] = useState<StreamCheck | null>(null);
  const start = async (ids: string[]) => {
    if (!ids.length || pending) return;
    setPending(true);
    try {
      const started = await run(async () => { await studio.goLive(ids); return true; });
      if (started) setCheck(null);
    } finally {
      setPending(false);
    }
  };
  const goLive = async (ids: string[]) => {
    if (pending) return;
    setPending(true);
    let report: StreamCheck | undefined;
    try { report = await run(() => studio.checkStream(ids)); }
    finally { setPending(false); }
    if (!report) return;
    if (report.issues.length > 0) setCheck(report);
    else await start(report.readyDestinationIds);
  };
  const dialog = (
    <Dialog open={check !== null} onOpenChange={(open) => { if (!open && !pending) setCheck(null); }}>
      {check && <DialogContent>
        <DialogHeader><DialogTitle>{t("title")}</DialogTitle></DialogHeader>
        <ul className="grid gap-3">
          {check.issues.map((issue) => {
            const destination = destinations.find((entry) => entry.id === issue.destinationId);
            return <li key={(issue.destinationId ?? "scene") + ":" + issue.key} className="flex items-start gap-3 text-sm">
              <CircleAlertIcon className={"mt-0.5 size-4 shrink-0 " + (issue.blocking ? "text-destructive" : "text-amber-600 dark:text-amber-400")} aria-hidden />
              <div>{destination && <p className="mb-0.5 font-medium">{destination.name}</p>}<p>{root.has(issue.key) ? root(issue.key, { count: issue.count ?? 0 }) : t("unknown")}</p></div>
            </li>;
          })}
        </ul>
        {check.issues.some((issue) => issue.blocking) && check.readyDestinationIds.length > 0 && <p className="text-sm text-muted-foreground">{destinations.filter((entry) => check.readyDestinationIds.includes(entry.id)).map((entry) => entry.name).join(", ")}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setCheck(null)}>{tc("cancel")}</Button>
          <Button variant="live" disabled={pending || check.readyDestinationIds.length === 0} onClick={() => void start(check.readyDestinationIds)}>
            <RadioIcon />{check.issues.some((issue) => issue.blocking) ? t("startReady", { count: check.readyDestinationIds.length }) : check.readyDestinationIds.length > 1 ? t("startMany", { count: check.readyDestinationIds.length }) : t("start")}
          </Button>
        </DialogFooter>
      </DialogContent>}
    </Dialog>
  );
  return { goLive, pending, dialog };
}
