import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";
import { STORAGE_CATEGORIES, type StorageCategoryId, type StorageUsage } from "../../../shared/types";
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
import { formatBytes } from "@/lib/format-bytes";
import { errorCode, studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { SettingRow, SettingsCard } from "./parts";

type Load = { status: "loading" } | { status: "failed" } | { status: "ready"; usage: StorageUsage };

/** Share of the drive for the bar, as a percentage; a used part is always at least a sliver wide. */
function share(bytes: number, total: number): string {
  return `${Math.min(100, (bytes / total) * 100)}%`;
}

function DiskBar({ usage, appBytes }: { usage: StorageUsage; appBytes: number }) {
  const t = useTranslations("settings.storageCard");
  const locale = useLocale();
  const disk = usage.disk;
  if (!disk) return <p role="alert" className="text-sm text-destructive">{t("diskUnavailable")}</p>;
  const recordings = usage.recordings.bytes ?? 0;
  const other = Math.max(0, disk.totalBytes - disk.freeBytes - appBytes - recordings);
  // The legend names the app and the recordings; other used space is only drawn.
  const parts = [
    { id: "app", bytes: appBytes, label: t("diskApp"), color: "bg-primary" },
    { id: "recordings", bytes: recordings, label: t("diskRecordings"), color: "bg-selection" },
    { id: "other", bytes: other, label: "", color: "bg-muted-foreground/40" },
  ];
  const summary = t("diskSummary", { free: formatBytes(disk.freeBytes, locale), total: formatBytes(disk.totalBytes, locale) });
  return (
    <div className="grid gap-2">
      <div role="img" aria-label={summary} className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {parts.map((part) =>
          part.bytes > 0 ? <span key={part.id} className={part.color} style={{ width: share(part.bytes, disk.totalBytes), minWidth: 3 }} /> : null,
        )}
      </div>
      <p className="text-sm font-medium">{summary}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {parts.slice(0, 2).map((part) => (
          <li key={part.id} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-2 rounded-full ${part.color}`} />
            {part.label} {formatBytes(part.bytes, locale)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Settings › Storage: what the app uses on this drive, with a clean button for each kind of app data. */
export function StorageCard({ locked }: { locked: boolean }) {
  const t = useTranslations("settings");
  const ts = useTranslations("settings.storageCard");
  const tc = useTranslations("common");
  const locale = useLocale();
  const run = useAction();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [confirm, setConfirm] = useState<StorageCategoryId | null>(null);
  const [cleaning, setCleaning] = useState<StorageCategoryId | null>(null);

  const fetchUsage = useCallback(
    () =>
      studio.getStorageUsage().then(
        (usage): Load => ({ status: "ready", usage }),
        (error: unknown): Load => {
          console.error("[storage] usage could not be read", errorCode(error));
          return { status: "failed" };
        },
      ),
    [],
  );

  // Read on opening, and again when going live or recording starts or ends, so locked rows are current.
  useEffect(() => {
    let current = true;
    void fetchUsage().then((next) => {
      if (current) setLoad(next);
    });
    return () => {
      current = false;
    };
  }, [fetchUsage, locked]);

  const retry = () => {
    setLoad({ status: "loading" });
    void fetchUsage().then(setLoad);
  };

  const clean = async () => {
    const category = confirm;
    setConfirm(null);
    if (!category) return;
    setCleaning(category);
    try {
      const usage = await run(() => studio.cleanStorage(category));
      if (usage) {
        setLoad({ status: "ready", usage });
        toast.success(ts("cleaned"));
      } else {
        // The reason was shown by the failed action; the rows may now be locked or partly cleaned.
        setLoad(await fetchUsage());
      }
    } finally {
      setCleaning(null);
    }
  };

  if (load.status === "loading") {
    return (
      <SettingsCard title={t("storage")}>
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label={tc("loading")} />
      </SettingsCard>
    );
  }
  if (load.status === "failed") {
    return (
      <SettingsCard title={t("storage")}>
        <div className="flex items-center gap-4">
          <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">{ts("loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            {tc("retry")}
          </Button>
        </div>
      </SettingsCard>
    );
  }

  const { usage } = load;
  const size = (bytes: number | null) => (bytes === null ? ts("unknownSize") : formatBytes(bytes, locale));
  const appBytes = usage.categories.reduce((sum, category) => sum + (category.bytes ?? 0), 0);
  return (
    <SettingsCard title={t("storage")}>
      <DiskBar usage={usage} appBytes={appBytes} />
      <div className="grid gap-2">
        {STORAGE_CATEGORIES.map((id) => {
          const category = usage.categories.find((entry) => entry.id === id);
          if (!category) return null;
          const blocked = category.locked || locked || cleaning !== null;
          return (
            <SettingRow key={id} title={ts(`categories.${id}.title`)} detail={category.locked || locked ? ts("locked") : ts(`categories.${id}.detail`)}>
              <span className="text-sm text-muted-foreground">{size(category.bytes)}</span>
              <Button variant="outline" size="sm" disabled={blocked || category.bytes === 0} onClick={() => setConfirm(id)}>
                {cleaning === id ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
                {ts("clean")}
              </Button>
            </SettingRow>
          );
        })}
        <SettingRow title={ts("recordingsTitle")} detail={ts("recordingsDetail")}>
          <span className="text-sm text-muted-foreground">{size(usage.recordings.bytes)}</span>
          <Button variant="outline" size="sm" onClick={() => void run(() => studio.openRecordingsFolder())}>
            {ts("openFolder")}
          </Button>
        </SettingRow>
      </div>
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        {confirm && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{ts(`categories.${confirm}.confirmTitle`)}</AlertDialogTitle>
              <AlertDialogDescription>{ts(`categories.${confirm}.confirmDescription`)}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void clean()}>{ts("clean")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </SettingsCard>
  );
}
