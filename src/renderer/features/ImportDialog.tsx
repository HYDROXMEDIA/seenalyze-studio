import { FileJsonIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { ImportCandidate, ImportResult } from "../../shared/workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";

/** Lists scene collections from OBS Studio and Streamlabs Desktop and imports one. */
export function ImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported?: (result: ImportResult) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ImportForm onDone={() => onOpenChange(false)} onImported={onImported} />}
    </Dialog>
  );
}

function ImportForm({ onDone, onImported }: { onDone: () => void; onImported?: (result: ImportResult) => void }) {
  const t = useTranslations("workspace.import");
  const tc = useTranslations("common");
  const run = useAction();
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    studio
      .findImports()
      .then((found) => {
        if (!cancelled) setCandidates(found);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const importOne = async (candidateId: string | null) => {
    setBusy(candidateId ?? "file");
    const result = await run(() => studio.importCollection(candidateId, true));
    setBusy(null);
    if (!result) return;
    const details = [
      result.unavailableSources > 0 ? t("missing", { count: result.unavailableSources }) : null,
      result.skippedFilters > 0 ? t("skippedFilters", { count: result.skippedFilters }) : null,
    ].filter(Boolean).join(" ");
    toast.success(t("done", { name: result.name }), details ? { description: details } : undefined);
    onImported?.(result);
    onDone();
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      {candidates === null ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden />
          {t("searching")}
        </div>
      ) : candidates.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="grid max-h-80 gap-2 overflow-y-auto">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{candidate.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t(`apps.${candidate.app}`)} · {t("counts", { scenes: candidate.scenes, sources: candidate.sources })}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void importOne(candidate.id)}>
                {busy === candidate.id && <Loader2Icon className="animate-spin" aria-hidden />}
                {t("import")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" disabled={busy !== null} onClick={() => void importOne(null)}>
          {busy === "file" ? <Loader2Icon className="animate-spin" aria-hidden /> : <FileJsonIcon aria-hidden />}
          {t("chooseFile")}
        </Button>
        <Button variant="outline" disabled={busy !== null} onClick={onDone}>
          {tc("cancel")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
