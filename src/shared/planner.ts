// Encoder planner: decides which destinations can share one video encode.
//
// Two destinations may share an encoder only when the encoded bitstream they
// need is identical: same canvas size, frame rate, codec, bitrate and keyframe
// cadence. Bitrate adaptation is owned by the group, so a destination that
// needs a different bitrate gets its own encoder rather than silently changing
// what the others receive.

import type { DestinationConfig, DestinationProfile } from "./types";

export interface EncoderGroup {
  index: number;
  profile: DestinationProfile;
  destinationIds: string[];
}

export interface EncoderPlan {
  groups: EncoderGroup[];
  /** Destination id -> group index. */
  assignment: Record<string, number>;
  uploadKbps: number;
}

function videoKey(profile: DestinationProfile): string {
  return [
    profile.codec,
    profile.width,
    profile.height,
    profile.fps,
    profile.videoBitrateKbps,
    profile.keyframeSec,
  ].join(":");
}

export function planEncoders(destinations: DestinationConfig[]): EncoderPlan {
  const groups: EncoderGroup[] = [];
  const byKey = new Map<string, EncoderGroup>();
  const assignment: Record<string, number> = {};

  for (const destination of destinations) {
    const key = videoKey(destination.profile);
    let group = byKey.get(key);
    if (!group) {
      group = { index: groups.length, profile: destination.profile, destinationIds: [] };
      groups.push(group);
      byKey.set(key, group);
    }
    group.destinationIds.push(destination.id);
    assignment[destination.id] = group.index;
  }

  return { groups, assignment, uploadKbps: estimateUploadKbps(destinations) };
}

/** Every destination is a separate network copy, even when the encode is shared. */
export function estimateUploadKbps(destinations: DestinationConfig[]): number {
  return destinations.reduce(
    (sum, destination) => sum + destination.profile.videoBitrateKbps + destination.profile.audioBitrateKbps,
    0,
  );
}

/** Upload to provision: payload plus 5% protocol overhead at 75% link utilization. */
export function recommendedUploadKbps(payloadKbps: number): number {
  return Math.ceil((payloadKbps * 1.05) / 0.75);
}
