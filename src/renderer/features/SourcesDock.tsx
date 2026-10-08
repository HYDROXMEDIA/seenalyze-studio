import {
  AppWindowIcon,
  CameraIcon,
  ClapperboardIcon,
  EyeIcon,
  EyeOffIcon,
  FilmIcon,
  GlobeIcon,
  ImageIcon,
  LockIcon,
  LayersIcon,
  MessagesSquareIcon,
  MicIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  PaletteIcon,
  PlusIcon,
  ScanIcon,
  TypeIcon,
  UnlockIcon,
  Volume2Icon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import type { SceneItemDTO, SourceKind } from "../../shared/types";
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
import { cn } from "@/lib/utils";
import { useClipboard } from "@/store/clipboard";
import { useStudio } from "@/store/studio";
import { AddSourceDialog } from "./AddSourceDialog";
import { EffectsDialog } from "./EffectsDialog";
import { SourcePropertiesDialog } from "./SourcePropertiesDialog";
import { SourceTransformDialog } from "./SourceTransformDialog";
import { useProjectorMenu } from "./projector/use-projector-menu";

export const SOURCE_ICONS: Record<SourceKind | "other", LucideIcon> = {
  display: MonitorIcon,
  window: AppWindowIcon,
  application: AppWindowIcon,
  game: MonitorIcon,
  camera: CameraIcon,
  captureCard: CameraIcon,
  microphone: MicIcon,
  desktopAudio: Volume2Icon,
  applicationAudio: Volume2Icon,
  image: ImageIcon,
  slideshow: ImageIcon,
  media: FilmIcon,
  playlist: FilmIcon,
  scene: LayersIcon,
  syphon: AppWindowIcon,
  blackmagic: CameraIcon,
  text: TypeIcon,
  color: PaletteIcon,
  browser: GlobeIcon,
  chatOverlay: MessagesSquareIcon,
  overlay: LayersIcon,
  other: ScanIcon,
};

export function SourceIcon({ kind, className }: { kind: SourceKind | "other"; className?: string }) {
  const Icon = SOURCE_ICONS[kind];
  return <Icon className={className} aria-hidden />;
}

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
  const [transforming, setTransforming] = useState<{ scene: string; itemId: number } | null>(null);
  const [effectsOf, setEffectsOf] = useState<string | null>(null);
  const clipboard = useClipboard();
  const projectorMenu = useProjectorMenu();

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
          icon={ClapperboardIcon}
          text={t("empty")}
          action={
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon />
              {t("add")}
            </Button>
          }
        />
      ) : (
        // Keyed on the scene so switching scenes cross-fades the list.
        <div key={scene.name} className="animate-ui-fade">
          {scene.items.map((item, index) => {
            // Audio-only sources and nested scenes have no picture of their own to change.
            const pictureless = ["microphone", "desktopAudio", "applicationAudio"].includes(item.kind);
            const effectless = pictureless || item.kind === "scene";
            return (
              <ListRow key={item.id} active={item.id === selectedItemId} onClick={() => selectItem(item.id)}>
                <SourceIcon kind={item.kind} className={cn("size-4 shrink-0 text-muted-foreground", !item.visible && "opacity-40")} />
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
                <NativeMenu
                  items={[
                    { label: t("properties"), onSelect: () => setEditing(item.sourceName) },
                    { label: t("effects"), disabled: effectless, onSelect: () => setEffectsOf(item.sourceName) },
                    { label: tc("rename"), onSelect: () => setRenaming(item.sourceName) },
                    {
                      label: t("duplicate"),
                      onSelect: () =>
                        void run(() => studio.duplicateSceneItem(scene.name, item.id)).then((copy) => {
                          if (copy) selectItem(copy.itemId);
                        }),
                    },
                    "separator",
                    {
                      label: t("editTransform"),
                      disabled: item.locked || pictureless,
                      onSelect: () => setTransforming({ scene: scene.name, itemId: item.id }),
                    },
                    { label: t("fit"), disabled: item.locked, onSelect: () => void run(() => studio.applyTransform(scene.name, item.id, "fit")) },
                    { label: t("stretch"), disabled: item.locked, onSelect: () => void run(() => studio.applyTransform(scene.name, item.id, "stretch")) },
                    { label: t("center"), disabled: item.locked, onSelect: () => void run(() => studio.applyTransform(scene.name, item.id, "center")) },
                    { label: t("resetTransform"), disabled: item.locked, onSelect: () => void run(() => studio.applyTransform(scene.name, item.id, "reset")) },
                    "separator",
                    {
                      label: t("copyTransform"),
                      disabled: pictureless,
                      onSelect: () =>
                        void run(() => studio.getItemPlacement(scene.name, item.id)).then((placement) => {
                          if (placement) clipboard.copyPlacement(placement);
                        }),
                    },
                    {
                      label: t("pasteTransform"),
                      disabled: pictureless || item.locked || !clipboard.placement,
                      onSelect: () => {
                        const placement = clipboard.placement;
                        if (placement) void run(() => studio.setItemPlacement(scene.name, item.id, placement));
                      },
                    },
                    {
                      label: t("copyEffects"),
                      disabled: effectless,
                      onSelect: () =>
                        void run(() => studio.copyEffects(item.sourceName)).then((effects) => {
                          if (effects) clipboard.copyEffects(effects);
                        }),
                    },
                    {
                      label: t("pasteEffects"),
                      disabled: effectless || !clipboard.effects?.length,
                      onSelect: () => {
                        const effects = clipboard.effects;
                        if (effects?.length) void run(() => studio.pasteEffects(item.sourceName, effects));
                      },
                    },
                    "separator",
                    { label: t("moveUp"), disabled: index === 0, onSelect: () => void run(() => studio.moveSceneItem(scene.name, item.id, "up")) },
                    { label: t("moveDown"), disabled: index === scene.items.length - 1, onSelect: () => void run(() => studio.moveSceneItem(scene.name, item.id, "down")) },
                    "separator",
                    ...(pictureless ? [] : [...projectorMenu(item.kind === "scene" ? { kind: "scene", name: item.sourceName } : { kind: "source", name: item.sourceName }), "separator" as const]),
                    { label: tc("remove"), disabled: item.locked, onSelect: () => setRemoving(item) },
                  ]}
                >
                  <Button variant="ghost" size="icon-sm" aria-label={tc("more")}>
                    <MoreHorizontalIcon />
                  </Button>
                </NativeMenu>
              </ListRow>
            );
          })}
        </div>
      )}

      <AddSourceDialog open={adding} scene={scene.name} onOpenChange={setAdding} onAdded={(name) => setEditing(name)} />
      <SourcePropertiesDialog source={editing} onClose={() => setEditing(null)} />
      <EffectsDialog source={effectsOf} onClose={() => setEffectsOf(null)} />
      <SourceTransformDialog target={transforming} onClose={() => setTransforming(null)} />
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
