// YouTube live chat. Chat only exists while a broadcast is live, so the source
// waits for an active broadcast, then polls at the interval YouTube asks for.
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

  constructor(
    private readonly account: () => YouTubeAccount | undefined,
    private readonly sink: ChatSink,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.sink.status({ state: "connecting" });
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
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
    const account = this.account();
    if (this.stopped || !account) return;
    try {
      if (!this.liveChatId) {
        this.liveChatId = await activeLiveChatId(account);
        if (!this.liveChatId) {
          this.sink.status({ state: "waiting" });
          this.schedule(IDLE_CHECK_MS);
          return;
        }
        this.pageToken = undefined;
      }
      const page = await listChatMessages(account, this.liveChatId, this.pageToken);
      if (this.stopped) return;
      this.pageToken = page.nextPageToken;
      this.sink.status({ state: "connected" });
      this.dispatch(page.items, account.id);
      if (page.offlineAt) {
        this.liveChatId = null;
        this.schedule(IDLE_CHECK_MS);
        return;
      }
      this.schedule(Math.max(MIN_POLL_MS, page.pollingIntervalMillis ?? MIN_POLL_MS));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "youtube-chat-ended") {
        this.liveChatId = null;
        this.sink.status({ state: "waiting" });
        this.schedule(IDLE_CHECK_MS);
        return;
      }
      console.error("[chat] YouTube chat request failed", error);
      const errorKey =
        code === "youtube-quota-exceeded" ? "quota" : code === "youtube-chat-disabled" ? "disabled" : code === "account-signed-out" ? "signedOut" : "unavailable";
      this.sink.status({ state: "error", errorKey });
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
