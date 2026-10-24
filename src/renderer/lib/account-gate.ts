// Which full-window surface the required SEENALYZE sign-in shows. Pure, so the decision can be tested
// without a window: the studio opens only for a confirmed account, and nothing (neither the gate nor
// the studio) is shown before the first account lookup has answered.
import type { SeenalyzeAccount } from "../../shared/overlays";

/**
 * The SEENALYZE account, with "could not be checked" kept apart from "signed out", so a failed lookup offers a
 * retry instead of looking like the user is not signed in.
 */
export type AccountState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; account: SeenalyzeAccount | null };

/** `loading`: spinner only. `failed`: error with Retry. `signed-out`: the sign-in screen. `open`: the studio. */
export type AccountGateView = "loading" | "failed" | "signed-out" | "open";

export function accountGateView(state: AccountState): AccountGateView {
  if (state.status === "loading") return "loading";
  if (state.status === "failed") return "failed";
  return state.account ? "open" : "signed-out";
}
