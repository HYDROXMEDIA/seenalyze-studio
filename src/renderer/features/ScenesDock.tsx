import { ClapperboardIcon, MoreHorizontalIcon, PlusIcon, WandSparklesIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
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
  NativeMenu,
} from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";
import { TransitionsDialog } from "./TransitionsDialog";
import { CollectionsMenu } from "./CollectionsMenu";
import { useProjectorMenu } from "./projector/use-projector-menu";
import { DEFAULT_TRANSITION } from "../../shared/transitions";

export function ScenesDock() {
  const t = useTranslations("scenes");
  const tc = useTranslations("common");
  const run = useAction();
  const scenes = useStudio((state) => state.snapshot?.scenes ?? []);
  const active = useStudio((state) => state.snapshot?.activeScene);
  /** In studio mode the highlighted scene is the preview; this one is on the program. */
  const programScene = useStudio((state) => (state.snapshot?.studioMode?.enabled ? state.snapshot.studioMode.programScene : null));
  const projectorMenu = useProjectorMenu();
  const selectItem = useStudio((state) => state.selectItem);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  /** Scene whose own transition the dialog opens on; null opens the default transition. */
  const [pickingScene, setPickingScene] = useState<string | null>(null);
  const transition = useStudio((state) => state.snapshot?.transition ?? DEFAULT_TRANSITION);
  const tt = useTranslations("transitions");
  const transitionLabel = tt("open", { name: tt(`presets.${transition.id}`) });

  return (
    <Dock
      title={t("title")}
      actions={
        <>
          <CollectionsMenu />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={transitionLabel}
            title={transitionLabel}
            onClick={() => {
              setPickingScene(null);
              setPicking(true);
            }}
          >
            <WandSparklesIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("add")} onClick={() => setCreating(true)}>
            <PlusIcon />
          </Button>
        </>
      }
    >
      {scenes.length === 0 ? (
        <DockEmpty icon={ClapperboardIcon} text={t("empty")} />
      ) : (
        scenes.map((scene, index) => (
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
            {scene.name === programScene && (
              <span role="img" aria-label={t("onProgram")} title={t("onProgram")} className="size-2 shrink-0 rounded-full bg-live" />
            )}
            <NativeMenu
              items={[
                { label: tc("rename"), onSelect: () => setRenaming(scene.name) },
                { label: t("duplicate"), onSelect: () => void run(() => studio.duplicateScene(scene.name)) },
                {
                  label: t("transitionInto"),
                  onSelect: () => {
                    setPickingScene(scene.name);
                    setPicking(true);
                  },
                },
                "separator",
                { label: t("moveUp"), disabled: index === 0, onSelect: () => void run(() => studio.moveScene(scene.name, "up")) },
                { label: t("moveDown"), disabled: index === scenes.length - 1, onSelect: () => void run(() => studio.moveScene(scene.name, "down")) },
                "separator",
                ...projectorMenu({ kind: "scene", name: scene.name }),
                "separator",
                { label: tc("remove"), disabled: scenes.length <= 1, onSelect: () => setRemoving(scene.name) },
              ]}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={tc("more")}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontalIcon />
              </Button>
            </NativeMenu>
          </ListRow>
        ))
      )}

      <TransitionsDialog
        open={picking}
        scene={pickingScene}
        onOpenChange={(open) => {
          setPicking(open);
          if (!open) setPickingScene(null);
        }}
      />
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
