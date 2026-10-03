// Twitch chat over Twitch's IRC WebSocket. Reading a public channel's chat
// needs no token (anonymous "justinfan" login), so no extra scope is requested.

import type { ChatBadge, ChatMessage, ChatSegment } from "../../shared/types";
import type { StreamEvent } from "../../shared/overlays";
import type { ChatSink, ChatSource } from "./types";

const ENDPOINT = "wss://irc-ws.chat.twitch.tv:443";
const MAX_BACKOFF_MS = 30_000;
const EMOTE_URL = (id: string) => `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`;

interface IrcMessage {
  tags: Record<string, string>;
  prefix: string;
  command: string;
  params: string[];
}

/** Parses one IRC line with IRCv3 tags. */
export function parseIrcLine(line: string): IrcMessage | null {
  let rest = line;
  const tags: Record<string, string> = {};
  if (rest.startsWith("@")) {
    const end = rest.indexOf(" ");
    for (const pair of rest.slice(1, end).split(";")) {
      const eq = pair.indexOf("=");
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const raw = eq === -1 ? "" : pair.slice(eq + 1);
      tags[key] = raw.replace(/\\s/gu, " ").replace(/\\:/gu, ";").replace(/\\\\/gu, "\\").replace(/\\r/gu, "\r").replace(/\\n/gu, "\n");
    }
    rest = rest.slice(end + 1);
  }
  let prefix = "";
  if (rest.startsWith(":")) {
    const end = rest.indexOf(" ");
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }
  const trailingIndex = rest.indexOf(" :");
  const head = trailingIndex === -1 ? rest : rest.slice(0, trailingIndex);
  const params = head.split(" ").filter(Boolean);
  const command = params.shift();
  if (!command) return null;
  if (trailingIndex !== -1) params.push(rest.slice(trailingIndex + 2));
  return { tags, prefix, command, params };
}

/** Splits a message into text and emote segments using the `emotes` tag. */
export function twitchSegments(text: string, emotesTag: string | undefined): ChatSegment[] {
  // Twitch emote ranges are code point indexes, so work on code points.
  const chars = Array.from(text);
  const ranges: { start: number; end: number; id: string }[] = [];
  for (const entry of (emotesTag ?? "").split("/").filter(Boolean)) {
    const [id, positions] = entry.split(":");
    for (const position of (positions ?? "").split(",")) {
      const [start, end] = position.split("-").map(Number);
      if (Number.isInteger(start) && Number.isInteger(end) && end >= start && end < chars.length) ranges.push({ start, end, id });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const segments: ChatSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) segments.push({ type: "text", text: chars.slice(cursor, range.start).join("") });
    segments.push({ type: "emote", name: chars.slice(range.start, range.end + 1).join(""), url: EMOTE_URL(range.id) });
    cursor = range.end + 1;
  }
  if (cursor < chars.length) segments.push({ type: "text", text: chars.slice(cursor).join("") });
  return segments;
}

/** Maps a Twitch USERNOTICE (subs, gifts, raids) to a stream event. */
export function twitchNoticeEvent(message: { tags: Record<string, string>; params: string[] }): StreamEvent | null {
  const { tags } = message;
  const userName = tags["display-name"] || tags.login || "";
  const base = { id: `twitch:${tags.id ?? `${Date.now()}`}`, platform: "twitch" as const, userName, timestamp: Number(tags["tmi-sent-ts"]) || Date.now() };
  const tier = tags["msg-param-sub-plan"];
  const text = message.params[1] || undefined;
  switch (tags["msg-id"]) {
    case "sub":
      return { ...base, type: "subscription", tier, message: text };
    case "resub":
      return { ...base, type: "resub", tier, months: Number(tags["msg-param-cumulative-months"]) || undefined, message: text };
    case "submysterygift":
      return { ...base, type: "giftSub", tier, count: Number(tags["msg-param-mass-gift-count"]) || 1 };
    case "subgift":
      // Part of a mass gift arrives as individual subgift notices too; only count standalone gifts.
      return tags["msg-param-community-gift-id"] ? null : { ...base, type: "giftSub", tier, count: 1 };
    case "raid":
      return { ...base, userName: tags["msg-param-displayName"] || userName, type: "raid", count: Number(tags["msg-param-viewerCount"]) || 0 };
    default:
      return null;
  }
}

