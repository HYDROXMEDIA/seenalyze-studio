import { Columns2Icon, ProjectorIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/overlays";
import { Tooltip } from "@/components/ui/tooltip";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { COMPACT_HEADER_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { useStudio } from "@/store/studio";
import type { ProjectorTarget } from "../../../shared/types";
import { useProjectorMenu } from "./use-projector-menu";

/** Header controls: the studio mode switch and the projector menu. */
export function StudioModeControls() {
  const t = useTranslations("header");
  const tp = useTranslations("projector");
  const tt = useTranslations("tooltips");
  const run = useAction();
  const enabled = useStudio((state) => state.snapshot?.studioMode?.enabled ?? false);
  const projectorMenu = useProjectorMenu();
  const compact = useMediaQuery(COMPACT_HEADER_QUERY);

  const targets: { target: ProjectorTarget; name: string }[] = [
    { target: { kind: "program" }, name: tp("program") },
    ...(enabled ? [{ target: { kind: "preview" } as ProjectorTarget, name: tp("preview") }] : []),
    { target: { kind: "multiview" }, name: tp("multiview") },
  ];
  const items: ActionMenuItem[] = targets.flatMap(({ target, name }, index) => [
    ...(index > 0 ? ["separator" as const] : []),
    ...projectorMenu(target, (kind, screen) =>
      kind === "window" ? tp("inWindow", { target: name }) : screen ? tp("onNamedScreen", { target: name, screen }) : tp("onScreen", { target: name }),
    ),
  ]);

  const toggle = (
    <Button
      variant={enabled ? "secondary" : "ghost"}
      size="sm"
      className="app-no-drag"
      aria-pressed={enabled}
      onClick={() => void run(() => studio.setStudioMode(!enabled))}
    >
      <Columns2Icon aria-hidden className="size-4" />
      <span className="max-[1100px]:sr-only">{t("studioMode")}</span>
    </Button>
  );

  return (
    <>
      {compact ? <Tooltip label={t("studioMode")}>{toggle}</Tooltip> : toggle}
      <ActionMenu items={items}>
        <Tooltip label={tt("projectors")}>
          <Button variant="ghost" size="icon-sm" className="app-no-drag" aria-label={t("projectors")}>
            <ProjectorIcon />
          </Button>
        </Tooltip>
      </ActionMenu>
    </>
  );
}
