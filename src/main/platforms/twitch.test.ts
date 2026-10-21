import { afterEach, describe, expect, mock, test } from "bun:test";

const secrets = new Map<string, string>();

mock.module("../config", () => ({ studioConfig: () => ({ twitchClientId: "client" }) }));
mock.module("../secrets", () => ({
  getSecret: (name: string) => secrets.get(name) ?? null,
  setSecret: (name: string, value: string) => void secrets.set(name, value),
  deleteSecret: (name: string) => void secrets.delete(name),
  secretNames: { token: (accountId: string) => `oauth:${accountId}` },
}));

const { refreshToken } = await import("./twitch");
const { readToken, storeToken, validAccessToken } = await import("./tokens");

const realFetch = globalThis.fetch;
const ACCOUNT = "twitch:1";

function stubFetch(handler: () => Promise<Response>): void {
  globalThis.fetch = Object.assign(handler, { preconnect: realFetch.preconnect });
}

function expired(): void {
  secrets.set(`oauth:${ACCOUNT}`, JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: Date.now() - 1000 }));
}

afterEach(() => {
  globalThis.fetch = realFetch;
  secrets.clear();
});

describe("twitch token refresh", () => {
  test("a rejected refresh token asks the user to connect again", async () => {
    expired();
    // Twitch's real answer for a revoked or expired refresh token: no OAuth error code.
    stubFetch(async () => Response.json({ status: 400, message: "Invalid refresh token" }, { status: 400 }));
    await expect(validAccessToken(ACCOUNT, refreshToken)).rejects.toThrow("account-signed-out");
  });

  test("a service outage stays a retryable failure, not a sign-out", async () => {
    expired();
    stubFetch(async () => Response.json({ status: 503, message: "Service unavailable" }, { status: 503 }));
    await expect(validAccessToken(ACCOUNT, refreshToken)).rejects.toThrow("oauth-503-request-failed");
    expect(readToken(ACCOUNT)?.refreshToken).toBe("refresh");
  });

  test("an unreadable reply never quotes the response body", async () => {
    expired();
    stubFetch(async () => new Response("access_token=secret-value", { status: 200 }));
    const error = await validAccessToken(ACCOUNT, refreshToken).then(() => null, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toBe("platform-request-failed");
    expect(JSON.stringify((error as Error).cause, Object.getOwnPropertyNames((error as Error).cause ?? {}))).not.toContain("secret-value");
  });

  test("a refresh keeps the previous refresh token when Twitch sends none", async () => {
    expired();
    stubFetch(async () => Response.json({ access_token: "new", expires_in: 3600 }));
    expect(await validAccessToken(ACCOUNT, refreshToken)).toBe("new");
    expect(readToken(ACCOUNT)?.refreshToken).toBe("refresh");
  });

  test("concurrent callers share one refresh", async () => {
    expired();
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return Response.json({ access_token: "new", refresh_token: "r2", expires_in: 3600 });
    });
    const tokens = await Promise.all([validAccessToken(ACCOUNT, refreshToken), validAccessToken(ACCOUNT, refreshToken)]);
    expect(tokens).toEqual(["new", "new"]);
    expect(calls).toBe(1);
  });

  test("rejects malformed token responses instead of storing them", () => {
    expect(() => storeToken(ACCOUNT, { access_token: "" })).toThrow("platform-request-failed");
    expect(() => storeToken(ACCOUNT, { access_token: "a", expires_in: -5 })).toThrow("platform-request-failed");
    expect(secrets.size).toBe(0);
  });

  test("an unreadable stored token signs the account out", () => {
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      secrets.set(`oauth:${ACCOUNT}`, "{not json");
      expect(readToken(ACCOUNT)).toBeNull();
      expect(secrets.size).toBe(0);
    } finally {
      console.warn = warn;
    }
  });
});
