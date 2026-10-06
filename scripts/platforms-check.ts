// Account-to-ingest integration check with synthetic platform responses.
// No real accounts, credentials, platform requests or broadcasts are used.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { PLATFORM_SPECS } from "../src/shared/platforms";
import { Studio } from "../src/main/studio";
import type { EngineState } from "../src/main/engine/worker";
import { beginTwitchSignIn, twitchStreamKey } from "../src/main/platforms/twitch";
import { createYouTubeBroadcast, signInYouTube, youtubeIngest } from "../src/main/platforms/youtube";
import { fetchPlatform, platformJson, postForm, readToken, storeToken, validAccessToken, OAuthError } from "../src/main/platforms/tokens";

const dataDir = path.join(app.getAppPath(), ".platforms-check-data");
mkdirSync(dataDir, { recursive: true });
app.setPath("userData", dataDir);
writeFileSync(path.join(dataDir, "studio.config.json"), JSON.stringify({ twitchClientId: "synthetic-client", youtubeClientId: "synthetic-client" }));

const requests: { pathname: string; method: string; body: Record<string, unknown> }[] = [];
let rejectBind = false;
let holdIngest: Promise<void> | null = null;
const originalFetch = globalThis.fetch;
const originalOpen = shell.openExternal;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "127.0.0.1") return originalFetch(input, init);
  const form = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {};
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : form;
  requests.push({ pathname: url.pathname, method: init?.method ?? "GET", body });
  assert(init?.signal, "Every platform request needs a deadline");
  if (url.pathname === "/timeout-check") throw Object.assign(new Error("synthetic timeout"), { name: "TimeoutError" });
  if (url.pathname === "/empty-check") return new Response(null, { status: 204 });
  if (url.pathname.endsWith("/device")) return json({ device_code: "synthetic-device", user_code: "TEST", verification_uri: "https://www.twitch.tv/activate", expires_in: 30, interval: 1 });
  if (url.pathname.endsWith("/token")) return json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 });
  if (url.pathname === "/helix/users") return json({ data: [{ id: "check-twitch", display_name: "Test channel" }] });
  if (url.pathname === "/helix/streams/key") {
    if (holdIngest) await holdIngest;
    return json({ data: [{ stream_key: "synthetic-ingest" }] });
  }
  if (url.pathname === "/youtube/v3/channels") return json({ items: [{ id: "check-youtube", snippet: { title: "Test channel" } }] });
  if (url.pathname === "/youtube/v3/liveStreams") return json({ id: "check-stream", cdn: { ingestionInfo: { rtmpsIngestionAddress: "rtmps://example.invalid/live", ingestionAddress: "rtmp://example.invalid/live", streamName: "synthetic-ingest" } } });
  if (url.pathname === "/youtube/v3/liveBroadcasts/bind") return rejectBind ? json({}, 500) : json({ id: "check-broadcast" });
  if (url.pathname === "/youtube/v3/liveBroadcasts" && init?.method === "DELETE") return new Response(null, { status: 204 });
  if (url.pathname === "/youtube/v3/liveBroadcasts") return json({ id: "check-broadcast" });
  throw new Error("Unexpected test request");
}) as typeof fetch;

shell.openExternal = async (address: string) => {
  const auth = new URL(address);
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  const callback = new URL(auth.searchParams.get("redirect_uri")!);
  callback.search = new URLSearchParams({ code: "synthetic-code", state: "incorrect-state" }).toString();
  assert.equal((await originalFetch(callback)).status, 400);
  // An invalid callback must not close the listener for the legitimate one.
  callback.searchParams.set("state", auth.searchParams.get("state")!);
  assert.equal((await originalFetch(callback)).status, 200);
};

