import { describe, expect, test } from "bun:test";
import { parseIrcLine, twitchSegments } from "./twitch-chat";
import { youtubeItemToMessage } from "./youtube-map";

describe("Twitch IRC parsing", () => {
  test("parses tags, prefix, command and trailing text", () => {
    const line =
      "@badges=moderator/1,subscriber/12;color=#1E90FF;display-name=Viewer;emotes=25:0-4;id=abc-123;tmi-sent-ts=1700000000000;user-id=42 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #channel :Kappa hello there";
    const message = parseIrcLine(line);
    expect(message?.command).toBe("PRIVMSG");
    expect(message?.params).toEqual(["#channel", "Kappa hello there"]);
    expect(message?.tags["display-name"]).toBe("Viewer");
    expect(message?.prefix.split("!")[0]).toBe("viewer");
  });

  test("unescapes tag values", () => {
    const message = parseIrcLine("@system-msg=Viewer\\ssubscribed\\:\\sthanks :tmi.twitch.tv USERNOTICE #channel");
    expect(message?.tags["system-msg"]).toBe("Viewer subscribed; thanks");
  });

  test("handles PING without tags or prefix", () => {
    expect(parseIrcLine("PING :tmi.twitch.tv")).toEqual({ tags: {}, prefix: "", command: "PING", params: ["tmi.twitch.tv"] });
  });
});

describe("Twitch emote segments", () => {
  test("splits text and emotes", () => {
    const segments = twitchSegments("Kappa hi Kappa", "25:0-4,9-13");
    expect(segments.map((segment) => segment.type)).toEqual(["emote", "text", "emote"]);
    expect(segments[1]).toEqual({ type: "text", text: " hi " });
  });

  test("uses code point positions so emoji before an emote do not shift it", () => {
    const segments = twitchSegments("😀 Kappa", "25:2-6");
    expect(segments).toEqual([
      { type: "text", text: "😀 " },
      { type: "emote", name: "Kappa", url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0" },
    ]);
  });

  test("ignores out-of-range emote positions", () => {
    expect(twitchSegments("hi", "25:0-40")).toEqual([{ type: "text", text: "hi" }]);
  });
});

describe("YouTube chat mapping", () => {
  const author = { channelId: "UC1", displayName: "Fan", profileImageUrl: "https://yt3.ggpht.com/a.jpg", isChatModerator: true };

  test("maps text messages", () => {
    const message = youtubeItemToMessage(
      { id: "m1", snippet: { type: "textMessageEvent", publishedAt: "2026-10-03T10:00:00Z", displayMessage: "hello" }, authorDetails: author },
      "youtube:UC0",
    );
    expect(message).toMatchObject({ id: "youtube:m1", platform: "youtube", authorName: "Fan", badges: ["moderator"] });
    expect(message?.segments).toEqual([{ type: "text", text: "hello" }]);
  });

  test("marks Super Chats as paid with the amount", () => {
    const message = youtubeItemToMessage(
      {
        id: "m2",
        snippet: { type: "superChatEvent", publishedAt: "2026-10-03T10:00:00Z", superChatDetails: { amountDisplayString: "$5.00", userComment: "great" } },
        authorDetails: author,
      },
      "youtube:UC0",
    );
    expect(message?.highlight).toEqual({ kind: "paid", label: "$5.00" });
  });

  test("returns null for events that are not messages", () => {
    expect(youtubeItemToMessage({ id: "m3", snippet: { type: "pollEvent", publishedAt: "2026-10-03T10:00:00Z" } }, "youtube:UC0")).toBeNull();
  });
});
