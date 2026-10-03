import { useTranslations } from "use-intl";
import type { PermissionKind } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";

/** Explains a missing OS permission and links to the right settings page. */
export function PermissionDialog({ kind, onClose }: { kind: PermissionKind | null; onClose: () => void }) {
  const t = useTranslations("permissions");
  const tc = useTranslations("common");
  const run = useAction();

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      {kind && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(`${kind}.title`)}</DialogTitle>
            <DialogDescription>{t(`${kind}.description`)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {tc("close")}
            </Button>
            {kind === "screen" && (
              <Button variant="secondary" onClick={() => void run(() => studio.relaunchApp())}>
                {t("restart")}
              </Button>
            )}
            <Button onClick={() => void run(() => studio.openPermissionSettings(kind))}>{t("openSettings")}</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
