import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { create } from "zustand";
import type { SeenalyzeAccount } from "../../shared/overlays";
import type { AccountState } from "./account-gate";
import { errorCode, studio } from "./studio";

export type { AccountState } from "./account-gate";

interface AccountStore {
  state: AccountState;
  /** The browser sign-in is open and the app waits for it to come back. */
  signingIn: boolean;
}

/**
 * One account state for the whole window. The required sign-in screen, Settings and the overlay designer all
 * read it, so signing out (or a session that ends) anywhere returns the window to the sign-in screen.
 */
const useAccountStore = create<AccountStore>(() => ({ state: { status: "loading" }, signingIn: false }));

/** Bumped by every lookup, sign-in and sign-out, so an older answer never overwrites a newer one. */
let revision = 0;
let signInAttempt = 0;
let started = false;

function setAccount(account: SeenalyzeAccount | null): void {
  revision += 1;
  useAccountStore.setState({ state: { status: "ready", account } });
}

/** Looks the account up with the spinner showing: the first lookup, and Retry after a failed one. */
export function loadSeenalyzeAccount(): void {
  started = true;
  const current = ++revision;
  useAccountStore.setState({ state: { status: "loading" } });
  studio.getSeenalyzeAccount().then(
    (account) => {
      if (current === revision) useAccountStore.setState({ state: { status: "ready", account } });
    },
    (error: unknown) => {
      console.error("[seenalyze] account could not be checked", error);
      if (current === revision) useAccountStore.setState({ state: { status: "failed" } });
    },
  );
}

/** The window's first lookup; later calls keep the state that is already there. */
export function ensureSeenalyzeAccountLoaded(): void {
  if (!started) loadSeenalyzeAccount();
}

/** Re-reads the account while keeping what is shown meanwhile; throws when it could not be checked. */
async function refreshSeenalyzeAccount(): Promise<void> {
  const current = ++revision;
  const account = await studio.getSeenalyzeAccount();
  if (current === revision) useAccountStore.setState({ state: { status: "ready", account } });
}

/**
 * Opens the browser sign-in and waits for it. Starting again ("Open browser again") replaces the pending
 * attempt: the app ends the earlier one as cancelled, which is expected and not reported. Throws the
 * latest attempt's error.
 */
export async function signInSeenalyze(): Promise<void> {
  const attempt = ++signInAttempt;
  useAccountStore.setState({ signingIn: true });
  try {
    setAccount(await studio.signInSeenalyze());
  } catch (error) {
    if (attempt !== signInAttempt) {
      console.info("[seenalyze] an earlier sign-in attempt ended after it was replaced", errorCode(error));
      return;
    }
    throw error;
  } finally {
    if (attempt === signInAttempt) useAccountStore.setState({ signingIn: false });
  }
}

/** Stops waiting for the browser; the pending sign-in then ends as cancelled. */
export function cancelSeenalyzeSignIn(): Promise<void> {
  return studio.cancelSeenalyzeSignIn();
}

/** The shared account state and whether a browser sign-in is pending, without re-reading anything. */
export function useSeenalyzeAccountState(): AccountStore {
  const state = useAccountStore((store) => store.state);
  const signingIn = useAccountStore((store) => store.signingIn);
  return { state, signingIn };
}

/** The account for surfaces inside the studio (Settings, overlay designer); errors show as toasts. */
export function useSeenalyzeAccount() {
  const te = useTranslations("errors.codes");
  const { state, signingIn } = useSeenalyzeAccountState();

  const showError = useCallback(
    (error: unknown) => {
      const code = errorCode(error);
      console.error("[seenalyze] account action failed", code);
      // The user's own cancel needs no message.
      if (code !== "sign-in-cancelled") toast.error(te.has(code) ? te(code) : te("generic"));
      if (code === "seenalyze-signed-out") setAccount(null);
    },
    [te],
  );

  // Opening a surface that shows the account re-reads it (for example after the plan changed), keeping
  // what is shown meanwhile, so the studio never drops to a spinner.
  useEffect(() => {
    if (!started) {
      loadSeenalyzeAccount();
      return;
    }
    if (useAccountStore.getState().state.status === "ready") refreshSeenalyzeAccount().catch(showError);
  }, [showError]);

  const retry = useCallback(() => {
    if (useAccountStore.getState().state.status === "ready") refreshSeenalyzeAccount().catch(showError);
    else loadSeenalyzeAccount();
  }, [showError]);

  const signIn = useCallback(async () => {
    try {
      await signInSeenalyze();
    } catch (error) {
      showError(error);
    }
  }, [showError]);

  const cancelSignIn = useCallback(() => {
    cancelSeenalyzeSignIn().catch((error: unknown) => {
      console.error("[seenalyze] sign-in could not be cancelled", error);
      toast.error(te("generic"));
    });
  }, [te]);

  const signOut = useCallback(async () => {
    try {
      await studio.signOutSeenalyze();
      setAccount(null);
    } catch (error) {
      showError(error);
    }
  }, [showError]);

  return { state, retry, signIn, cancelSignIn, signingIn, signOut, showError };
}
