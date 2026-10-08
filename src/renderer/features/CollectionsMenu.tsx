import { LayersIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import type { NamedEntry } from "../../shared/workspace";
import { NameDialog } from "@/components/NameDialog";
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
  NativeMenu,
} from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";
import { ImportDialog } from "./ImportDialog";
import { isActive } from "./DestinationsDock";

type Naming = { kind: "create" } | { kind: "duplicate" | "rename"; entry: NamedEntry };

/** Scene collection switcher in the Scenes dock: switch, create, duplicate, rename, remove, import. */
export function CollectionsMenu() {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const run = useAction();
  const collections = useStudio((state) => state.snapshot?.workspace.collections);
  const switching = useStudio((state) => state.snapshot?.workspace.switching ?? false);
  const locked = useStudio((state) =>
    Boolean(state.snapshot && (state.snapshot.recording.active || state.snapshot.virtualCamera.active || state.snapshot.destinationStatus.some((status) => isActive(status)))),
  );
  const [naming, setNaming] = useState<Naming | null>(null);
  const [removing, setRemoving] = useState<NamedEntry | null>(null);
  const [importing, setImporting] = useState(false);

  if (!collections) return null;
  const nameOf = (entry: NamedEntry) => entry.name || t("untitled");
  const active = collections.items.find((entry) => entry.id === collections.activeId) ?? collections.items[0];
  const label = t("collectionButton", { name: active ? nameOf(active) : "" });
  const single = collections.items.length <= 1;

  return (
    <>
      <NativeMenu
        items={[
          ...collections.items.map((entry) => ({
            label: nameOf(entry),
            checked: entry.id === collections.activeId,
            disabled: switching || (locked && entry.id !== collections.activeId),
            onSelect: () => {
              if (entry.id !== collections.activeId) void run(() => studio.switchCollection(entry.id));
            },
          })),
          "separator" as const,
          { label: t("newCollection"), disabled: switching || locked, onSelect: () => setNaming({ kind: "create" }) },
          ...(active
            ? [
                { label: t("duplicate"), disabled: switching, onSelect: () => setNaming({ kind: "duplicate", entry: active }) },
                { label: t("rename"), disabled: switching, onSelect: () => setNaming({ kind: "rename", entry: active }) },
                { label: t("remove"), disabled: switching || single || locked, onSelect: () => setRemoving(active) },
              ]
            : []),
          "separator" as const,
          { label: t("importFrom"), disabled: switching, onSelect: () => setImporting(true) },
        ]}
      >
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={switching}>
          {switching ? <Loader2Icon className="animate-spin" /> : <LayersIcon />}
        </Button>
      </NativeMenu>

      <NameDialog
        open={naming !== null}
        title={naming?.kind === "create" ? t("newCollectionTitle") : naming?.kind === "duplicate" ? t("duplicateTitle") : t("renameTitle")}
        initial={naming?.kind === "create" ? t("defaultCollectionName") : naming?.kind === "duplicate" ? t("copyName", { name: nameOf(naming.entry) }) : naming ? naming.entry.name : ""}
        onOpenChange={(open) => !open && setNaming(null)}
        onSubmit={(name) => {
          if (!naming) return Promise.resolve();
          if (naming.kind === "create") return run(() => studio.createCollection(name));
          if (naming.kind === "duplicate") return run(() => studio.duplicateCollection(naming.entry.id, name));
          return run(() => studio.renameCollection(naming.entry.id, name));
        }}
      />
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        {removing && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("removeCollectionTitle", { name: nameOf(removing) })}</AlertDialogTitle>
              <AlertDialogDescription>{t("removeCollectionDescription")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(() => studio.removeCollection(removing.id))}>{tc("remove")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
      <ImportDialog open={importing} onOpenChange={setImporting} />
    </>
  );
}
