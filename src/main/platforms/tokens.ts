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
      .finally(() => refreshing.delete(accountId));
    refreshing.set(accountId, pending);
  }
  return (await pending).accessToken;
}

export async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) throw new OAuthError(response.status, json.error ?? json.message ?? "request-failed");
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
