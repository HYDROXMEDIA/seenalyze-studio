// YouTube live chat. When the studio knows the broadcast it streams into (one
// picked from YouTube Studio or one it created), chat connects to it at once,
// even before it goes live. Otherwise the source waits for an active
// broadcast. Either way it polls at the interval YouTube asks for.
// Every request counts against the app's daily YouTube API quota, which is
// why idle checks are slow and polling never runs faster than YouTube allows.

import type { ChatMessage } from "../../shared/types";
import { activeLiveChatId, listChatMessages, type YouTubeAccount, type YouTubeChatItem } from "../platforms/youtube";
import { youtubeItemToEvent, youtubeItemToMessage } from "./youtube-map";
import type { ChatSink, ChatSource } from "./types";

const IDLE_CHECK_MS = 30_000;
const MIN_POLL_MS = 3_000;
const ERROR_RETRY_MS = 60_000;

export class YouTubeChat implements ChatSource {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private liveChatId: string | null = null;
  private pageToken: string | undefined;
  /** Bumped on every start, stop and retarget; a request from an older round must not change state. */
  private generation = 0;
  /** Chats that ended; never reconnected to, so a finished broadcast doesn't block the active one. */
  private readonly ended = new Set<string>();

  constructor(
    private readonly account: () => YouTubeAccount | undefined,
    private readonly sink: ChatSink,
    /** Chat of the broadcast the studio is about to stream or is streaming into. */
    private readonly preferredChatId: () => string | undefined = () => undefined,
  ) {}

  /** The studio's broadcast changed: look up the chat again right away. */
  retarget(): void {
    if (this.stopped) return;
    const preferred = this.preferredChatId();
    if (preferred && preferred === this.liveChatId) return;
    this.generation += 1;
    this.liveChatId = null;
    this.pageToken = undefined;
    this.sink.status({ state: "connecting" });
    this.schedule(0);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.generation += 1;
    this.sink.status({ state: "connecting" });
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.liveChatId = null;
    this.pageToken = undefined;
    this.sink.status({ state: "offline" });
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const account = this.account();
    if (!account) {
      // The account was disconnected while chat was open: say so instead of showing "connecting" forever,
      // and look again later in case it is connected again.
      this.sink.status({ state: "error", errorKey: "signedOut" });
      this.schedule(ERROR_RETRY_MS);
      return;
    }
    const generation = this.generation;
    const current = () => !this.stopped && generation === this.generation;
    try {
      if (!this.liveChatId) {
        const preferred = this.preferredChatId();
        const found = preferred && !this.ended.has(preferred) ? preferred : await activeLiveChatId(account);
        if (!current()) return;
        this.liveChatId = found && !this.ended.has(found) ? found : null;
        if (!this.liveChatId) {
          this.sink.status({ state: "waiting" });
          this.schedule(IDLE_CHECK_MS);
          return;
        }
        this.pageToken = undefined;
      }
      const page = await listChatMessages(account, this.liveChatId, this.pageToken);
      if (!current()) return;
      this.pageToken = page.nextPageToken;
      this.sink.status({ state: "connected" });
      this.dispatch(page.items, account.id);
      if (page.offlineAt) {
        this.ended.add(this.liveChatId);
        this.liveChatId = null;
        this.schedule(IDLE_CHECK_MS);
        return;
      }
      this.schedule(Math.max(MIN_POLL_MS, page.pollingIntervalMillis ?? MIN_POLL_MS));
    } catch (error) {
      // A request from a chat that was replaced meanwhile says nothing about the current one.
      if (!current()) return;
      const code = error instanceof Error ? error.message : "";
      if (code === "youtube-chat-ended") {
        if (this.liveChatId) this.ended.add(this.liveChatId);
        this.liveChatId = null;
        this.sink.status({ state: "waiting" });
        this.schedule(IDLE_CHECK_MS);
        return;
      }
      console.error("[chat] YouTube chat request failed", error);
      const errorKey =
        code === "youtube-quota-exceeded" ? "quota" : code === "youtube-chat-disabled" ? "disabled" : code === "account-signed-out" ? "signedOut" : "unavailable";
      this.sink.status({ state: "error", errorKey });
      // The next attempt starts from the newest messages, in case the saved page position is what failed.
      this.pageToken = undefined;
      this.schedule(ERROR_RETRY_MS);
    }
  }

  private dispatch(items: YouTubeChatItem[], accountId: string): void {
    const messages: ChatMessage[] = [];
    const removed: string[] = [];
    for (const item of items) {
      if (item.snippet.type === "messageDeletedEvent" && item.snippet.messageDeletedDetails?.deletedMessageId) {
        removed.push(`youtube:${item.snippet.messageDeletedDetails.deletedMessageId}`);
        continue;
      }
      if (item.snippet.type === "userBannedEvent" && item.snippet.userBannedDetails?.bannedUserDetails?.channelId) {
        this.sink.removeAuthor(item.snippet.userBannedDetails.bannedUserDetails.channelId);
        continue;
      }
      const message = youtubeItemToMessage(item, accountId);
      if (message) messages.push(message);
      const event = youtubeItemToEvent(item);
      if (event) this.sink.event(event);
    }
    if (messages.length) this.sink.messages(messages);
    if (removed.length) this.sink.remove(removed);
  }
}
