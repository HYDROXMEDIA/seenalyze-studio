import { CircleIcon, ClapperboardIcon, FolderOpenIcon, HistoryIcon, MonitorIcon, RadioIcon, Settings2Icon, SquareIcon } from "lucide-react";
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
import { useGoLive } from "./use-go-live";
import { VirtualCameraControl } from "./VirtualCameraControl";

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
  const screenRecording = useStudio((state) => state.snapshot?.screenRecording.active ?? false);
  const replayActive = useStudio((state) => state.snapshot?.replayBuffer.active ?? false);
  const setView = useStudio((state) => state.setView);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const askBeforeLive = useStudio((state) => state.snapshot?.preferences.confirmGoLive ?? false);
  const askBeforeEnd = useStudio((state) => state.snapshot?.preferences.confirmEndStream ?? true);
  const { goLive, pending, dialog } = useGoLive();

  const activeIds = statuses.filter((status) => isActive(status)).map((status) => status.id);
  const live = activeIds.length > 0;
  const enabledIds = destinations.filter((destination) => destination.enabled).map((destination) => destination.id);
  const liveSince = Math.min(...statuses.filter((status) => status.state === "live" && status.startedAt).map((status) => status.startedAt as number));
  const now = useNow(live || recording.active);

  return (
    <Dock title={t("title")} fitContent className="max-h-[max(18rem,45vh)]">
      {/* Two columns of buttons once the dock is wide enough (two-row layout on narrow, tall windows). */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-2 p-3 @xs:grid-cols-2 short:gap-1.5 short:p-2 [&>button]:min-w-0 short:[&_button]:h-8">
          {live ? (
            <Button variant="destructive" size="lg" className="@xs:col-span-2" onClick={() => (askBeforeEnd ? setConfirmEnd(true) : void run(() => studio.endStream(activeIds)))}>
              <SquareIcon className="fill-current" />
              <span className="truncate">{t("endStream")}</span>
            </Button>
          ) : (
            <Button
              variant="live"
              size="lg"
              className="@xs:col-span-2"
              disabled={enabledIds.length === 0 || pending}
              onClick={() => (askBeforeLive ? setConfirmStart(true) : void goLive(enabledIds))}
            >
              <RadioIcon />
              <span className="truncate">{enabledIds.length > 1 ? t("goLiveMany", { count: enabledIds.length }) : t("goLive")}</span>
            </Button>
          )}
          {live && Number.isFinite(liveSince) && (
            <p className="text-center text-xs text-muted-foreground tabular-nums @xs:col-span-2">{t("liveFor", { time: formatDuration(now - liveSince) })}</p>
          )}

          {recording.active ? (
            <Button variant="outline" onClick={() => void run(() => studio.stopRecording())}>
              <SquareIcon className="fill-red-500 text-red-500" />
              <span className="truncate">{t("stopRecording")}</span>
              {recording.startedAt && <span className="text-muted-foreground tabular-nums">{formatDuration(now - recording.startedAt)}</span>}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void run(() => studio.startRecording())}>
              <CircleIcon className="fill-red-500 text-red-500" />
              <span className="truncate">{t("startRecording")}</span>
            </Button>
          )}
          {!recording.active && recording.lastFile && (
            <Button variant="ghost" size="sm" onClick={() => void run(() => studio.revealRecording())}>
              <FolderOpenIcon />
              <span className="truncate">{t("showRecording")}</span>
            </Button>
          )}

          {replayActive && (
            <Button variant="outline" onClick={() => void run(() => studio.saveReplay())}>
              <HistoryIcon />
              <span className="truncate">{t("saveClip")}</span>
            </Button>
          )}

          <VirtualCameraControl />

          <Button variant="outline" onClick={() => void run(() => studio.toggleScreenRecording())}>
            {screenRecording ? <SquareIcon className="fill-red-500 text-red-500" /> : <MonitorIcon />}
            <span className="truncate">{screenRecording ? t("stopScreenRecording") : t("recordScreen")}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void run(() => studio.openRecordingEditor())}>
            <ClapperboardIcon />
            <span className="truncate">{t("editRecording")}</span>
          </Button>

          <Button variant="secondary" onClick={() => setView("settings")}>
            <Settings2Icon />
            <span className="truncate">{t("settings")}</span>
          </Button>
        </div>
      </div>
      {dialog}

      <AlertDialog open={confirmStart} onOpenChange={setConfirmStart}>
        {confirmStart && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("startTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("startDescription", { count: enabledIds.length })}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void goLive(enabledIds)}>{t("goLive")}</AlertDialogAction>
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
