import {
  AppWindowIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CameraIcon,
  EyeIcon,
  EyeOffIcon,
  FilmIcon,
  GlobeIcon,
  ImageIcon,
  LockIcon,
  LayersIcon,
  MaximizeIcon,
  MessagesSquareIcon,
  MicIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  ScanIcon,
  Settings2Icon,
  Trash2Icon,
  TypeIcon,
  UndoIcon,
  UnlockIcon,
  Volume2Icon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import type { SceneItemDTO, SourceKind } from "../../shared/types";
import videoIcon from "@/assets/icons/video_post.png";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";
import { AddSourceDialog } from "./AddSourceDialog";
import { SourcePropertiesDialog } from "./SourcePropertiesDialog";

export const SOURCE_ICONS: Record<SourceKind | "other", LucideIcon> = {
  display: MonitorIcon,
  window: AppWindowIcon,
  camera: CameraIcon,
  microphone: MicIcon,
  desktopAudio: Volume2Icon,
  image: ImageIcon,
  media: FilmIcon,
  text: TypeIcon,
  color: PaletteIcon,
  browser: GlobeIcon,
  chatOverlay: MessagesSquareIcon,
  overlay: LayersIcon,
  other: ScanIcon,
};

export function SourcesDock() {
  const t = useTranslations("sources");
  const tc = useTranslations("common");
  const run = useAction();
  const scene = useStudio((state) => state.snapshot?.scenes.find((entry) => entry.name === state.snapshot?.activeScene));
  const selectedItemId = useStudio((state) => state.selectedItemId);
  const selectItem = useStudio((state) => state.selectItem);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SceneItemDTO | null>(null);

  if (!scene) return <Dock title={t("title")}>{null}</Dock>;

  return (
    <Dock
      title={t("title")}
      actions={
        <Button variant="ghost" size="icon-sm" aria-label={t("add")} onClick={() => setAdding(true)}>
          <PlusIcon />
        </Button>
      }
    >
      {scene.items.length === 0 ? (
        <DockEmpty
          icon={videoIcon}
          text={t("empty")}
          action={
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon />
              {t("add")}
            </Button>
          }
        />
      ) : (
        scene.items.map((item, index) => {
          const Icon = SOURCE_ICONS[item.kind];
          return (
            <ListRow key={item.id} active={item.id === selectedItemId} onClick={() => selectItem(item.id)}>
              <Icon className={cn("size-4 shrink-0 text-muted-foreground", !item.visible && "opacity-40")} />
              <span className={cn("min-w-0 flex-1 truncate", !item.visible && "text-muted-foreground")}>{item.sourceName}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={item.locked ? t("unlock") : t("lock")}
                aria-pressed={item.locked}
                className={cn(!item.locked && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                onClick={(event) => {
                  event.stopPropagation();
                  void run(() => studio.setItemLocked(scene.name, item.id, !item.locked));
                }}
              >
                {item.locked ? <LockIcon /> : <UnlockIcon />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={item.visible ? t("hide") : t("show")}
                aria-pressed={!item.visible}
                onClick={(event) => {
                  event.stopPropagation();
                  void run(() => studio.setItemVisible(scene.name, item.id, !item.visible));
                }}
              >
                {item.visible ? <EyeIcon /> : <EyeOffIcon className="text-muted-foreground" />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={tc("more")} onClick={(event) => event.stopPropagation()}>
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                  <DropdownMenuItem onSelect={() => setEditing(item.sourceName)}>
                    <Settings2Icon />
                    {t("properties")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setRenaming(item.sourceName)}>
                    <PencilIcon />
                    {tc("rename")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={item.locked} onSelect={() => void run(() => studio.applyTransform(scene.name, item.id, "fit"))}>
                    <ScanIcon />
                    {t("fit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={item.locked} onSelect={() => void run(() => studio.applyTransform(scene.name, item.id, "stretch"))}>
                    <MaximizeIcon />
                    {t("stretch")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={item.locked} onSelect={() => void run(() => studio.applyTransform(scene.name, item.id, "center"))}>
                    <ScanIcon />
                    {t("center")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={item.locked} onSelect={() => void run(() => studio.applyTransform(scene.name, item.id, "reset"))}>
                    <UndoIcon />
                    {t("resetTransform")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={index === 0} onSelect={() => void run(() => studio.moveSceneItem(scene.name, item.id, "up"))}>
                    <ArrowUpIcon />
                    {t("moveUp")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === scene.items.length - 1}
                    onSelect={() => void run(() => studio.moveSceneItem(scene.name, item.id, "down"))}
                  >
                    <ArrowDownIcon />
                    {t("moveDown")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" disabled={item.locked} onSelect={() => setRemoving(item)}>
                    <Trash2Icon />
                    {tc("remove")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ListRow>
          );
        })
      )}

      <AddSourceDialog open={adding} scene={scene.name} onOpenChange={setAdding} onAdded={(name) => setEditing(name)} />
      <SourcePropertiesDialog source={editing} onClose={() => setEditing(null)} />
      <NameDialog
        open={renaming !== null}
        title={tc("rename")}
        initial={renaming ?? ""}
        onOpenChange={(open) => !open && setRenaming(null)}
        onSubmit={(name) => (renaming ? run(() => studio.renameSource(renaming, name)) : Promise.resolve())}
      />
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        {removing !== null && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("removeTitle", { name: removing.sourceName })}</AlertDialogTitle>
              <AlertDialogDescription>{t("removeDescription")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (selectedItemId === removing.id) selectItem(null);
                  void run(() => studio.removeSceneItem(scene.name, removing.id));
                }}
              >
                {tc("remove")}
              </AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Dock>
  );
}
