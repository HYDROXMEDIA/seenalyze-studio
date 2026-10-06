import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { PermissionKind, SourceChoiceDTO, SourceKind } from "../../shared/types";
import { PermissionDialog } from "@/components/PermissionDialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlays";
import { errorCode, studio } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";
import { SourceIcon } from "./SourcesDock";

const KINDS: SourceKind[] = ["display", "window", "application", "game", "camera", "captureCard", "microphone", "desktopAudio", "applicationAudio", "image", "slideshow", "media", "playlist", "text", "color", "browser", "chatOverlay", "scene", "syphon", "blackmagic"];
/** Kinds that need a choice (device, file, URL…) right after being added. */
const CONFIGURE_AFTER_ADD: SourceKind[] = KINDS.filter((kind) => kind !== "scene" && kind !== "chatOverlay");

export function AddSourceDialog({
  open,
  scene,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  scene: string;
  onOpenChange: (open: boolean) => void;
  onAdded: (sourceName: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <AddSourceForm scene={scene} onClose={() => onOpenChange(false)} onAdded={onAdded} />}
    </Dialog>
  );
}

function AddSourceForm({ scene, onClose, onAdded }: { scene: string; onClose: () => void; onAdded: (name: string) => void }) {
  const t = useTranslations("sources");
  const tc = useTranslations("common");
  const te = useTranslations("errors.codes");
  const run = useAction();
  const available = useStudio((store) => store.snapshot?.availableSourceKinds);
  const kinds = KINDS.filter((entry) => available?.includes(entry));
  const [kind, setKind] = useState<SourceKind>("display");
  const selectedKind = kinds.includes(kind) ? kind : kinds[0];
  const [reuse, setReuse] = useState(false);
  const [choices, setChoices] = useState<SourceChoiceDTO[] | null>(null);
  const [existing, setExisting] = useState("");
  const [blocked, setBlocked] = useState<PermissionKind | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const filteredChoices = choices?.filter((choice) => reuse || choice.kind === "scene") ?? [];
  const needsChoice = reuse || selectedKind === "scene";
  const canSubmit = !pending && Boolean(selectedKind) && (!needsChoice || filteredChoices.some((choice) => choice.name === existing));

  useEffect(() => {
    let cancelled = false;
    void run(() => studio.listSourceChoices(scene)).then((result) => {
      if (!cancelled) setChoices(result ?? []);
    });
    return () => { cancelled = true; };
  }, [scene, run]);

  const submit = async () => {
    if (!canSubmit || !selectedKind) return;
    setPending(true);
    let created: string;
    try {
      created = needsChoice
        ? await studio.addExistingSource(scene, existing)
        : await studio.addSource(scene, selectedKind, name.trim() || t(`kinds.${selectedKind}`));
    } catch (error) {
      const code = errorCode(error);
      const permission = /^permission-(camera|microphone|screen)-denied$/u.exec(code)?.[1] as PermissionKind | undefined;
      if (permission) setBlocked(permission);
      else toast.error(te.has(code) ? te(code) : te("generic"));
      return;
    } finally {
      setPending(false);
    }
    onClose();
    if (!needsChoice && CONFIGURE_AFTER_ADD.includes(selectedKind)) onAdded(created);
  };

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("add")}</DialogTitle>
      </DialogHeader>
      <div className="flex gap-2">
        <Button variant={reuse ? "outline" : "secondary"} aria-pressed={!reuse} onClick={() => setReuse(false)}>{t("createNew")}</Button>
        <Button variant={reuse ? "secondary" : "outline"} aria-pressed={reuse} onClick={() => setReuse(true)}>{t("useExisting")}</Button>
      </div>
      {!reuse && <div className="grid max-h-[42vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-5" role="radiogroup" aria-label={t("type")}
        onKeyDown={(event) => {
          const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
          if (!offset || !selectedKind) return;
          event.preventDefault();
          const next = (kinds.indexOf(selectedKind) + offset + kinds.length) % kinds.length;
          setKind(kinds[next]);
          (event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next])?.focus();
        }}>
        {kinds.map((entry) => {
          const selected = entry === selectedKind;
          return (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setKind(entry)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border p-3 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                selected && "border-primary bg-accent",
              )}
            >
              <SourceIcon kind={entry} className="size-7" />
              <span className="text-center leading-tight">{t(`kinds.${entry}`)}</span>
            </button>
          );
        })}
      </div>}
      {needsChoice ? (
        <Field label={selectedKind === "scene" && !reuse ? t("kinds.scene") : t("useExisting")} htmlFor="existing-source">
          <Select value={existing || undefined} onValueChange={setExisting} disabled={choices === null || filteredChoices.length === 0}>
            <SelectTrigger id="existing-source"><SelectValue placeholder={choices === null ? tc("loading") : t("chooseSource")} /></SelectTrigger>
            <SelectContent>{filteredChoices.map((choice) => <SelectItem key={choice.name} value={choice.name}>{choice.name}</SelectItem>)}</SelectContent>
          </Select>
          {choices !== null && filteredChoices.length === 0 && <p className="text-sm text-muted-foreground">{t("noExisting")}</p>}
        </Field>
      ) : <Field label={tc("name")} htmlFor="source-name">
        <Input
          id="source-name"
          value={name}
          maxLength={60}
          placeholder={selectedKind ? t(`kinds.${selectedKind}`) : ""}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
      </Field>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button disabled={!canSubmit} onClick={() => void submit()}>
          {tc("add")}
        </Button>
      </DialogFooter>
      <PermissionDialog kind={blocked} onClose={() => setBlocked(null)} />
    </DialogContent>
  );
}
