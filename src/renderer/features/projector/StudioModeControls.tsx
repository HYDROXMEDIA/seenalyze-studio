import { Columns2Icon, ProjectorIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { NativeMenu, type NativeMenuItem } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";
import type { ProjectorTarget } from "../../../shared/types";
import { useProjectorMenu } from "./use-projector-menu";

/** Header controls: the studio mode switch and the projector menu. */
export function StudioModeControls() {
  const t = useTranslations("header");
  const tp = useTranslations("projector");
  const run = useAction();
  const enabled = useStudio((state) => state.snapshot?.studioMode?.enabled ?? false);
  const projectorMenu = useProjectorMenu();

  const targets: { target: ProjectorTarget; name: string }[] = [
    { target: { kind: "program" }, name: tp("program") },
    ...(enabled ? [{ target: { kind: "preview" } as ProjectorTarget, name: tp("preview") }] : []),
    { target: { kind: "multiview" }, name: tp("multiview") },
  ];
  const items: NativeMenuItem[] = targets.flatMap(({ target, name }, index) => [
    ...(index > 0 ? ["separator" as const] : []),
    ...projectorMenu(target, (kind, screen) =>
      kind === "window" ? tp("inWindow", { target: name }) : screen ? tp("onNamedScreen", { target: name, screen }) : tp("onScreen", { target: name }),
    ),
  ]);

  return (
    <>
      <Button
        variant={enabled ? "secondary" : "ghost"}
        size="sm"
        className="app-no-drag"
        aria-pressed={enabled}
        onClick={() => void run(() => studio.setStudioMode(!enabled))}
      >
        <Columns2Icon aria-hidden className="size-4" />
        {t("studioMode")}
      </Button>
      <NativeMenu items={items}>
        <Button variant="ghost" size="icon-sm" className="app-no-drag" aria-label={t("projectors")} title={t("projectors")}>
          <ProjectorIcon />
        </Button>
      </NativeMenu>
    </>
  );
}
