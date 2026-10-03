import type { Platform } from "../../shared/types";
import youtubeIcon from "@/assets/icons/youtube.png";
import { cn } from "@/lib/utils";

/** Twitch glitch mark, drawn inline because the shared icon set has no Twitch asset. */
function TwitchMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#9146FF"
        d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"
      />
    </svg>
  );
}

export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  if (platform === "youtube") return <img src={youtubeIcon} alt="" draggable={false} className={cn("size-5 object-contain", className)} />;
  return <TwitchMark className={cn("size-5", className)} />;
}
