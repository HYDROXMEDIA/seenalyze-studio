import { CircleIcon, FolderOpenIcon, RadioIcon, Settings2Icon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Dock } from "@/components/Dock";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { formatDuration } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { isActive } from "./DestinationsDock";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function ControlsDock() {
  const t = useTranslations("controls");
  const tc = useTranslations("common");
  const run = useAction();
  const destinations = useStudio((state) => state.snapshot?.destinations ?? []);
  const statuses = useStudio((state) => state.snapshot?.destinationStatus ?? []);
  const recording = useStudio((state) => state.snapshot?.recording ?? { active: false });
  const setView = useStudio((state) => state.setView);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const askBeforeLive = useStudio((state) => state.snapshot?.preferences.confirmGoLive ?? false);

  const activeIds = statuses.filter((status) => isActive(status)).map((status) => status.id);
  const live = activeIds.length > 0;
  const enabledIds = destinations.filter((destination) => destination.enabled).map((destination) => destination.id);
  const liveSince = Math.min(...statuses.filter((status) => status.state === "live" && status.startedAt).map((status) => status.startedAt as number));
  const now = useNow(live || recording.active);

  return (
    <Dock title={t("title")}>
      <div className="grid gap-2 p-3">
        {live ? (
          <Button variant="destructive" size="lg" onClick={() => setConfirmEnd(true)}>
            <SquareIcon className="fill-current" />
            {t("endStream")}
          </Button>
        ) : (
          <Button
            variant="live"
            size="lg"
            disabled={enabledIds.length === 0}
            onClick={() => (askBeforeLive ? setConfirmStart(true) : void run(() => studio.goLive(enabledIds)))}
          >
            <RadioIcon />
            {enabledIds.length > 1 ? t("goLiveMany", { count: enabledIds.length }) : t("goLive")}
          </Button>
        )}
        {live && Number.isFinite(liveSince) && (
          <p className="text-center text-xs text-muted-foreground tabular-nums">{t("liveFor", { time: formatDuration(now - liveSince) })}</p>
        )}

        {recording.active ? (
          <Button variant="outline" onClick={() => void run(() => studio.stopRecording())}>
            <SquareIcon className="fill-red-500 text-red-500" />
            {t("stopRecording")}
            {recording.startedAt && <span className="text-muted-foreground tabular-nums">{formatDuration(now - recording.startedAt)}</span>}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => void run(() => studio.startRecording())}>
            <CircleIcon className="fill-red-500 text-red-500" />
            {t("startRecording")}
          </Button>
        )}
        {!recording.active && recording.lastFile && (
          <Button variant="ghost" size="sm" onClick={() => void run(() => studio.revealRecording())}>
            <FolderOpenIcon />
            {t("showRecording")}
          </Button>
        )}

        <Button variant="secondary" onClick={() => setView("settings")}>
          <Settings2Icon />
          {t("settings")}
        </Button>
      </div>

      <AlertDialog open={confirmStart} onOpenChange={setConfirmStart}>
        {confirmStart && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("startTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("startDescription", { count: enabledIds.length })}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(() => studio.goLive(enabledIds))}>{t("goLive")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        {confirmEnd && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("endTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("endDescription", { count: activeIds.length })}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(() => studio.endStream(activeIds))}>{t("endStream")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Dock>
  );
}
