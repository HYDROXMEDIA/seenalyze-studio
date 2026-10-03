import { MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import studioIcon from "@/assets/icons/studio.png";
import { Dock, DockEmpty, ListRow } from "@/components/Dock";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";

export function ScenesDock() {
  const t = useTranslations("scenes");
  const tc = useTranslations("common");
  const run = useAction();
  const scenes = useStudio((state) => state.snapshot?.scenes ?? []);
  const active = useStudio((state) => state.snapshot?.activeScene);
  const selectItem = useStudio((state) => state.selectItem);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <Dock
      title={t("title")}
      actions={
        <Button variant="ghost" size="icon-sm" aria-label={t("add")} onClick={() => setCreating(true)}>
          <PlusIcon />
        </Button>
      }
    >
      {scenes.length === 0 ? (
        <DockEmpty icon={studioIcon} text={t("empty")} />
      ) : (
        scenes.map((scene) => (
          <ListRow
            key={scene.name}
            active={scene.name === active}
            onClick={() => {
              if (scene.name === active) return;
              selectItem(null);
              void run(() => studio.setActiveScene(scene.name));
            }}
          >
            <span className="min-w-0 flex-1 truncate">{scene.name}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tc("more")}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                <DropdownMenuItem onSelect={() => setRenaming(scene.name)}>
                  <PencilIcon />
                  {tc("rename")}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" disabled={scenes.length <= 1} onSelect={() => setRemoving(scene.name)}>
                  <Trash2Icon />
                  {tc("remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ListRow>
        ))
      )}

      <NameDialog
        open={creating}
        title={t("add")}
        initial={t("defaultName")}
        onOpenChange={setCreating}
        onSubmit={(name) => run(() => studio.createScene(name))}
      />
      <NameDialog
        open={renaming !== null}
        title={tc("rename")}
        initial={renaming ?? ""}
        onOpenChange={(open) => !open && setRenaming(null)}
        onSubmit={(name) => (renaming ? run(() => studio.renameScene(renaming, name)) : Promise.resolve())}
      />
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        {removing !== null && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("removeTitle", { name: removing })}</AlertDialogTitle>
              <AlertDialogDescription>{t("removeDescription")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(() => studio.removeScene(removing))}>{tc("remove")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Dock>
  );
}
