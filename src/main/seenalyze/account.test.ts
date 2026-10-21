import { afterEach, describe, expect, mock, test } from "bun:test";

const secrets = new Map<string, string>();
const opened: string[] = [];

mock.module("electron", () => ({
  shell: {
    openExternal: async (url: string) => {
      opened.push(url);
    },
  },
}));
mock.module("../config", () => ({ studioConfig: () => ({ seenalyzeOrigin: "https://dashboard.test" }) }));
mock.module("../secrets", () => ({
  getSecret: (name: string) => secrets.get(name) ?? null,
  setSecret: (name: string, value: string) => void secrets.set(name, value),
  deleteSecret: (name: string) => void secrets.delete(name),
}));

const { SeenalyzeAccountService } = await import("./account");

const realFetch = globalThis.fetch;
const realWarn = console.warn;
const realError = console.error;

function quiet(): void {
  // The code under test logs its failures; the expected ones would only clutter the test output.
  console.warn = () => undefined;
  console.error = () => undefined;
}

function expiredSession(): void {
  secrets.set("seenalyze:session", JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: Date.now() - 1000 }));
}

function stubFetch(handler: () => Promise<Response>): void {
  globalThis.fetch = Object.assign(handler, { preconnect: realFetch.preconnect });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  console.error = realError;
  secrets.clear();
  opened.length = 0;
});

describe("session refresh", () => {
  test("an unreachable dashboard keeps the session and reports the connection problem", async () => {
    quiet();
    expiredSession();
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const account = new SeenalyzeAccountService();
    await expect(account.refreshProfile()).rejects.toThrow("seenalyze-unreachable");
    expect(secrets.has("seenalyze:session")).toBe(true);
    expect(account.signedIn).toBe(true);
  });

  test("a server error keeps the session", async () => {
    quiet();
    expiredSession();
    stubFetch(async () => new Response("{}", { status: 503 }));
    const account = new SeenalyzeAccountService();
    await expect(account.refreshProfile()).rejects.toThrow("seenalyze-unreachable");
    expect(secrets.has("seenalyze:session")).toBe(true);
  });

  test("a rejected refresh token signs out", async () => {
    quiet();
    expiredSession();
    stubFetch(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const account = new SeenalyzeAccountService();
    await expect(account.refreshProfile()).rejects.toThrow("seenalyze-signed-out");
    expect(secrets.has("seenalyze:session")).toBe(false);
  });
});

describe("sign-in attempts", () => {
  test("starting a new sign-in cancels the previous one without ending the new one", async () => {
    const account = new SeenalyzeAccountService();
    const first = account.signIn();
    const firstResult = first.catch((error: unknown) => (error instanceof Error ? error.message : "unknown"));
    await Promise.resolve();
    const second = account.signIn();
    expect(await firstResult).toBe("sign-in-cancelled");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = new URL(opened[1]).searchParams.get("state");
    expect(state).not.toBeNull();
    // The second attempt still accepts its own callback after the first was replaced.
    stubFetch(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    expect(account.handleCallback(`seenalyze-studio://oauth/callback?code=abc&state=${state}`)).toBe(true);
    await expect(second).rejects.toThrow("seenalyze-sign-in-failed");
  });

  test("a callback with another attempt's state is ignored", async () => {
    quiet();
    const account = new SeenalyzeAccountService();
    const attempt = account.signIn().catch((error: unknown) => (error instanceof Error ? error.message : "unknown"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(account.handleCallback("seenalyze-studio://oauth/callback?code=abc&state=forged")).toBe(true);
    account.cancelSignIn();
    expect(await attempt).toBe("sign-in-cancelled");
  });
});
