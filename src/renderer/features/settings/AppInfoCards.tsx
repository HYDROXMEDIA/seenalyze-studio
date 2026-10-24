import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { AppInfo, AppLink } from "../../../shared/types";
import { Button } from "@/components/ui/button";
import { errorCode, studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { SettingRow, SettingsCard } from "./parts";

/** Settings › Privacy & diagnostics: where the app's logs are kept. */
export function DiagnosticsCard() {
  const t = useTranslations("settings");
  const td = useTranslations("settings.diagnosticsCard");
  const run = useAction();
  return (
    <SettingsCard title={t("diagnostics")}>
      <SettingRow title={td("logsTitle")} detail={td("logsDetail")}>
        <Button variant="outline" size="sm" onClick={() => void run(() => studio.openLogsFolder())}>
          {td("openLogs")}
        </Button>
      </SettingRow>
    </SettingsCard>
  );
}

const LINKS = ["privacy", "terms", "source"] as const satisfies readonly AppLink[];

type Info = { status: "loading" } | { status: "failed" } | { status: "ready"; info: AppInfo };

/** Settings › About: the version and the app's public pages. */
export function AboutCard() {
  const t = useTranslations("settings");
  const ta = useTranslations("settings.aboutCard");
  const tc = useTranslations("common");
  const run = useAction();
  const [load, setLoad] = useState<Info>({ status: "loading" });

  const fetchInfo = useCallback(
    () =>
      studio.getAppInfo().then(
        (info): Info => ({ status: "ready", info }),
        (error: unknown): Info => {
          console.error("[about] app version could not be read", errorCode(error));
          return { status: "failed" };
        },
      ),
    [],
  );
  useEffect(() => {
    let current = true;
    void fetchInfo().then((next) => {
      if (current) setLoad(next);
    });
    return () => {
      current = false;
    };
  }, [fetchInfo]);
  const retry = () => {
    setLoad({ status: "loading" });
    void fetchInfo().then(setLoad);
  };

  return (
    <SettingsCard title={t("about")}>
      <SettingRow title={ta("version")} detail={load.status === "failed" ? ta("loadFailed") : undefined}>
        {load.status === "loading" && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label={tc("loading")} />}
        {load.status === "ready" && <span className="text-sm text-muted-foreground">{load.info.version}</span>}
        {load.status === "failed" && (
          <Button variant="outline" size="sm" onClick={retry}>
            {tc("retry")}
          </Button>
        )}
      </SettingRow>
      {LINKS.map((link) => (
        <SettingRow key={link} title={ta(`links.${link}`)}>
          <Button variant="outline" size="sm" onClick={() => void run(() => studio.openAppLink(link))}>
            <ExternalLinkIcon />
            {ta("open")}
          </Button>
        </SettingRow>
      ))}
    </SettingsCard>
  );
}
