// Pure mapping from YouTube live chat items to chat messages (no I/O).

import type { StreamEvent } from "../../shared/overlays";
import type { ChatBadge, ChatMessage } from "../../shared/types";
import type { YouTubeChatItem } from "../platforms/youtube";

export function youtubeBadges(author: YouTubeChatItem["authorDetails"]): ChatBadge[] {
  const badges: ChatBadge[] = [];
  if (author?.isChatOwner) badges.push("owner");
  if (author?.isChatModerator) badges.push("moderator");
  if (author?.isChatSponsor) badges.push("member");
  if (author?.isVerified) badges.push("verified");
  return badges;
}

/** Maps a YouTube chat item to a chat message, or null for non-message events. */
export function youtubeItemToMessage(item: YouTubeChatItem, accountId: string): ChatMessage | null {
  const { snippet, authorDetails } = item;
  const base = {
    id: `youtube:${item.id}`,
    platform: "youtube" as const,
    accountId,
    authorId: authorDetails?.channelId ?? snippet.authorChannelId ?? "",
    authorName: authorDetails?.displayName ?? "",
    avatarUrl: authorDetails?.profileImageUrl,
    badges: youtubeBadges(authorDetails),
    timestamp: Date.parse(snippet.publishedAt) || Date.now(),
  };
  const text = (value: string | undefined) => (value ? [{ type: "text" as const, text: value }] : []);
  switch (snippet.type) {
    case "textMessageEvent":
      return { ...base, segments: text(snippet.displayMessage) };
    case "superChatEvent":
      return {
        ...base,
        segments: text(snippet.superChatDetails?.userComment),
        highlight: { kind: "paid", label: snippet.superChatDetails?.amountDisplayString ?? "" },
      };
    case "superStickerEvent":
      return { ...base, segments: [], highlight: { kind: "paid", label: snippet.superStickerDetails?.amountDisplayString ?? "" } };
    case "newSponsorEvent":
    case "memberMilestoneChatEvent":
    case "membershipGiftingEvent":
    case "giftMembershipReceivedEvent":
      return {
        ...base,
        segments: text(snippet.memberMilestoneChatDetails?.userComment),
        highlight: { kind: "membership", label: snippet.displayMessage ?? "" },
      };
    default:
      return null;
  }
}

/** Maps paid and membership chat items to stream events (plain messages map to null). */
export function youtubeItemToEvent(item: YouTubeChatItem): StreamEvent | null {
  const { snippet, authorDetails } = item;
  const base = {
    id: `youtube:${item.id}`,
    platform: "youtube" as const,
    userName: authorDetails?.displayName ?? "",
    timestamp: Date.parse(snippet.publishedAt) || Date.now(),
  };
  const micros = (value: unknown) => (typeof value === "string" || typeof value === "number" ? Number(value) / 1_000_000 : undefined);
  switch (snippet.type) {
    case "superChatEvent":
      return { ...base, type: "superChat", amount: micros(snippet.superChatDetails?.amountMicros), amountLabel: snippet.superChatDetails?.amountDisplayString, message: snippet.superChatDetails?.userComment };
    case "superStickerEvent":
      return { ...base, type: "superSticker", amount: micros(snippet.superStickerDetails?.amountMicros), amountLabel: snippet.superStickerDetails?.amountDisplayString };
    case "newSponsorEvent":
      return { ...base, type: "membership", tier: snippet.newSponsorDetails?.memberLevelName };
    case "memberMilestoneChatEvent":
      return { ...base, type: "memberMilestone", months: snippet.memberMilestoneChatDetails?.memberMonth, message: snippet.memberMilestoneChatDetails?.userComment };
    case "membershipGiftingEvent":
      return { ...base, type: "giftMembership", count: snippet.membershipGiftingDetails?.giftMembershipsCount };
    default:
      return null;
  }
}
