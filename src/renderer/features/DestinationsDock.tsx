import { MoreHorizontalIcon, PencilIcon, PlayIcon, PlusIcon, RadioTowerIcon, SquareIcon, Trash2Icon, TypeIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { estimateUploadKbps, planEncoders, recommendedUploadKbps } from "../../shared/planner";
import type { DestinationConfig, DestinationStatus, OutputState, Platform } from "../../shared/types";
import { Dock, DockEmpty } from "@/components/Dock";
import { PlatformIcon } from "@/components/PlatformIcon";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/form";
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
import { BroadcastInfoDialog } from "./BroadcastInfoDialog";
import { DestinationDialog, type DestinationDialogState } from "./DestinationDialog";

const ACTIVE_STATES: OutputState[] = ["preparing", "connecting", "live", "reconnecting", "stopping"];

export function isActive(status: DestinationStatus | undefined): boolean {
  return Boolean(status && ACTIVE_STATES.includes(status.state));
}

const STATE_DOT: Record<OutputState, string> = {
  idle: "bg-muted-foreground/40",
  preparing: "bg-yellow-400",
  connecting: "bg-yellow-400 animate-pulse",
  live: "bg-live",
  reconnecting: "bg-orange-500 animate-pulse",
  stopping: "bg-muted-foreground",
  error: "bg-red-600",
};

export function DestinationsDock() {
  const t = useTranslations("destinations");
  const tc = useTranslations("common");
  const tRoot = useTranslations();
  const run = useAction();
  const destinations = useStudio((state) => state.snapshot?.destinations ?? []);
  const statuses = useStudio((state) => state.snapshot?.destinationStatus ?? []);
  const [dialog, setDialog] = useState<DestinationDialogState | null>(null);
  const [infoFor, setInfoFor] = useState<DestinationConfig | null>(null);
  const [removing, setRemoving] = useState<DestinationConfig | null>(null);

  const enabled = destinations.filter((destination) => destination.enabled);
  const encodes = planEncoders(enabled).groups.length;
  const uploadMbps = (recommendedUploadKbps(estimateUploadKbps(enabled)) / 1000).toFixed(1);

  const add = (platform: Platform) => setDialog({ mode: "create", platform });

  return (
    <Dock
      title={t("title")}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("add")}>
              <PlusIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => add("youtube")}>
              <PlatformIcon platform="youtube" className="size-4" />
              {t("platforms.youtube")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => add("twitch")}>
              <PlatformIcon platform="twitch" className="size-4" />
              {t("platforms.twitch")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {destinations.length === 0 ? (
        <DockEmpty
          icon={RadioTowerIcon}
          text={t("empty")}
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => add("youtube")}>
                <PlatformIcon platform="youtube" className="size-4" />
                {t("platforms.youtube")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => add("twitch")}>
                <PlatformIcon platform="twitch" className="size-4" />
                {t("platforms.twitch")}
              </Button>
            </div>
          }
        />
      ) : (
        <div className="flex min-h-full flex-col">
          <ul className="flex-1">
            {destinations.map((destination) => {
              const status = statuses.find((entry) => entry.id === destination.id);
              const active = isActive(status);
              const state = status?.state ?? "idle";
              return (
                <li key={destination.id} className="group flex items-center gap-2 border-b px-3 py-2 last:border-b-0" title={state === "error" && status?.errorKey && tRoot.has(status.errorKey) ? tRoot(status.errorKey, { name: destination.name }) : undefined}>
                  <PlatformIcon platform={destination.platform} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{destination.name}</p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[state])} aria-hidden />
                      <span className="truncate">
                        {state === "live"
                          ? t("liveStats", { kbps: status?.kbps ?? 0, dropped: status?.droppedFrames ?? 0 })
                          : state === "error" && status?.errorKey && tRoot.has(status.errorKey)
                            ? tRoot(status.errorKey, { name: destination.name })
                            : t(`states.${state}`)}
                      </span>
                    </p>
                  </div>
                  <Switch
                    checked={destination.enabled}
                    disabled={active}
                    aria-label={t("include", { name: destination.name })}
                    onCheckedChange={(checked) => void run(() => studio.setDestinationEnabled(destination.id, checked))}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={tc("more")}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {active ? (
                        <DropdownMenuItem onSelect={() => void run(() => studio.endStream([destination.id]))}>
                          <SquareIcon />
                          {t("endOne")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => void run(() => studio.goLive([destination.id]))}>
                          <PlayIcon />
                          {t("goLiveOne")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem disabled={destination.mode !== "account"} onSelect={() => setInfoFor(destination)}>
                        <TypeIcon />
                        {t("streamInfo")}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={active} onSelect={() => setDialog({ mode: "edit", platform: destination.platform, destination })}>
                        <PencilIcon />
                        {tc("edit")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={active} onSelect={() => setRemoving(destination)}>
                        <Trash2Icon />
                        {tc("remove")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
          {enabled.length > 0 && (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t("summary", { encodes, upload: uploadMbps })}</p>
          )}
        </div>
      )}

      <DestinationDialog state={dialog} onClose={() => setDialog(null)} />
      <BroadcastInfoDialog destination={infoFor} onClose={() => setInfoFor(null)} />
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        {removing !== null && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t("removeTitle", { name: removing.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t("removeDescription")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(() => studio.removeDestination(removing.id))}>{tc("remove")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Dock>
  );
}
