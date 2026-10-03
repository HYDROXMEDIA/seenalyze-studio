// Twitch EventSub over WebSocket: follows and channel point redemptions, which
// are not part of chat. Requires the follower and redemption scopes.

import type { StreamEvent } from "../../shared/overlays";
import { createEventSubSubscription, type TwitchAccount } from "../platforms/twitch";
import { eventSubToStreamEvent } from "./twitch-eventsub-map";

const ENDPOINT = "wss://eventsub.wss.twitch.tv/ws";
const MAX_BACKOFF_MS = 60_000;

interface EventSubMessage {
  metadata?: { message_id?: string; message_type?: string; subscription_type?: string };
  payload?: {
    session?: { id?: string; reconnect_url?: string; keepalive_timeout_seconds?: number };
    event?: Record<string, unknown>;
  };
}

export type EventSubState = "connecting" | "connected" | "needsReconnect" | "offline";

export class TwitchEventSub {
  private socket: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private readonly seen = new Set<string>();

  constructor(
    private readonly account: TwitchAccount,
    private readonly onEvent: (event: StreamEvent) => void,
    private readonly onState: (state: EventSubState) => void,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect(ENDPOINT, true);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.socket?.close();
    this.socket = null;
    this.onState("offline");
  }

  private connect(url: string, subscribe: boolean): void {
    this.onState("connecting");
    const socket = new WebSocket(url);
    const previous = this.socket;
    this.socket = socket;
    socket.addEventListener("message", (raw) => {
      let message: EventSubMessage;
      try {
        message = JSON.parse(String(raw.data)) as EventSubMessage;
      } catch (error) {
        console.warn("[eventsub] unreadable message", error);
        return;
      }
      this.armWatchdog(message.payload?.session?.keepalive_timeout_seconds);
      switch (message.metadata?.message_type) {
        case "session_welcome": {
          // On a reconnect handoff the new socket inherits subscriptions; close the old one.
          if (previous && previous !== socket) previous.close();
          const sessionId = message.payload?.session?.id;
          if (subscribe && sessionId) void this.subscribe(sessionId);
          else this.onState("connected");
          this.attempt = 0;
          break;
        }
        case "session_reconnect":
          if (message.payload?.session?.reconnect_url) this.connect(message.payload.session.reconnect_url, false);
          break;
        case "notification": {
          const id = message.metadata.message_id ?? "";
          if (!id || this.seen.has(id)) return;
          this.seen.add(id);
          if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value as string);
          const event = eventSubToStreamEvent(message.metadata.subscription_type, id, message.payload?.event ?? {});
          if (event) this.onEvent(event);
          break;
        }
        default:
          break;
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      this.retry();
    });
    socket.addEventListener("error", (event) => console.warn("[eventsub] connection error", event.type));
  }

  private async subscribe(sessionId: string): Promise<void> {
    const id = this.account.channelId;
    try {
      await createEventSubSubscription(this.account, sessionId, "channel.follow", "2", { broadcaster_user_id: id, moderator_user_id: id });
      await createEventSubSubscription(this.account, sessionId, "channel.channel_points_custom_reward_redemption.add", "1", { broadcaster_user_id: id });
      this.onState("connected");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      console.warn("[eventsub] subscription failed", code);
      if (code === "twitch-scope-missing" || code === "account-signed-out") {
        // Retrying cannot help until the user reconnects with the new scopes.
        this.onState("needsReconnect");
        this.stopped = true;
        this.socket?.close();
        return;
      }
      this.socket?.close();
    }
  }

  /** Twitch sends keepalives; silence past the timeout means the socket is dead. */
  private armWatchdog(seconds: number | undefined): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    const timeout = ((seconds ?? 10) + 5) * 1000;
    this.watchdog = setTimeout(() => this.socket?.close(), timeout);
  }

  private retry(): void {
    if (this.stopped || this.timer) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect(ENDPOINT, true);
    }, delay);
  }
}
