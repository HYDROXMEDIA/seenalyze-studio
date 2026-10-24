// The required SEENALYZE sign-in. The studio (and everything inside it: Settings, Overlays, the first-run
// setup) opens only for a confirmed account. Until the first lookup answers only a spinner shows, so
// neither the sign-in screen nor the studio flashes up and disappears again.
import { CircleAlertIcon, Loader2Icon, MessagesSquareIcon, RadioTowerIcon, SparklesIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import appIcon from "@/assets/icons/seenalyze-app-icon.svg";
import { SwapLabel } from "@/components/SwapLabel";
import { Button } from "@/components/ui/button";
import { LanguageSelect } from "@/features/SettingsPage";
import { accountGateView } from "@/lib/account-gate";
import { errorCode } from "@/lib/studio";
import { useMediaQuery } from "@/lib/use-media-query";
import {
  cancelSeenalyzeSignIn,
  ensureSeenalyzeAccountLoaded,
  loadSeenalyzeAccount,
  signInSeenalyze,
  useSeenalyzeAccountState,
} from "@/lib/use-seenalyze-account";
import { DotGridBackdrop } from "./DotGridBackdrop";

export function SignInGate({ children }: { children: ReactNode }) {
  const t = useTranslations("signIn");
  const tc = useTranslations("common");
  const { state } = useSeenalyzeAccountState();
  useEffect(() => ensureSeenalyzeAccountLoaded(), []);

  const view = accountGateView(state);
  if (view === "open") return children;
  if (view === "signed-out") return <SignInScreen />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Keeps the window draggable (and clear of the macOS window buttons) before the account is known. */}
      <div className="app-drag app-titlebar shrink-0" aria-hidden />
      {view === "loading" ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="size-6 animate-spin rounded-full border-2 border-muted border-t-foreground" role="status" aria-label={tc("loading")} />
        </div>
      ) : (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <CircleAlertIcon aria-hidden className="size-12 text-muted-foreground" strokeWidth={1.5} />
          <p className="max-w-md text-sm text-muted-foreground">{t("checkFailed")}</p>
          <Button onClick={loadSeenalyzeAccount}>{tc("retry")}</Button>
        </div>
      )}
    </div>
  );
}

const FEATURES: readonly (readonly [LucideIcon, "multistream" | "chat" | "overlays"])[] = [
  [RadioTowerIcon, "multistream"],
  [MessagesSquareIcon, "chat"],
  [SparklesIcon, "overlays"],
];

function SignInScreen() {
  const t = useTranslations("signIn");
  const tc = useTranslations("common");
  const te = useTranslations("errors.codes");
  const th = useTranslations("header");
  const { signingIn } = useSeenalyzeAccountState();
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  /** Error code of the last attempt, translated when shown so a language change applies to it. */
  const [failure, setFailure] = useState<string | null>(null);

  const start = async () => {
    setFailure(null);
    try {
      await signInSeenalyze();
    } catch (error) {
      const code = errorCode(error);
      console.error("[sign-in] SEENALYZE sign-in failed", code);
      // The user's own cancel needs no message.
      if (code !== "sign-in-cancelled") setFailure(code);
    }
  };

  const cancel = () => {
    cancelSeenalyzeSignIn().catch((error: unknown) => {
      console.error("[sign-in] SEENALYZE sign-in could not be cancelled", error);
      setFailure("generic");
    });
  };

  const label = signingIn ? t("openBrowserAgain") : t("continue");

  return (
    <div className="signin-gate">
      <DotGridBackdrop animate={!reduceMotion} />
      <div className="signin-scroll">
        <header className="signin-bar app-drag">
          <div className="signin-brand">
            <img src={appIcon} alt="" className="size-8 shrink-0 rounded-lg" draggable={false} />
            <span>{th("appName")}</span>
          </div>
          <LanguageSelect className="app-no-drag w-auto min-w-36" />
        </header>
        <main className="signin-main">
          <h1 className="signin-headline">
            <span className="signin-line">
              <span style={{ "--line-index": 0 } as CSSProperties}>{t("headline.first")}</span>
            </span>
            <span className="signin-line">
              <span className="signin-accent" style={{ "--line-index": 1 } as CSSProperties}>
                {t("headline.second")}
              </span>
            </span>
          </h1>
          <ul className="signin-features">
            {FEATURES.map(([Icon, key]) => (
              <li key={key} className="signin-feature">
                <Icon aria-hidden className="size-4" />
                <span>{t(`features.${key}`)}</span>
              </li>
            ))}
          </ul>
          <form
            className="signin-actions"
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
          >
            {failure !== null && (
              <p role="alert" className="signin-error select-text">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{te.has(failure) ? te(failure) : te("generic")}</span>
              </p>
            )}
            <button type="submit" className="signin-cta">
              <SwapLabel key={label} text={label} />
            </button>
            {signingIn && (
              <>
                <p role="status" className="signin-waiting">
                  <Loader2Icon aria-hidden className="size-4 animate-spin" />
                  <span>{t("waiting")}</span>
                </p>
                <Button type="button" variant="ghost" size="sm" className="self-center" onClick={cancel}>
                  {tc("cancel")}
                </Button>
              </>
            )}
          </form>
        </main>
        <footer className="signin-footer">
          <span>{t("footer.studio")}</span>
          <span>{t("footer.privacy")}</span>
        </footer>
      </div>
    </div>
  );
}
