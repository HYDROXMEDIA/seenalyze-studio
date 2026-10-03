import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";
import { useTranslations } from "use-intl";
import disconnectedIcon from "@/assets/icons/disconnected.png";
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
import { ChatPanel } from "@/features/ChatPanel";
import { ControlsDock } from "@/features/ControlsDock";
import { DestinationsDock } from "@/features/DestinationsDock";
import { Header } from "@/features/Header";
import { MixerDock } from "@/features/MixerDock";
import { Preview } from "@/features/Preview";
import { ScenesDock } from "@/features/ScenesDock";
import { SettingsPage } from "@/features/SettingsPage";
import { OverlaysPage } from "@/features/overlays/OverlaysPage";
import { SourcesDock } from "@/features/SourcesDock";
import { studio } from "@/lib/studio";
import { useChat } from "@/store/chat";
import { useStudio } from "@/store/studio";

export function App() {
  const t = useTranslations();
  const snapshot = useStudio((state) => state.snapshot);
  const view = useStudio((state) => state.view);
  const chatOpen = useChat((state) => state.open);
  const applyChat = useChat((state) => state.apply);
  const setSnapshot = useStudio((state) => state.setSnapshot);
  const setStats = useStudio((state) => state.setStats);
  const setLevels = useStudio((state) => state.setLevels);
  const [quitRequested, setQuitRequested] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    studio
      .getSnapshot()
      .then((initial) => {
        if (!cancelled) setSnapshot(initial);
      })
      .catch(console.error);
    const unsubscribers = [
      studio.onSnapshot(setSnapshot),
      studio.onStats(setStats),
      studio.onAudioLevels(setLevels),
      studio.onQuitRequest(() => setQuitRequested(true)),
      studio.onChat(applyChat),
      studio.onNotice((notice) => {
        const text = t.has(notice.key) ? t(notice.key, notice.values) : t("errors.codes.generic");
        if (notice.kind === "error") toast.error(text);
        else if (notice.kind === "success") toast.success(text);
        else toast.info(text);
      }),
    ];
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [setSnapshot, setStats, setLevels, applyChat, t]);

  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  return (
    <div className="flex h-full flex-col">
      <Header />
      {!snapshot || (!snapshot.ready && !snapshot.engineErrorKey) ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="size-6 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-label={t("common.loading")} />
        </div>
      ) : snapshot.engineErrorKey ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <img src={disconnectedIcon} alt="" className="size-16" draggable={false} />
          <h2 className="text-xl font-bold">{t("engine.failedTitle")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t.has(snapshot.engineErrorKey) ? t(snapshot.engineErrorKey) : t("errors.codes.engine-init-failed")}
          </p>
          <Button
            disabled={restarting}
            onClick={async () => {
              setRestarting(true);
              await studio.restartEngine().catch(console.error);
              setRestarting(false);
            }}
          >
            {t("engine.restart")}
          </Button>
        </div>
      ) : view === "settings" ? (
        <SettingsPage />
      ) : view === "overlays" ? (
        <OverlaysPage />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <div className="flex min-h-0 flex-1 gap-3">
            <Preview />
            {chatOpen && <ChatPanel />}
          </div>
          <div className="grid h-72 shrink-0 grid-cols-[1fr_1.3fr_1.3fr_1.5fr_0.9fr] gap-3">
            <ScenesDock />
            <SourcesDock />
            <MixerDock />
            <DestinationsDock />
            <ControlsDock />
          </div>
        </main>
      )}

      <AlertDialog open={quitRequested} onOpenChange={setQuitRequested}>
        {quitRequested && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("quit.title")}</AlertDialogTitle>
              <AlertDialogDescription>{t("quit.description")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void studio.quitApp()}>{t("quit.confirm")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
      <Toaster position="bottom-right" theme={dark ? "dark" : "light"} richColors closeButton />
    </div>
  );
}
