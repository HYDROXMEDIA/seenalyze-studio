// Pure mapping from Twitch EventSub notifications to stream events (no I/O).

import type { StreamEvent } from "../../shared/overlays";

/** Maps an EventSub notification to a stream event. */
export function eventSubToStreamEvent(type: string | undefined, messageId: string, event: Record<string, unknown>): StreamEvent | null {
  const userName = String(event.user_name ?? event.user_login ?? "");
  const timestamp = Date.parse(String(event.followed_at ?? event.redeemed_at ?? "")) || Date.now();
  if (type === "channel.follow") return { id: `twitch:${messageId}`, platform: "twitch", type: "follow", userName, timestamp };
  if (type === "channel.channel_points_custom_reward_redemption.add") {
    const reward = event.reward as { title?: unknown } | undefined;
    return { id: `twitch:${messageId}`, platform: "twitch", type: "redemption", userName, message: String(reward?.title ?? ""), timestamp };
  }
  return null;
}
