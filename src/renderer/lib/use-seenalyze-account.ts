import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { SeenalyzeAccount } from "../../shared/overlays";
import { errorCode, studio } from "./studio";

/**
 * The SEENALYZE account, with "could not be checked" kept apart from "signed out", so a failed lookup offers a
 * retry instead of looking like the user is not signed in.
 */
export type AccountState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; account: SeenalyzeAccount | null };

export function useSeenalyzeAccount() {
  const te = useTranslations("errors.codes");
  const [state, setState] = useState<AccountState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    studio
      .getSeenalyzeAccount()
      .then((account) => {
        if (!cancelled) setState({ status: "ready", account });
      })
      .catch((error: unknown) => {
        console.error("[seenalyze] account could not be checked", error);
        if (!cancelled) setState({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const showError = useCallback(
    (error: unknown) => {
      const code = errorCode(error);
      console.error("[seenalyze] account action failed", code);
      // The user's own cancel needs no message.
      if (code !== "sign-in-cancelled") toast.error(te.has(code) ? te(code) : te("generic"));
      if (code === "seenalyze-signed-out") setState({ status: "ready", account: null });
    },
    [te],
  );

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    try {
      setState({ status: "ready", account: await studio.signInSeenalyze() });
    } catch (error) {
      showError(error);
    } finally {
      setSigningIn(false);
    }
  }, [showError]);

  const cancelSignIn = useCallback(() => {
    studio.cancelSeenalyzeSignIn().catch((error: unknown) => console.error("[seenalyze] sign-in could not be cancelled", error));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await studio.signOutSeenalyze();
      setState({ status: "ready", account: null });
    } catch (error) {
      showError(error);
    }
  }, [showError]);

  return { state, retry, signIn, cancelSignIn, signingIn, signOut, showError };
}
