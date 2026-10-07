import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { TRANSFORM_ANCHORS } from "../../shared/transforms";
import type { SourceTransform, SourceTransformDTO, TransformAnchor } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";

export function SourceTransformDialog({ target, onClose }: { target: { scene: string; itemId: number } | null; onClose: () => void }) {
  return target ? <TransformForm key={target.scene + ":" + target.itemId} {...target} onClose={onClose} /> : null;
}

function TransformForm({ scene, itemId, onClose }: { scene: string; itemId: number; onClose: () => void }) {
  const t = useTranslations("transformEditor");
  const tc = useTranslations("common");
  const run = useAction();
  const [original, setOriginal] = useState<SourceTransformDTO | null>(null);
  const [draft, setDraft] = useState<SourceTransformDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty = original && draft && JSON.stringify(original) !== JSON.stringify(draft);
  useEffect(() => {
    let cancelled = false;
    void run(() => studio.getItemTransform(scene, itemId)).then((value) => {
      if (cancelled) return;
      setFailed(!value);
      if (value) { setOriginal(value); setDraft(value); }
    });
    return () => { cancelled = true; };
  }, [scene, itemId, run]);
  const close = () => {
    if (pending) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  const numberField = (key: "x" | "y" | "width" | "height" | "rotation", min: number, max: number) => (
    <Field key={key} label={t(key)} htmlFor={"transform-" + key}>
      <Input id={"transform-" + key} type="number" min={min} max={max} step={0.1} value={draft?.[key] ?? 0} disabled={pending || draft?.locked}
        onChange={(event) => { const n = Number(event.target.value); if (Number.isFinite(n)) setDraft((current) => current ? { ...current, [key]: n } : current); }} />
    </Field>
  );
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{draft ? t("title", { name: draft.sourceName }) : t("loadingTitle")}</DialogTitle></DialogHeader>
        {!draft ? (
          <div className="flex h-32 items-center justify-center">
            {failed ? <p role="alert" className="text-sm text-destructive">{t("loadFailed")}</p> : <span aria-label={tc("loading")} className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />}
          </div>
        ) : (
          <div className="grid max-h-[65vh] gap-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">{numberField("x", -100000, 100000)}{numberField("y", -100000, 100000)}</div>
            <div className="grid grid-cols-2 gap-3">{numberField("width", 1, 32768)}{numberField("height", 1, 32768)}</div>
            <div className="grid grid-cols-2 gap-3">
              {numberField("rotation", -360, 360)}
              <Field label={t("sizing")} htmlFor="transform-sizing">
                <Select value={draft.sizing} disabled={pending || draft.locked} onValueChange={(sizing) => setDraft({ ...draft, sizing: sizing as SourceTransform["sizing"] })}>
                  <SelectTrigger id="transform-sizing"><SelectValue /></SelectTrigger>
                  <SelectContent>{(["fit", "stretch", "scale"] as const).map((mode) => <SelectItem key={mode} value={mode}>{t(`sizingOptions.${mode}`)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            <Field label={t("anchor")} htmlFor="transform-anchor">
              <Select value={draft.anchor} disabled={pending || draft.locked} onValueChange={(anchor) => setDraft({ ...draft, anchor: anchor as TransformAnchor })}>
                <SelectTrigger id="transform-anchor"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(TRANSFORM_ANCHORS) as TransformAnchor[]).map((anchor) => <SelectItem key={anchor} value={anchor}>{t(`anchorOptions.${anchor}`)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <fieldset className="grid grid-cols-2 gap-3" disabled={pending || draft.locked}>
              <legend className="mb-2 text-sm font-medium">{t("crop")}</legend>
              {(["left", "top", "right", "bottom"] as const).map((edge) => (
                <Field key={edge} label={t(`cropEdges.${edge}`)} htmlFor={"crop-" + edge}>
                  <Input id={"crop-" + edge} type="number" min={0} max={32768} step={1} value={draft.crop[edge]}
                    onChange={(event) => { const n = Number(event.target.value); if (Number.isInteger(n)) setDraft({ ...draft, crop: { ...draft.crop, [edge]: n } }); }} />
                </Field>
              ))}
            </fieldset>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={close}>{tc("cancel")}</Button>
          <Button disabled={!draft || !dirty || pending || draft.locked} onClick={async () => {
            if (!draft || !dirty || pending) return;
            setPending(true);
            const saved = await run(async () => { await studio.setItemTransform(scene, itemId, draft); return true; });
            setPending(false);
            if (saved) { toast.success(t("saved")); onClose(); }
          }}>{tc("save")}</Button>
        </DialogFooter>
        <AlertDialog open={discard} onOpenChange={setDiscard}>
          <AlertDialogContent>
            <DialogHeader><AlertDialogTitle>{t("discardTitle")}</AlertDialogTitle><AlertDialogDescription>{t("discardDescription")}</AlertDialogDescription></DialogHeader>
            <DialogFooter><AlertDialogCancel>{tc("cancel")}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t("discard")}</AlertDialogAction></DialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
