import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import type { NamedEntry } from "../../../shared/workspace";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";
import { SettingsCard } from "./parts";

type Naming = { kind: "create" } | { kind: "duplicate" | "rename"; entry: NamedEntry };

/**
 * Profiles: named sets of video, encoder and recording settings (and each
 * destination's video settings). Switching is locked while live; unsaved
 * edits on the settings page are discarded by a switch, so it is disabled then.
 */
export function ProfileCard({ locked, dirty }: { locked: boolean; dirty: boolean }) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const run = useAction();
  const profiles = useStudio((state) => state.snapshot?.workspace.profiles);
  const switching = useStudio((state) => state.snapshot?.workspace.switching ?? false);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [removing, setRemoving] = useState<NamedEntry | null>(null);

  if (!profiles) return null;
  const nameOf = (entry: NamedEntry) => entry.name || t("profileUntitled");
  const active = profiles.items.find((entry) => entry.id === profiles.activeId) ?? profiles.items[0];
  const busy = switching || locked;

  return (
    <SettingsCard title={t("profile")}>
      <div className="flex items-center gap-2">
        <Select disabled={busy || dirty} value={profiles.activeId} onValueChange={(id) => void run(() => studio.switchProfile(id))}>
          <SelectTrigger aria-label={t("profile")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {profiles.items.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {nameOf(entry)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <NativeMenu
          items={[
            { label: t("newProfile"), disabled: busy || dirty, onSelect: () => setNaming({ kind: "create" }) },
            ...(active
              ? [
                  { label: t("duplicate"), disabled: switching, onSelect: () => setNaming({ kind: "duplicate", entry: active }) },
                  { label: t("rename"), disabled: switching, onSelect: () => setNaming({ kind: "rename", entry: active }) },
                  "separator" as const,
                  { label: t("remove"), disabled: busy || dirty || profiles.items.length <= 1, onSelect: () => setRemoving(active) },
                ]
              : []),
          ]}
        >
          <Button variant="outline" size="icon" aria-label={t("profileActions")} title={t("profileActions")}>
            <MoreHorizontalIcon />
          </Button>
        </NativeMenu>
      </div>
      <p className="text-xs text-muted-foreground">{locked ? t("profileLocked") : t("profileHint")}</p>

      <NameDialog
        open={naming !== null}
        title={naming?.kind === "create" ? t("newProfileTitle") : naming?.kind === "duplicate" ? t("duplicateProfileTitle") : t("renameProfileTitle")}
        initial={naming?.kind === "create" ? t("defaultProfileName") : naming?.kind === "duplicate" ? t("copyName", { name: nameOf(naming.entry) }) : naming ? naming.entry.name : ""}
        onOpenChange={(open) => !open && setNaming(null)}
        onSubmit={(name) => {
          if (!naming) return Promise.resolve();
          if (naming.kind === "create") return run(() => studio.createProfile(name));
          if (naming.kind === "duplicate") return run(() => studio.duplicateProfile(naming.entry.id, name));
          return run(() => studio.renameProfile(naming.entry.id, name));
        }}
      />
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        {removing && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("removeProfileTitle", { name: nameOf(removing) })}</AlertDialogTitle>
              <AlertDialogDescription>{t("removeProfileDescription")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(() => studio.removeProfile(removing.id))}>{tc("remove")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </SettingsCard>
  );
}
