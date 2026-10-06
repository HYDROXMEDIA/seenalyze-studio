// OAuth token persistence and refresh, shared by the platform adapters.

import { deleteSecret, getSecret, secretNames, setSecret } from "../secrets";

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

const REFRESH_MARGIN_MS = 60_000;
const refreshing = new Map<string, Promise<StoredToken>>();

export function storeToken(accountId: string, response: TokenResponse, previous?: StoredToken): StoredToken {
  if (typeof response.access_token !== "string" || !response.access_token) throw new Error("platform-request-failed");
  if (response.expires_in !== undefined && (typeof response.expires_in !== "number" || !Number.isFinite(response.expires_in) || response.expires_in <= 0)) throw new Error("platform-request-failed");
  const token: StoredToken = {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
  };
  setSecret(secretNames.token(accountId), JSON.stringify(token));
  return token;
}

export function readToken(accountId: string): StoredToken | null {
  const raw = getSecret(secretNames.token(accountId));
  return raw ? (JSON.parse(raw) as StoredToken) : null;
}

export function forgetToken(accountId: string): void {
  deleteSecret(secretNames.token(accountId));
}

/** Returns a valid access token, refreshing at most once at a time per account. */
export async function validAccessToken(
  accountId: string,
  refresh: (token: StoredToken) => Promise<TokenResponse>,
): Promise<string> {
  const token = readToken(accountId);
  if (!token) throw new Error("account-signed-out");
  if (token.expiresAt - REFRESH_MARGIN_MS > Date.now()) return token.accessToken;
  if (!token.refreshToken) throw new Error("account-signed-out");

  let pending = refreshing.get(accountId);
  if (!pending) {
    pending = refresh(token)
      .then((response) => storeToken(accountId, response, token))
      .catch((error: unknown) => {
        if (error instanceof OAuthError && (error.code === "invalid_grant" || error.status === 401)) throw new Error("account-signed-out");
        throw error;
      })
      .finally(() => refreshing.delete(accountId));
    refreshing.set(accountId, pending);
  }
  return (await pending).accessToken;
}

/** Bounded requests keep account preparation and cancellation recoverable. */
export async function fetchPlatform(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    const deadline = AbortSignal.timeout(30_000);
    return await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("platform-timeout", { cause: error });
    throw new Error("platform-request-failed", { cause: error });
  }
}

export async function platformJson<T>(response: Response): Promise<T> {
  try { return await response.json() as T; }
  catch (error) {
    // JSON parser messages can quote a response containing credentials.
    if (error instanceof SyntaxError) { error.message = "Invalid platform response"; error.stack = undefined; }
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("platform-timeout", { cause: error });
    throw new Error("platform-request-failed", { cause: error });
  }
}

export async function postForm<T>(url: string, body: Record<string, string>, expectJson = true): Promise<T> {
  const response = await fetchPlatform(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (response.ok && !expectJson) return undefined as T;
  const json = await platformJson<T & { error?: string }>(response);
  if (!response.ok) throw new OAuthError(response.status, typeof json.error === "string" && /^[a-z][a-z0-9_-]*$/u.test(json.error) ? json.error : "request-failed");
  return json;
}

export class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`oauth-${status}-${code}`);
    this.name = "OAuthError";
  }
}
