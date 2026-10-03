import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { PermissionKind, SourceKind } from "../../shared/types";
import { PermissionDialog } from "@/components/PermissionDialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { errorCode, studio } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { SOURCE_ICONS } from "./SourcesDock";

const KINDS: SourceKind[] = ["display", "window", "camera", "microphone", "desktopAudio", "image", "media", "text", "color", "browser", "chatOverlay"];
/** Kinds that need a choice (device, file, URL…) right after being added. */
const CONFIGURE_AFTER_ADD: SourceKind[] = ["display", "window", "camera", "microphone", "image", "media", "text", "browser"];

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
  const [kind, setKind] = useState<SourceKind>("display");
  const [blocked, setBlocked] = useState<PermissionKind | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    let created: string;
    try {
      created = await studio.addSource(scene, kind, name.trim() || t(`kinds.${kind}`));
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
    if (CONFIGURE_AFTER_ADD.includes(kind)) onAdded(created);
  };

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("add")}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={t("type")}>
        {KINDS.map((entry) => {
          const Icon = SOURCE_ICONS[entry];
          const selected = entry === kind;
          return (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setKind(entry)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border p-3 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                selected && "border-primary bg-accent",
              )}
            >
              <Icon className="size-5" />
              <span className="text-center leading-tight">{t(`kinds.${entry}`)}</span>
            </button>
          );
        })}
      </div>
      <Field label={tc("name")} htmlFor="source-name">
        <Input
          id="source-name"
          value={name}
          maxLength={60}
          placeholder={t(`kinds.${kind}`)}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button disabled={pending} onClick={() => void submit()}>
          {tc("add")}
        </Button>
      </DialogFooter>
      <PermissionDialog kind={blocked} onClose={() => setBlocked(null)} />
    </DialogContent>
  );
}