app.whenReady().then(async () => {
  let failed = false;
  try {
    const signIn = await beginTwitchSignIn(new AbortController().signal);
    const twitch = await signIn.done;
    assert.equal(twitch.channelId, "check-twitch");
    assert.equal(await twitchStreamKey(twitch), "synthetic-ingest");
    const youtube = await signInYouTube(() => "Complete");
    const ingest = await youtubeIngest(youtube);
    assert.equal(ingest.server, "rtmps://example.invalid/live");
    assert.equal(await createYouTubeBroadcast(youtube, ingest.streamId, { title: "Test stream", privacy: "private" }), "check-broadcast");
    const created = requests.find((request) => request.pathname === "/youtube/v3/liveBroadcasts" && request.method === "POST");
    assert.equal((created?.body.contentDetails as Record<string, unknown>).enableAutoStart, true);
    assert.equal((created?.body.contentDetails as Record<string, unknown>).enableAutoStop, true);
    assert.equal((created?.body.status as Record<string, unknown>).privacyStatus, "private");
    rejectBind = true;
    await assert.rejects(createYouTubeBroadcast(youtube, ingest.streamId, { title: "Test stream" }), /platform-request-failed/u);
    assert(requests.some((request) => request.pathname === "/youtube/v3/liveBroadcasts" && request.method === "DELETE"));
    const window = new BrowserWindow({ show: false });
    const studio = new Studio(window, () => undefined);
    const internal = studio as unknown as {
      state: { encoder: string; accounts: { platform: "twitch"; id: string; displayName: string; channelId: string }[] };
      engineState: EngineState;
      engine: { call: (method: string, ...args: unknown[]) => Promise<unknown> };
    };
    internal.state.encoder = "x264";
    internal.state.accounts = [{ platform: "twitch", ...twitch }];
    internal.engineState = { scenes: [], availableSourceKinds: [], unavailableSourceCount: 0, activeScene: null, audio: [], encoders: [{ id: "x264", hardware: false }], recording: { active: false }, streaming: false };
    const engineCalls: string[] = [];
    internal.engine.call = async (method) => {
      engineCalls.push(method);
      if (method === "sceneReadiness") return { scene: "Scene", pictureSources: 0, audibleSources: 0, pendingSources: 0, missingSources: 0 };
    };
    try {
      const id = await studio.api.saveDestination({ platform: "twitch", name: "Test destination", mode: "account", enabled: true, accountId: twitch.id, server: "", profile: PLATFORM_SPECS.twitch.defaultProfile });
      const checked = await studio.api.checkStream([id]);
      assert.deepEqual(checked.readyDestinationIds, [id]);
      assert(checked.issues.some((issue) => issue.key === "streamCheck.noPicture"));
      assert(checked.issues.some((issue) => issue.key === "streamCheck.noSound"));
      let releaseIngest!: () => void;
      holdIngest = new Promise<void>((resolve) => { releaseIngest = resolve; });
      const initialRequests = requests.length;
      const starting = studio.api.goLive([id, id]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await studio.api.endStream([id]);
      releaseIngest();
      await starting;
      holdIngest = null;
      assert(!engineCalls.includes("startOutputs"), "Cancelled preparation must not start an output");
      assert.equal(requests.slice(initialRequests).filter((request) => request.pathname === "/helix/streams/key").length, 1);
      assert.equal((await studio.api.getSnapshot()).destinationStatus[0]?.state, "idle");
      await studio.api.goLive([id]);
      assert.equal(engineCalls.filter((method) => method === "startOutputs").length, 1);
    } finally {
      await studio.shutdown();
      window.destroy();
    }
    console.log("[platforms] cancelled preparation, duplicate destination requests and subsequent restart: PASS");
    await assert.rejects(fetchPlatform("https://example.invalid/timeout-check"), /platform-timeout/u);
    await postForm<void>("https://example.invalid/empty-check", {}, false);
    await assert.rejects(platformJson(new Response("not-json")), /platform-request-failed/u);
    assert.throws(() => storeToken("invalid-expiry-test", { access_token: "synthetic-only", expires_in: 0 }), /platform-request-failed/u);
    assert.throws(() => storeToken("invalid-test", { access_token: "" }), /platform-request-failed/u);
    storeToken("expired-test", { access_token: "synthetic-old", refresh_token: "synthetic-refresh", expires_in: 1 });
    await assert.rejects(validAccessToken("expired-test", async () => { throw new OAuthError(400, "invalid_grant"); }), /account-signed-out/u);
    assert.equal(readToken("expired-test")?.accessToken, "synthetic-old");
    console.log("[platforms] stream checks, request deadlines, invalid JSON/tokens, expired sign-in and empty responses: PASS");
    console.log("[platforms] Twitch sign-in/ingest, YouTube sign-in/ingest/binding, visibility and failed-broadcast cleanup: PASS (synthetic responses)");
  } catch (error) {
    console.error("[platforms] check failed", error);
    failed = true;
  } finally {
    globalThis.fetch = originalFetch;
    shell.openExternal = originalOpen;
    rmSync(dataDir, { recursive: true, force: true });
  }
  app.exit(failed ? 1 : 0);
});
