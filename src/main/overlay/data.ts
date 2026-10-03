// Live data for overlays: chat, stream events and channel stats, merged across
// YouTube and Twitch. Everything starts only while at least one overlay is on
// screen and stops when the last one disconnects.

import type { StreamEvent, StreamStats } from "../../shared/overlays";
import type { ChatMessage } from "../../shared/types";
import type { ChatAccount, ChatHub } from "../chat/hub";
import { TwitchEventSub, type EventSubState } from "../chat/twitch-eventsub";
import { twitchLiveStats } from "../platforms/twitch";
import { youtubeLiveStats, youtubeSubscriberCount } from "../platforms/youtube";

export type OverlayFeedMessage =
  | { type: "chat"; messages: ChatMessage[] }
  | { type: "chatRemove"; ids: string[] }
  | { type: "event"; event: StreamEvent }
  | { type: "stats"; stats: StreamStats };

const STATS_INTERVAL_MS = 30_000;
const CHANNEL_STATS_INTERVAL_MS = 5 * 60_000;

export interface DataSourceStatus {
  twitchFollows: EventSubState | "unavailable";
}

export class StreamDataHub {
  private readonly listeners = new Set<(message: OverlayFeedMessage) => void>();
  private releaseChat: (() => void) | null = null;
  private releaseEvents: (() => void) | null = null;
  private readonly eventSubs = new Map<string, TwitchEventSub>();
  private eventSubState: EventSubState | "unavailable" = "unavailable";
  private statsTimer: NodeJS.Timeout | null = null;
  private lastChannelStats = 0;
  private stats: StreamStats = { viewers: { total: 0 }, sessionFollows: 0, sessionSubs: 0, sessionBits: 0, live: false };
  private superChatTotals = new Map<string, number>();

  constructor(
    private readonly chat: ChatHub,
    private readonly accounts: () => ChatAccount[],
    private readonly onStatus: (status: DataSourceStatus) => void,
  ) {}

  get currentStats(): StreamStats {
    return this.stats;
  }

  status(): DataSourceStatus {
    return { twitchFollows: this.eventSubState };
  }

  subscribe(listener: (message: OverlayFeedMessage) => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    listener({ type: "stats", stats: this.stats });
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** Accounts changed: restart account-bound sources if overlays are live. */
  sync(): void {
    if (this.listeners.size === 0) return;
    this.stopSources();
    this.startSources();
  }

  /** Clears the "this stream" counters (follows, subs, bits, Super Chats). */
  resetSession(): void {
    this.stats = { ...this.stats, sessionFollows: 0, sessionSubs: 0, sessionBits: 0, sessionSuperChatTotalLabel: undefined };
    this.superChatTotals.clear();
    this.broadcast({ type: "stats", stats: this.stats });
  }

  stopAll(): void {
    this.listeners.clear();
    this.stop();
  }

  private start(): void {
    this.releaseChat = this.chat.subscribe((event) => {
      if (event.type === "messages") this.broadcast({ type: "chat", messages: event.messages });
      else if (event.type === "remove") this.broadcast({ type: "chatRemove", ids: event.ids });
    });
    this.releaseEvents = this.chat.onStreamEvent((event) => this.onEvent(event));
    this.startSources();
  }

  private stop(): void {
    this.releaseChat?.();
    this.releaseEvents?.();
    this.releaseChat = null;
    this.releaseEvents = null;
    this.stopSources();
  }

  private startSources(): void {
    for (const account of this.accounts()) {
      if (account.platform !== "twitch") continue;
      const eventSub = new TwitchEventSub(account, (event) => this.onEvent(event), (state) => {
        this.eventSubState = state;
        this.onStatus(this.status());
      });
      this.eventSubs.set(account.id, eventSub);
      eventSub.start();
    }
    if (this.eventSubs.size === 0) this.eventSubState = "unavailable";
    this.lastChannelStats = 0;
    void this.pollStats();
    this.statsTimer = setInterval(() => void this.pollStats(), STATS_INTERVAL_MS);
  }

  private stopSources(): void {
    for (const eventSub of this.eventSubs.values()) eventSub.stop();
    this.eventSubs.clear();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  private onEvent(event: StreamEvent): void {
    const stats = { ...this.stats };
    switch (event.type) {
      case "follow":
        stats.sessionFollows += 1;
        if (stats.followers !== undefined) stats.followers += 1;
        break;
      case "subscription":
      case "resub":
      case "membership":
        stats.sessionSubs += 1;
        break;
      case "giftSub":
      case "giftMembership":
        stats.sessionSubs += event.count ?? 1;
        break;
      case "cheer":
        stats.sessionBits += event.amount ?? 0;
        break;
      case "superChat":
      case "superSticker":
        stats.sessionSuperChatTotalLabel = this.addSuperChat(event);
        break;
      default:
        break;
    }
    this.stats = stats;
    this.broadcast({ type: "event", event });
    this.broadcast({ type: "stats", stats });
  }

  /** Totals per currency symbol, shown as e.g. "$45.00 · €10.00". */
  private addSuperChat(event: StreamEvent): string | undefined {
    if (!event.amount || !event.amountLabel) return this.stats.sessionSuperChatTotalLabel;
    const symbol = event.amountLabel.replace(/[\d.,\s]/gu, "") || "$";
    this.superChatTotals.set(symbol, (this.superChatTotals.get(symbol) ?? 0) + event.amount);
    return [...this.superChatTotals.entries()].map(([currency, total]) => `${currency}${total.toFixed(2)}`).join(" · ");
  }

  private async pollStats(): Promise<void> {
    const accounts = this.accounts();
    const includeChannel = Date.now() - this.lastChannelStats > CHANNEL_STATS_INTERVAL_MS;
    if (includeChannel) this.lastChannelStats = Date.now();
    const viewers: StreamStats["viewers"] = { total: 0 };
    let live = false;
    let startedAt: number | undefined;
    let followers = this.stats.followers;
    let subscribers = this.stats.subscribers;

    await Promise.all(
      accounts.map(async (account) => {
        try {
          if (account.platform === "twitch") {
            const result = await twitchLiveStats(account);
            viewers.twitch = (viewers.twitch ?? 0) + result.viewers;
            if (result.followers !== undefined) followers = result.followers;
            if (result.live) live = true;
            if (result.startedAt) startedAt = Math.min(startedAt ?? Infinity, Date.parse(result.startedAt));
          } else {
            const result = await youtubeLiveStats(account);
            viewers.youtube = (viewers.youtube ?? 0) + result.viewers;
            if (result.live) live = true;
            if (result.startedAt) startedAt = Math.min(startedAt ?? Infinity, Date.parse(result.startedAt));
            if (includeChannel) subscribers = (await youtubeSubscriberCount(account)) ?? subscribers;
          }
        } catch (error) {
          console.warn(`[overlay-data] ${account.platform} stats unavailable`, error instanceof Error ? error.message : error);
        }
      }),
    );
    viewers.total = (viewers.youtube ?? 0) + (viewers.twitch ?? 0);
    this.stats = {
      ...this.stats,
      viewers,
      live,
      followers,
      subscribers,
      uptimeSeconds: startedAt !== undefined && Number.isFinite(startedAt) ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : undefined,
    };
    this.broadcast({ type: "stats", stats: this.stats });
  }

  private broadcast(message: OverlayFeedMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}
