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
import { useEffect, useState } from "react";
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
  ActionMenu,
  type ActionMenuItem,
} from "@/components/ui/overlays";
import { Tooltip } from "@/components/ui/tooltip";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useReorder } from "@/lib/use-reorder";
import { cn } from "@/lib/utils";
import { useClipboard } from "@/store/clipboard";
import { useStudio } from "@/store/studio";
import { AddSourceDialog } from "./AddSourceDialog";
import { EffectsDialog } from "./EffectsDialog";
import { PICTURELESS_KINDS, SourcePropertiesDialog } from "./SourcePropertiesDialog";
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
  const tt = useTranslations("tooltips");
  const run = useAction();
  const scene = useStudio((state) => state.snapshot?.scenes.find((entry) => entry.name === state.snapshot?.activeScene));
  const selectedItemId = useStudio((state) => state.selectedItemId);
  const selectItem = useStudio((state) => state.selectItem);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Keeps the item's scene: item ids are per scene, and the active scene can change
  // (hotkey, projector menu) while the confirmation is open.
  const [removing, setRemoving] = useState<{ scene: string; item: SceneItemDTO } | null>(null);
  const [transforming, setTransforming] = useState<{ scene: string; itemId: number } | null>(null);
  const [effectsOf, setEffectsOf] = useState<string | null>(null);
  const clipboard = useClipboard();
  const projectorMenu = useProjectorMenu();
  const sourceMenu = useStudio((state) => state.sourceMenu);
  const setSourceMenu = useStudio((state) => state.setSourceMenu);
  // Top of the list is drawn on top in the preview, recordings and streams.
  const reorder = useReorder(scene?.name ?? "", scene?.items ?? [], (item) => item.id, (item, index) =>
    scene ? run(() => studio.reorderSceneItem(scene.name, item.id, index)) : Promise.resolve(),
  );

  // Delete (Backspace on Mac keyboards) asks to remove the selected source, like OBS.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']"))) return;
      const { view, overlays, poppers, snapshot, selectedItemId: selected } = useStudio.getState();
      if (view !== "studio" || overlays > 0 || poppers > 0 || selected === null) return;
      const active = snapshot?.scenes.find((entry) => entry.name === snapshot.activeScene);
      const item = active?.items.find((entry) => entry.id === selected);
      if (!active || !item || item.locked) return;
      event.preventDefault();
      setRemoving({ scene: active.name, item });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!scene) return <Dock title={t("title")}>{null}</Dock>;

  /**
   * The menu for one source; only what applies to its kind is listed (audio has
   * no layout or effects, a nested scene has no effects of its own). `full`
   * adds visibility and lock, which the list rows show as buttons.
   */
  const menuFor = (item: SceneItemDTO, index: number, full = false): ActionMenuItem[] => {
    const pictureless = PICTURELESS_KINDS.has(item.kind);
    const effectless = pictureless || item.kind === "scene";
    const entries: (ActionMenuItem | false)[] = [
      ...(full
        ? [
            { label: item.visible ? t("hide") : t("show"), onSelect: () => void run(() => studio.setItemVisible(scene.name, item.id, !item.visible)) },
            { label: item.locked ? t("unlock") : t("lock"), onSelect: () => void run(() => studio.setItemLocked(scene.name, item.id, !item.locked)) },
            "separator" as const,
          ]
        : []),
      item.kind !== "scene" && { label: t("properties"), onSelect: () => setEditing(item.sourceName) },
      !effectless && { label: t("effects"), onSelect: () => setEffectsOf(item.sourceName) },
      { label: tc("rename"), onSelect: () => setRenaming(item.sourceName) },
      {
        label: t("duplicate"),
        onSelect: () =>
          void run(() => studio.duplicateSceneItem(scene.name, item.id)).then((copy) => {
            // The copy's id belongs to its scene; another scene may be active by now.
            if (copy && useStudio.getState().snapshot?.activeScene === scene.name) selectItem(copy.itemId);
          }),
      },
      ...(pictureless
        ? []
        : [
            "separator" as const,
            { label: t("editTransform"), disabled: item.locked, onSelect: () => setTransforming({ scene: scene.name, itemId: item.id }) },
            { label: t("fit"), disabled: item.locked, onSelect: () => void run(() => studio.applyTransform(scene.name, item.id, "fit")) },
            { label: t("stretch"), disabled: item.locked, onSelect: () => void run(() => studio.applyTransform(scene.name, item.id, "stretch")) },
            { label: t("center"), disabled: item.locked, onSelect: () => void run(() => studio.applyTransform(scene.name, item.id, "center")) },
            { label: t("resetTransform"), disabled: item.locked, onSelect: () => void run(() => studio.applyTransform(scene.name, item.id, "reset")) },
            "separator" as const,
            {
              label: t("copyTransform"),
              onSelect: () =>
                void run(() => studio.getItemPlacement(scene.name, item.id)).then((placement) => {
                  if (placement) clipboard.copyPlacement(placement);
                }),
            },
            {
              label: t("pasteTransform"),
              disabled: item.locked || !clipboard.placement,
              onSelect: () => {
                const placement = clipboard.placement;
                if (placement) void run(() => studio.setItemPlacement(scene.name, item.id, placement));
              },
            },
          ]),
      ...(effectless
        ? []
        : [
            {
              label: t("copyEffects"),
              onSelect: () =>
                void run(() => studio.copyEffects(item.sourceName)).then((effects) => {
                  if (effects) clipboard.copyEffects(effects);
                }),
            },
            {
              label: t("pasteEffects"),
              disabled: !clipboard.effects?.length,
              onSelect: () => {
                const effects = clipboard.effects;
                if (effects?.length) void run(() => studio.pasteEffects(item.sourceName, effects));
              },
            },
          ]),
      "separator",
      { label: t("moveUp"), disabled: index === 0, onSelect: () => void run(() => studio.moveSceneItem(scene.name, item.id, "up")) },
      { label: t("moveDown"), disabled: index === scene.items.length - 1, onSelect: () => void run(() => studio.moveSceneItem(scene.name, item.id, "down")) },
      "separator",
      ...(pictureless ? [] : [...projectorMenu(item.kind === "scene" ? { kind: "scene", name: item.sourceName } : { kind: "source", name: item.sourceName }), "separator" as const]),
      { label: tc("remove"), disabled: item.locked, onSelect: () => setRemoving({ scene: scene.name, item }) },
    ];
    return entries.filter((entry): entry is ActionMenuItem => entry !== false);
  };
  const contextIndex = sourceMenu ? scene.items.findIndex((item) => item.id === sourceMenu.itemId) : -1;
  const contextItem = contextIndex >= 0 ? scene.items[contextIndex] : null;

  return (
    <Dock
      title={t("title")}
      actions={
        <Tooltip label={t("add")}>
          <Button variant="ghost" size="icon-sm" aria-label={t("add")} onClick={() => setAdding(true)}>
            <PlusIcon />
          </Button>
        </Tooltip>
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
          {reorder.items.map((item, index) => {
            return (
              <ListRow key={item.id} {...reorder.rowProps(item, index)} active={item.id === selectedItemId} onClick={() => selectItem(item.id)}
                onDoubleClick={(event) => {
                  // Double-clicking the row's own buttons (lock, visibility, menu) must not open the editor.
                  if ((event.target as HTMLElement).closest("button")) return;
                  setEditing(item.sourceName);
                }}
              >
                <SourceIcon kind={item.kind} className={cn("size-4 shrink-0 text-muted-foreground", !item.visible && "opacity-40")} />
                <span className={cn("min-w-0 flex-1 truncate", !item.visible && "text-muted-foreground")}>{item.sourceName}</span>
                <Tooltip label={item.locked ? tt("unlock") : tt("lock")}>
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
                </Tooltip>
                <Tooltip label={item.visible ? tt("hide") : tt("show")}>
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
                </Tooltip>
                <ActionMenu
                  items={menuFor(item, index)}
                >
                  <Tooltip label={tc("more")}>
                    <Button variant="ghost" size="icon-sm" aria-label={tc("more")}>
                      <MoreHorizontalIcon />
                    </Button>
                  </Tooltip>
                </ActionMenu>
              </ListRow>
            );
          })}
        </div>
      )}

      {sourceMenu && contextItem && (
        <ActionMenu key={`${sourceMenu.itemId}:${sourceMenu.x}:${sourceMenu.y}`} open items={menuFor(contextItem, contextIndex, true)} onOpenChange={(open) => !open && setSourceMenu(null)}>
          <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: sourceMenu.x, top: sourceMenu.y }} />
        </ActionMenu>
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
        onSubmit={(name) => (renaming ? studio.renameSource(renaming, name) : Promise.resolve())}
      />
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        {removing !== null && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("removeTitle", { name: removing.item.sourceName })}</AlertDialogTitle>
              <AlertDialogDescription>{t("removeDescription")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const { scene: sceneName, item } = removing;
                  if (sceneName === scene.name && selectedItemId === item.id) selectItem(null);
                  void run(() => studio.removeSceneItem(sceneName, item.id));
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
