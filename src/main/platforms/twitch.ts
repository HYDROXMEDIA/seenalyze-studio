// Twitch: device-code sign-in (public client, no secret), stream key and
// channel metadata through Helix.

import type { BroadcastInfo, CategoryOption, DeviceCodePrompt } from "../../shared/types";
import { studioConfig } from "../config";
import { fetchPlatform, platformJson, OAuthError, postForm, storeToken, validAccessToken, type StoredToken, type TokenResponse } from "./tokens";

// Read-only extras power overlay alerts: follower events/counts and channel point redemptions.
export const SCOPES = "channel:read:stream_key channel:manage:broadcast moderator:read:followers channel:read:redemptions";
const HELIX = "https://api.twitch.tv/helix";
export const TWITCH_INGEST = "rtmp://live.twitch.tv/app";

export interface TwitchAccount {
  id: string;
  displayName: string;
  channelId: string;
}

function clientId(): string {
  const id = studioConfig().twitchClientId;
  if (!id) throw new Error("twitch-not-configured");
  return id;
}

export function twitchConfigured(): boolean {
  return Boolean(studioConfig().twitchClientId);
}

interface DeviceResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Starts device sign-in. Returns the code to show the user and a promise that
 * resolves with the account once they approve it in the browser.
 */
export async function beginTwitchSignIn(signal: AbortSignal): Promise<{ prompt: DeviceCodePrompt; done: Promise<TwitchAccount> }> {
  const device = await postForm<DeviceResponse>("https://id.twitch.tv/oauth2/device", {
    client_id: clientId(),
    scopes: SCOPES,
  });
  const done = pollForToken(device, signal);
  return {
    prompt: { verificationUri: device.verification_uri, userCode: device.user_code, expiresInSec: device.expires_in },
    done,
  };
}

async function pollForToken(device: DeviceResponse, signal: AbortSignal): Promise<TwitchAccount> {
  const deadline = Date.now() + device.expires_in * 1000;
  let interval = Math.max(device.interval, 1) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (signal.aborted) throw new Error("sign-in-cancelled");
    try {
      const token = await postForm<TokenResponse>("https://id.twitch.tv/oauth2/token", {
        client_id: clientId(),
        scopes: SCOPES,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      const user = await helixUser(token.access_token);
      const accountId = `twitch:${user.id}`;
      storeToken(accountId, token);
      return { id: accountId, displayName: user.display_name, channelId: user.id };
    } catch (error) {
      if (error instanceof OAuthError && error.code === "authorization_pending") continue;
      if (error instanceof OAuthError && error.code === "slow_down") {
        interval += 5000;
        continue;
      }
      throw error;
    }
  }
  throw new Error("sign-in-expired");
}

function refreshToken(token: StoredToken): Promise<TokenResponse> {
  return postForm<TokenResponse>("https://id.twitch.tv/oauth2/token", {
    client_id: clientId(),
    grant_type: "refresh_token",
    refresh_token: token.refreshToken ?? "",
  });
}

async function helix<T>(accountId: string, pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await validAccessToken(accountId, refreshToken);
  return helixWithToken<T>(accessToken, pathAndQuery, init);
}

async function helixWithToken<T>(accessToken: string, pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchPlatform(`${HELIX}${pathAndQuery}`, {
    ...init,
    headers: {
      ...init.headers,
      "Client-Id": clientId(),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (response.status === 401) throw new Error("account-signed-out");
  // 403 means the sign-in predates a scope this feature needs.
  if (response.status === 403) throw new Error("twitch-scope-missing");
  if (!response.ok) throw new Error("platform-request-failed");
  if (response.status === 204) return undefined as T;
  return platformJson<T>(response);
}

async function helixUser(accessToken: string): Promise<{ id: string; display_name: string }> {
  const result = await helixWithToken<{ data: { id: string; display_name: string }[] }>(accessToken, "/users");
  const user = result.data[0];
  if (!user) throw new Error("platform-request-failed");
  return user;
}

export async function twitchStreamKey(account: TwitchAccount): Promise<string> {
  const result = await helix<{ data: { stream_key: string }[] }>(
    account.id,
    `/streams/key?broadcaster_id=${encodeURIComponent(account.channelId)}`,
  );
  const key = result.data[0]?.stream_key;
  if (!key) throw new Error("platform-request-failed");
  return key;
}

export async function twitchBroadcastInfo(account: TwitchAccount): Promise<BroadcastInfo> {
  const result = await helix<{ data: { title: string; game_id: string; game_name: string }[] }>(
    account.id,
    `/channels?broadcaster_id=${encodeURIComponent(account.channelId)}`,
  );
  const channel = result.data[0];
  return { title: channel?.title ?? "", categoryId: channel?.game_id || undefined, categoryName: channel?.game_name || undefined };
}

export async function setTwitchBroadcastInfo(account: TwitchAccount, info: BroadcastInfo): Promise<void> {
  const body: Record<string, string> = { title: info.title };
  if (info.categoryId) body.game_id = info.categoryId;
  await helix<void>(account.id, `/channels?broadcaster_id=${encodeURIComponent(account.channelId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function searchTwitchCategories(accountId: string, query: string): Promise<CategoryOption[]> {
  if (!query.trim()) return [];
  const result = await helix<{ data: { id: string; name: string }[] }>(
    accountId,
    `/search/categories?first=10&query=${encodeURIComponent(query.trim())}`,
  );
  return result.data.map(({ id, name }) => ({ id, name }));
}

export async function revokeTwitch(accessToken: string): Promise<void> {
  await postForm("https://id.twitch.tv/oauth2/revoke", { client_id: clientId(), token: accessToken }, false);
}

/** The channel's login name, which chat uses to identify the room. */
export async function twitchLogin(account: TwitchAccount): Promise<string> {
  const result = await helix<{ data: { login: string }[] }>(account.id, `/users?id=${encodeURIComponent(account.channelId)}`);
  const login = result.data[0]?.login;
  if (!login) throw new Error("platform-request-failed");
  return login;
}

/** Subscribes an EventSub WebSocket session to one event type for this channel. */
export async function createEventSubSubscription(
  account: TwitchAccount,
  sessionId: string,
  type: string,
  version: string,
  condition: Record<string, string>,
): Promise<void> {
  await helix<unknown>(account.id, "/eventsub/subscriptions", {
    method: "POST",
    body: JSON.stringify({ type, version, condition, transport: { method: "websocket", session_id: sessionId } }),
  });
}

export interface TwitchLiveStats {
  live: boolean;
  viewers: number;
  startedAt?: string;
  followers?: number;
}

/** Current viewer count and follower total (followers need the follower scope). */
export async function twitchLiveStats(account: TwitchAccount): Promise<TwitchLiveStats> {
  const id = encodeURIComponent(account.channelId);
  const streams = await helix<{ data: { viewer_count: number; started_at: string }[] }>(account.id, `/streams?user_id=${id}`);
  const stream = streams.data[0];
  let followers: number | undefined;
  try {
    followers = (await helix<{ total: number }>(account.id, `/channels/followers?broadcaster_id=${id}&first=1`)).total;
  } catch (error) {
    // Older sign-ins lack the follower scope; the count is optional.
    console.warn("[twitch] follower count unavailable", error instanceof Error ? error.message : error);
  }
  return { live: Boolean(stream), viewers: stream?.viewer_count ?? 0, startedAt: stream?.started_at, followers };
}
