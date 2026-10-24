import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SeenalyzeAccount } from "../../shared/overlays";
import { accountGateView } from "./account-gate";

const ACCOUNT: SeenalyzeAccount = { email: "studio@example.test", displayName: null, avatarUrl: null, canUseDesigner: false };

describe("required sign-in", () => {
  test("shows only a spinner until the first account lookup answers", () => {
    expect(accountGateView({ status: "loading" })).toBe("loading");
  });

  test("a lookup that failed offers a retry instead of the sign-in screen", () => {
    expect(accountGateView({ status: "failed" })).toBe("failed");
  });

  test("signed out (including after signing out in Settings) shows the sign-in screen", () => {
    expect(accountGateView({ status: "ready", account: null })).toBe("signed-out");
  });

  test("opens the studio for a signed-in account, whatever its plan", () => {
    expect(accountGateView({ status: "ready", account: ACCOUNT })).toBe("open");
    expect(accountGateView({ status: "ready", account: { ...ACCOUNT, canUseDesigner: true } })).toBe("open");
  });

  test("the studio, its views, first-run setup and canvas shortcuts sit behind the gate", () => {
    const app = readFileSync(path.join(import.meta.dir, "..", "App.tsx"), "utf8");
    const open = app.indexOf("<SignInGate>");
    const close = app.indexOf("</SignInGate>");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    for (const element of ["<StudioKeyboard />", "<Header />", "<SettingsPage />", "<OverlaysPage />", "<Preview />", "<SetupWizard />"]) {
      const at = app.indexOf(element);
      expect({ element, inside: at > open && at < close }).toEqual({ element, inside: true });
      expect(app.indexOf(element, at + 1)).toBe(-1);
    }
    // Canvas shortcuts must not run behind the sign-in screen.
    expect(app.slice(0, app.indexOf("function StudioKeyboard"))).not.toMatch(/use(CanvasUndo|ArrowNudge)\(\)/u);
  });
});
