// Chat hub: one chat source per connected account, merged into one bounded
// message history and pushed to the renderer in small batches.

import type { StreamEvent } from "../../shared/overlays";
import type { ChatEvent, ChatMessage, ChatSourceStatus, ChatState, Platform } from "../../shared/types";
import type { TwitchAccount } from "../platforms/twitch";
import type { YouTubeAccount } from "../platforms/youtube";
import { TwitchChat } from "./twitch-chat";
import type { ChatSink, ChatSource } from "./types";
import { YouTubeChat } from "./youtube-chat";

const HISTORY_LIMIT = 300;
const FLUSH_MS = 100;

export type ChatAccount =
  | ({ platform: "twitch" } & TwitchAccount & { login?: string })
  | ({ platform: "youtube" } & YouTubeAccount);

interface Deps {
  accounts: () => ChatAccount[];
  twitchLogin: (account: TwitchAccount) => Promise<string>;
  emit: (event: ChatEvent) => void;
}

export class ChatHub {
  private readonly sources = new Map<string, ChatSource>();
  private readonly statuses = new Map<string, ChatSourceStatus>();
  private history: ChatMessage[] = [];
  private pending: ChatMessage[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private panelActive = false;
  private readonly listeners = new Set<(event: ChatEvent) => void>();
  private readonly streamListeners = new Set<(event: StreamEvent) => void>();
  private readonly seenEvents = new Set<string>();

  constructor(private readonly deps: Deps) {}

  state(): ChatState {
    return { messages: [...this.history, ...this.pending], sources: [...this.statuses.values()] };
  }

  /** The in-app chat panel is visible. */
  setActive(active: boolean): void {
    this.panelActive = active;
    this.sync();
  }

  /**
   * Extra consumers (on-stream overlays). Chat stays connected while either
   * the panel is open or at least one subscriber is attached.
   */
  subscribe(listener: (event: ChatEvent) => void): () => void {
    this.listeners.add(listener);
    this.sync();
    return () => {
      this.listeners.delete(listener);
      this.sync();
    };
  }

  /** Stream events (subs, cheers, Super Chats…) derived from chat. Does not keep chat connected by itself. */
  onStreamEvent(listener: (event: StreamEvent) => void): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  private get active(): boolean {
    return this.panelActive || this.listeners.size > 0;
  }

  /** Starts sources for new accounts and stops sources for removed ones. */
  sync(): void {
    const accounts = this.active ? this.deps.accounts() : [];
    const wanted = new Map(accounts.map((account) => [account.id, account]));
    for (const [id, source] of this.sources) {
      if (wanted.has(id)) continue;
      source.stop();
      this.sources.delete(id);
      this.statuses.delete(id);
      this.history = this.history.filter((message) => message.accountId !== id);
    }
    for (const account of accounts) {
      if (this.sources.has(account.id)) continue;
      this.statuses.set(account.id, { accountId: account.id, platform: account.platform, channelName: account.displayName, state: "connecting" });
      const source = this.createSource(account);
      this.sources.set(account.id, source);
      source.start();
    }
    this.emitSources();
  }

  stopAll(): void {
    this.panelActive = false;
    this.listeners.clear();
    this.sync();
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  private createSource(account: ChatAccount): ChatSource {
    const sink = this.sinkFor(account.id, account.platform);
    if (account.platform === "twitch") {
      return new TwitchChat(account.id, () => (account.login ? Promise.resolve(account.login) : this.deps.twitchLogin(account)), sink);
    }
    return new YouTubeChat(() => {
      const current = this.deps.accounts().find((entry) => entry.id === account.id);
      return current?.platform === "youtube" ? current : undefined;
    }, sink);
  }

  private sinkFor(accountId: string, platform: Platform): ChatSink {
    return {
      messages: (messages) => {
        this.pending.push(...messages);
        this.scheduleFlush();
      },
      remove: (ids) => {
        const removed = new Set(ids);
        this.history = this.history.filter((message) => !removed.has(message.id));
        this.pending = this.pending.filter((message) => !removed.has(message.id));
        this.publish({ type: "remove", ids });
      },
      removeAuthor: (authorId) => {
        const keep = (message: ChatMessage) => !(message.platform === platform && message.authorId === authorId);
        this.history = this.history.filter(keep);
        this.pending = this.pending.filter(keep);
        this.publish({ type: "removeAuthor", platform, authorId });
      },
      clear: () => {
        this.history = this.history.filter((message) => message.accountId !== accountId);
        this.pending = this.pending.filter((message) => message.accountId !== accountId);
        this.publish({ type: "clear", accountId });
      },
      event: (event) => {
        // Chat history replays after reconnects; announce each event once.
        if (this.seenEvents.has(event.id)) return;
        this.seenEvents.add(event.id);
        if (this.seenEvents.size > 2000) this.seenEvents.delete(this.seenEvents.values().next().value as string);
        for (const listener of this.streamListeners) listener(event);
      },
      status: ({ state, errorKey }) => {
        const current = this.statuses.get(accountId);
        if (!current || (current.state === state && current.errorKey === errorKey)) return;
        this.statuses.set(accountId, { ...current, state, errorKey });
        this.emitSources();
      },
    };
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.pending.length === 0) return;
      // Ignore duplicates (YouTube re-sends history after reconnects).
      const known = new Set(this.history.map((message) => message.id));
      const fresh = this.pending.filter((message) => !known.has(message.id) && known.add(message.id));
      this.pending = [];
      if (fresh.length === 0) return;
      this.history = [...this.history, ...fresh].slice(-HISTORY_LIMIT);
      this.publish({ type: "messages", messages: fresh });
    }, FLUSH_MS);
  }

  private publish(event: ChatEvent): void {
    this.deps.emit(event);
    for (const listener of this.listeners) listener(event);
  }

  private emitSources(): void {
    this.publish({ type: "sources", sources: [...this.statuses.values()] });
  }
}
