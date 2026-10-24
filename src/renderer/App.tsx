import { UnplugIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";
import { useTranslations } from "use-intl";
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
import { SetupWizard } from "@/features/setup/SetupWizard";
import { SignInGate } from "@/features/signin/SignInGate";
import { OverlaysPage } from "@/features/overlays/OverlaysPage";
import { SourcesDock } from "@/features/SourcesDock";
import { errorCode, studio } from "@/lib/studio";
import { useArrowNudge } from "@/lib/use-arrow-nudge";
import { useDarkMode } from "@/lib/theme";
import { useCanvasUndo } from "@/lib/use-canvas-undo";
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
  /** The first state never arrived after the spaced retries; the user can try again. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    // The first state can fail while the app is still starting; a few spaced retries keep the
    // loading screen from waiting forever, and a lasting failure replaces it with a retry.
    const load = (attempt: number) => {
      studio
        .getSnapshot()
        .then((initial) => {
          if (!cancelled) setSnapshot(initial);
        })
        .catch((error: unknown) => {
          console.error(`[app] could not load the studio state (attempt ${attempt + 1})`, error);
          if (cancelled || useStudio.getState().snapshot) return;
          if (attempt < 3) retryTimer = window.setTimeout(() => load(attempt + 1), 1000 * 2 ** attempt);
          else setLoadFailed(true);
        });
    };
    load(0);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [setSnapshot, loadAttempt]);

  useEffect(() => {
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
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [setSnapshot, setStats, setLevels, applyChat, t]);

  const dark = useDarkMode();

  return (
    <div className="flex h-full flex-col">
      <SignInGate>
        <StudioKeyboard />
        <Header />
        {!snapshot && loadFailed ? (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <UnplugIcon aria-hidden className="size-16 text-muted-foreground" strokeWidth={1.5} />
            <h2 className="text-xl font-bold">{t("engine.failedTitle")}</h2>
            <p className="max-w-md text-sm text-muted-foreground">{t("errors.codes.generic")}</p>
            <Button
              onClick={() => {
                setLoadFailed(false);
                setLoadAttempt((value) => value + 1);
              }}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : !snapshot || (!snapshot.ready && !snapshot.engineErrorKey) ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="size-6 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-label={t("common.loading")} />
          </div>
        ) : snapshot.engineErrorKey ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <UnplugIcon aria-hidden className="size-16 text-muted-foreground" strokeWidth={1.5} />
            <h2 className="text-xl font-bold">{t("engine.failedTitle")}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {t.has(snapshot.engineErrorKey) ? t(snapshot.engineErrorKey) : t("errors.codes.engine-init-failed")}
            </p>
            <Button
              disabled={restarting}
              onClick={async () => {
                setRestarting(true);
                try {
                  await studio.restartEngine();
                } catch (error) {
                  console.error("[app] engine restart failed", error);
                  const code = errorCode(error);
                  toast.error(t.has(`errors.codes.${code}`) ? t(`errors.codes.${code}`) : t("errors.codes.generic"));
                } finally {
                  setRestarting(false);
                }
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
          <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 animate-ui-fade">
            <div className="flex min-h-0 flex-1 gap-3">
              <Preview />
              {chatOpen && <ChatPanel />}
            </div>
            <div className="dock-grid shrink-0">
              <ScenesDock />
              <SourcesDock />
              <MixerDock />
              <DestinationsDock />
              <ControlsDock />
            </div>
          </main>
        )}
        <SetupWizard />
      </SignInGate>

      <AlertDialog open={quitRequested} onOpenChange={setQuitRequested}>
        {quitRequested && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("quit.title")}</AlertDialogTitle>
              <AlertDialogDescription>{t("quit.description")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  void studio.quitApp().catch((error: unknown) => {
                    console.error("[app] quit failed", error);
                    toast.error(t("errors.codes.generic"));
                  })
                }
              >
                {t("quit.confirm")}
              </AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
      <Toaster position="bottom-right" theme={dark ? "dark" : "light"} richColors closeButton />
    </div>
  );
}

/** Canvas shortcuts (undo, arrow-key nudging) work only while the studio is open, never behind the sign-in screen. */
function StudioKeyboard() {
  useCanvasUndo();
  useArrowNudge();
  return null;
}