function twitchBadges(tag: string | undefined): ChatBadge[] {
  const badges: ChatBadge[] = [];
  for (const badge of (tag ?? "").split(",")) {
    const name = badge.split("/")[0];
    if (name === "broadcaster") badges.push("owner");
    else if (name === "moderator") badges.push("moderator");
    else if (name === "vip") badges.push("vip");
    else if (name === "subscriber" || name === "founder") badges.push("subscriber");
    else if (name === "partner") badges.push("verified");
  }
  return [...new Set(badges)];
}

export class TwitchChat implements ChatSource {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(
    private readonly accountId: string,
    private readonly login: () => Promise<string>,
    private readonly sink: ChatSink,
  ) {}

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.sink.status({ state: "offline" });
  }

  private async connect(): Promise<void> {
    this.sink.status({ state: "connecting" });
    let channel: string;
    try {
      channel = (await this.login()).toLowerCase();
    } catch (error) {
      console.error("[chat] could not resolve the Twitch channel", error);
      this.sink.status({ state: "error", errorKey: "unavailable" });
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const socket = new WebSocket(ENDPOINT);
    this.socket = socket;
    socket.addEventListener("open", () => {
      socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      socket.send("PASS SCHMOOPIIE");
      socket.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      socket.send(`JOIN #${channel}`);
    });
    socket.addEventListener("message", (event) => {
      for (const line of String(event.data).split("\r\n")) if (line) this.onLine(line, socket);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.stopped) {
        this.sink.status({ state: "connecting" });
        this.scheduleReconnect();
      }
    });
    socket.addEventListener("error", (event) => console.warn("[chat] Twitch connection error", event.type));
  }

  private onLine(line: string, socket: WebSocket): void {
    const message = parseIrcLine(line);
    if (!message) return;
    switch (message.command) {
      case "PING":
        socket.send(`PONG :${message.params[0] ?? "tmi.twitch.tv"}`);
        break;
      case "JOIN":
      case "ROOMSTATE":
        this.attempt = 0;
        this.sink.status({ state: "connected" });
        break;
      case "RECONNECT":
        socket.close();
        break;
      case "PRIVMSG": {
        const chat = this.toMessage(message);
        this.sink.messages([chat]);
        const bits = Number(message.tags.bits);
        if (bits > 0) {
          this.sink.event({ id: `${chat.id}:bits`, platform: "twitch", type: "cheer", userName: chat.authorName, amount: bits,
            amountLabel: `${bits} bits`, message: chat.segments.map((segment) => (segment.type === "text" ? segment.text : segment.name)).join(""), timestamp: chat.timestamp });
        }
        break;
      }
      case "USERNOTICE": {
        const notice = this.toNotice(message);
        if (notice) this.sink.messages([notice]);
        const event = twitchNoticeEvent(message);
        if (event) this.sink.event(event);
        break;
      }
      case "CLEARMSG":
        if (message.tags["target-msg-id"]) this.sink.remove([`twitch:${message.tags["target-msg-id"]}`]);
        break;
      case "CLEARCHAT":
        if (message.tags["target-user-id"]) this.sink.removeAuthor(message.tags["target-user-id"]);
        else this.sink.clear();
        break;
      default:
        break;
    }
  }

  private toMessage(message: IrcMessage): ChatMessage {
    const { tags } = message;
    let text = message.params[1] ?? "";
    // "/me" actions arrive wrapped in CTCP ACTION markers.
    const ACTION_MARK = String.fromCharCode(1);
    if (text.startsWith(`${ACTION_MARK}ACTION `) && text.endsWith(ACTION_MARK)) text = text.slice(8, -1);
    const login = message.prefix.split("!")[0] ?? "";
    return {
      id: `twitch:${tags.id ?? `${Date.now()}-${Math.random()}`}`,
      platform: "twitch",
      accountId: this.accountId,
      authorId: tags["user-id"] ?? login,
      authorName: tags["display-name"] || login,
      authorColor: /^#[0-9a-f]{6}$/iu.test(tags.color ?? "") ? tags.color : undefined,
      badges: twitchBadges(tags.badges),
      segments: twitchSegments(text, tags.emotes),
      timestamp: Number(tags["tmi-sent-ts"]) || Date.now(),
    };
  }

  private toNotice(message: IrcMessage): ChatMessage | null {
    const { tags } = message;
    const kind = tags["msg-id"];
    const label = tags["system-msg"];
    if (!label) return null;
    const base = this.toMessage({ ...message, params: [message.params[0] ?? "", message.params[1] ?? ""] });
    const subscription = kind === "sub" || kind === "resub" || kind === "subgift" || kind === "submysterygift";
    return { ...base, highlight: { kind: subscription ? "subscription" : "announcement", label } };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt) * (0.8 + Math.random() * 0.4);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
