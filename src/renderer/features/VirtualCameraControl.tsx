import { ChevronDownIcon, SquareIcon, VideoIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
  DialogHeader,
  NativeMenu,
} from "@/components/ui/overlays";
import { isMac, studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";

/**
 * Start/stop for the virtual camera, with the scene it shows. When the system
 * camera component is missing, explains the one-time setup instead of
 * installing anything on its own.
 */
export function VirtualCameraControl() {
  const t = useTranslations("controls.virtualCamera");
  const tc = useTranslations("common");
  const run = useAction();
  const camera = useStudio((state) => state.snapshot?.virtualCamera);
  const scenes = useStudio((state) => state.snapshot?.scenes ?? []);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!camera || camera.availability === "unsupported") return null;
  const needsSetup = camera.availability === "installable" || camera.availability === "missing";

  const act = async (call: () => Promise<void>) => {
    setBusy(true);
    try {
      await run(call);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    if (camera.active) void act(() => studio.stopVirtualCamera());
    else if (needsSetup) setSetupOpen(true);
    else void act(() => studio.startVirtualCamera());
  };

  const install = () =>
    act(async () => {
      await studio.installVirtualCamera();
      setSetupOpen(false);
      await studio.startVirtualCamera();
    });

  // Closes by itself once a check finds the camera ready.
  const showSetup = setupOpen && needsSetup;

  return (
    <>
      <div className="flex gap-1">
        <Button variant="outline" className="min-w-0 flex-1" disabled={busy} aria-pressed={camera.active} onClick={toggle}>
          {camera.active ? <SquareIcon className="fill-current" /> : <VideoIcon />}
          {camera.active ? t("stop") : t("start")}
          {camera.scene && <span className="min-w-0 truncate text-muted-foreground">{camera.scene}</span>}
        </Button>
        <NativeMenu
          items={[
            { label: t("program"), disabled: camera.scene === null, onSelect: () => void run(() => studio.setVirtualCameraScene(null)) },
            ...(scenes.length > 0 ? ["separator" as const] : []),
            ...scenes.map((scene) => ({
              label: scene.name,
              disabled: scene.name === camera.scene,
              onSelect: () => void run(() => studio.setVirtualCameraScene(scene.name)),
            })),
          ]}
        >
          <Button variant="outline" size="icon" aria-label={t("source")} title={t("source")}>
            <ChevronDownIcon />
          </Button>
        </NativeMenu>
      </div>

      <AlertDialog open={showSetup} onOpenChange={setSetupOpen}>
        {showSetup && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{camera.availability === "installable" ? t("setupTitle") : t("unavailableTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {camera.availability === "installable" ? (isMac ? t("setupMac") : t("setupWindows")) : t("unavailableDescription")}
              </AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <Button variant="outline" disabled={busy} onClick={() => void act(() => studio.checkVirtualCamera())}>
                {t("checkAgain")}
              </Button>
              {camera.availability === "installable" && (
                <Button disabled={busy} onClick={() => void install()}>
                  {t("install")}
                </Button>
              )}
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}
