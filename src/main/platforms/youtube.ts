// YouTube: browser sign-in with PKCE and a loopback redirect, then
// liveStreams/liveBroadcasts management through the YouTube Data API.

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { shell } from "electron";
import type { BroadcastInfo } from "../../shared/types";
import { studioConfig } from "../config";
import { postForm, storeToken, validAccessToken, type StoredToken, type TokenResponse } from "./tokens";

const SCOPE = "https://www.googleapis.com/auth/youtube";
const API = "https://www.googleapis.com/youtube/v3";
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface YouTubeAccount {
  id: string;
  displayName: string;
  channelId: string;
  /** Reusable liveStream id, created once per account. */
  streamId?: string;
}

export interface YouTubeIngest {
  server: string;
  streamKey: string;
  streamId: string;
}

function clientId(): string {
  const id = studioConfig().youtubeClientId;
  if (!id) throw new Error("youtube-not-configured");
  return id;
}

export function youtubeConfigured(): boolean {
  return Boolean(studioConfig().youtubeClientId);
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function tokenParams(extra: Record<string, string>): Record<string, string> {
  const params: Record<string, string> = { client_id: clientId(), ...extra };
  const secret = studioConfig().youtubeClientSecret;
  if (secret) params.client_secret = secret;
  return params;
}

/** Opens the system browser and resolves once the user has approved access. */
export async function signInYouTube(callbackHtml: (ok: boolean) => string): Promise<YouTubeAccount> {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(16));

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }
      const returnedCode = url.searchParams.get("code");
      const ok = Boolean(returnedCode) && url.searchParams.get("state") === state;
      response.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" }).end(callbackHtml(ok));
      clearTimeout(timer);
      server.close();
      if (ok && returnedCode) resolve({ code: returnedCode, redirectUri });
      else reject(new Error("sign-in-cancelled"));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("sign-in-expired"));
    }, SIGN_IN_TIMEOUT_MS);
    let redirectUri = "";
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        access_type: "offline",
        prompt: "consent",
      }).toString();
      shell.openExternal(auth.toString()).catch(reject);
    });
  });

  const token = await postForm<TokenResponse>(
    "https://oauth2.googleapis.com/token",
    tokenParams({ code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  );
  const channel = await youtubeRequest<{ items?: { id: string; snippet: { title: string } }[] }>(
    token.access_token,
    "/channels?part=snippet&mine=true",
  );
  const item = channel.items?.[0];
  if (!item) throw new Error("youtube-no-channel");
  const accountId = `youtube:${item.id}`;
  storeToken(accountId, token);
  return { id: accountId, displayName: item.snippet.title, channelId: item.id };
}

function refreshToken(token: StoredToken): Promise<TokenResponse> {
  return postForm<TokenResponse>(
    "https://oauth2.googleapis.com/token",
    tokenParams({ grant_type: "refresh_token", refresh_token: token.refreshToken ?? "" }),
  );
}

async function youtubeRequest<T>(accessToken: string, pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${pathAndQuery}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (response.status === 401) throw new Error("account-signed-out");
  if (response.status === 403 || response.status === 404) {
    const body = (await response.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } };
    throw new Error(youtubeErrorCode(body.error?.errors?.[0]?.reason));
  }
  if (!response.ok) throw new Error("platform-request-failed");
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function youtubeErrorCode(reason: string | undefined): string {
  switch (reason) {
    case "liveStreamingNotEnabled":
      return "youtube-live-not-enabled";
    case "quotaExceeded":
    case "rateLimitExceeded":
      return "youtube-quota-exceeded";
    case "liveChatEnded":
    case "liveChatNotFound":
      return "youtube-chat-ended";
    case "liveChatDisabled":
      return "youtube-chat-disabled";
    default:
      return "platform-request-failed";
  }
}

async function api<T>(accountId: string, pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await validAccessToken(accountId, refreshToken);
  return youtubeRequest<T>(accessToken, pathAndQuery, init);
}

interface LiveStreamResource {
  id: string;
  cdn: { ingestionInfo: { ingestionAddress: string; rtmpsIngestionAddress?: string; streamName: string } };
}

/** Returns the account's reusable ingest point, creating it on first use. */
export async function youtubeIngest(account: YouTubeAccount): Promise<YouTubeIngest> {
  let stream: LiveStreamResource | undefined;
  if (account.streamId) {
    const existing = await api<{ items?: LiveStreamResource[] }>(
      account.id,
      `/liveStreams?part=cdn&id=${encodeURIComponent(account.streamId)}`,
    );
    stream = existing.items?.[0];
  }
  if (!stream) {
    stream = await api<LiveStreamResource>(account.id, "/liveStreams?part=snippet,cdn,contentDetails", {
      method: "POST",
      body: JSON.stringify({
        snippet: { title: "SEENALYZE STUDIO" },
        cdn: { ingestionType: "rtmp", resolution: "variable", frameRate: "variable" },
        contentDetails: { isReusable: true },
      }),
    });
  }
  const info = stream.cdn.ingestionInfo;
  return { server: info.rtmpsIngestionAddress ?? info.ingestionAddress, streamKey: info.streamName, streamId: stream.id };
}

/** Creates a broadcast bound to the ingest stream; it goes live when video arrives. */
export async function createYouTubeBroadcast(account: YouTubeAccount, streamId: string, info: BroadcastInfo): Promise<string> {
  const broadcast = await api<{ id: string }>(account.id, "/liveBroadcasts?part=snippet,status,contentDetails", {
    method: "POST",
    body: JSON.stringify({
      snippet: { title: info.title.trim() || "Live", scheduledStartTime: new Date().toISOString() },
      status: { privacyStatus: info.privacy ?? "public", selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: true, enableAutoStop: true, latencyPreference: "normal" },
    }),
  });
  await api(
    account.id,
    `/liveBroadcasts/bind?part=id&id=${encodeURIComponent(broadcast.id)}&streamId=${encodeURIComponent(streamId)}`,
    { method: "POST" },
  );
  return broadcast.id;
}

export async function completeYouTubeBroadcast(account: YouTubeAccount, broadcastId: string): Promise<void> {
  await api(
    account.id,
    `/liveBroadcasts/transition?part=status&broadcastStatus=complete&id=${encodeURIComponent(broadcastId)}`,
    { method: "POST" },
  );
}

/** Removes a broadcast that never went live, so it doesn't linger as "upcoming". */
export async function deleteYouTubeBroadcast(account: YouTubeAccount, broadcastId: string): Promise<void> {
  await api(account.id, `/liveBroadcasts?id=${encodeURIComponent(broadcastId)}`, { method: "DELETE" });
}

export async function revokeYouTube(accessToken: string): Promise<void> {
  await postForm("https://oauth2.googleapis.com/revoke", { token: accessToken });
}

// ----- live chat -------------------------------------------------------------

/** Chat id of the channel's broadcast that is live right now, if any. */
export async function activeLiveChatId(account: YouTubeAccount): Promise<string | null> {
  const result = await api<{ items?: { snippet?: { liveChatId?: string } }[] }>(
    account.id,
    "/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all&maxResults=5",
  );
  return result.items?.find((item) => item.snippet?.liveChatId)?.snippet?.liveChatId ?? null;
}

export interface YouTubeChatItem {
  id: string;
  snippet: {
    type: string;
    publishedAt: string;
    displayMessage?: string;
    authorChannelId?: string;
    superChatDetails?: { amountMicros?: string; amountDisplayString?: string; userComment?: string };
    superStickerDetails?: { amountMicros?: string; amountDisplayString?: string };
    membershipGiftingDetails?: { giftMembershipsCount?: number };
    newSponsorDetails?: { memberLevelName?: string; isUpgrade?: boolean };
    memberMilestoneChatDetails?: { memberMonth?: number; userComment?: string };
    messageDeletedDetails?: { deletedMessageId?: string };
    userBannedDetails?: { bannedUserDetails?: { channelId?: string } };
  };
  authorDetails?: {
    channelId: string;
    displayName: string;
    profileImageUrl?: string;
    isVerified?: boolean;
    isChatOwner?: boolean;
    isChatSponsor?: boolean;
    isChatModerator?: boolean;
  };
}

export interface YouTubeChatPage {
  items: YouTubeChatItem[];
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  offlineAt?: string;
}

export async function listChatMessages(account: YouTubeAccount, liveChatId: string, pageToken?: string): Promise<YouTubeChatPage> {
  const query = new URLSearchParams({ liveChatId, part: "snippet,authorDetails", maxResults: "200" });
  if (pageToken) query.set("pageToken", pageToken);
  const page = await api<Partial<YouTubeChatPage>>(account.id, `/liveChat/messages?${query.toString()}`);
  return { items: page.items ?? [], nextPageToken: page.nextPageToken, pollingIntervalMillis: page.pollingIntervalMillis, offlineAt: page.offlineAt };
}

// ----- live stats --------------------------------------------------------------

export interface YouTubeLiveStats {
  live: boolean;
  viewers: number;
  startedAt?: string;
}

/** Concurrent viewers of the channel's active broadcast (1–2 quota units per call). */
export async function youtubeLiveStats(account: YouTubeAccount): Promise<YouTubeLiveStats> {
  const broadcasts = await api<{ items?: { id: string }[] }>(account.id, "/liveBroadcasts?part=id&broadcastStatus=active&broadcastType=all&maxResults=1");
  const id = broadcasts.items?.[0]?.id;
  if (!id) return { live: false, viewers: 0 };
  const videos = await api<{ items?: { liveStreamingDetails?: { concurrentViewers?: string; actualStartTime?: string } }[] }>(
    account.id,
    `/videos?part=liveStreamingDetails&id=${encodeURIComponent(id)}`,
  );
  const details = videos.items?.[0]?.liveStreamingDetails;
  return { live: true, viewers: Number(details?.concurrentViewers ?? 0) || 0, startedAt: details?.actualStartTime };
}

/** Public subscriber count of the signed-in channel (hidden counts return undefined). */
export async function youtubeSubscriberCount(account: YouTubeAccount): Promise<number | undefined> {
  const result = await api<{ items?: { statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] }>(
    account.id,
    "/channels?part=statistics&mine=true",
  );
  const statistics = result.items?.[0]?.statistics;
  if (!statistics || statistics.hiddenSubscriberCount) return undefined;
  return Number(statistics.subscriberCount) || 0;
}
