import { ArrowDownIcon, BadgeCheckIcon, CrownIcon, GemIcon, ShieldIcon, StarIcon, type LucideIcon } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { ChatBadge, ChatMessage, ChatSourceStatus } from "../../shared/types";
import connectIcon from "@/assets/icons/connect.png";
import { PlatformIcon } from "@/components/PlatformIcon";
import { studio } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat";
import { useStudio } from "@/store/studio";

type Tab = "all" | string;

const BADGE_ICONS: Record<ChatBadge, { icon: LucideIcon; className: string }> = {
  owner: { icon: CrownIcon, className: "text-amber-500" },
  moderator: { icon: ShieldIcon, className: "text-emerald-500" },
  vip: { icon: GemIcon, className: "text-pink-500" },
  member: { icon: StarIcon, className: "text-sky-500" },
  subscriber: { icon: StarIcon, className: "text-violet-500" },
  verified: { icon: BadgeCheckIcon, className: "text-muted-foreground" },
};

/** Distinct, readable name colors for authors without their own color. */
const FALLBACK_COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb7185", "#22d3ee", "#a3e635"];

function fallbackColor(authorId: string): string {
  let hash = 0;
  for (const char of authorId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

const NEAR_BOTTOM_PX = 48;

export function ChatPanel() {
  const t = useTranslations("chat");
  const accounts = useStudio((state) => state.snapshot?.accounts ?? []);
  const messages = useChat((state) => state.messages);
  const sources = useChat((state) => state.sources);
  const load = useChat((state) => state.load);
  const [tab, setTab] = useState<Tab>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const lastCount = useRef(0);

  // Connect while the panel is visible; the chat hub disconnects when hidden.
  useEffect(() => {
    let cancelled = false;
    void studio.setChatActive(true).catch(console.error);
    void studio
      .getChat()
      .then((state) => {
        if (!cancelled) load(state);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
      void studio.setChatActive(false).catch(console.error);
    };
  }, [load]);

  const activeTab = tab === "all" || accounts.some((account) => account.id === tab) ? tab : "all";
  const visible = useMemo(() => (activeTab === "all" ? messages : messages.filter((message) => message.accountId === activeTab)), [messages, activeTab]);

  // Stick to the newest message unless the user scrolled up to read.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const added = Math.max(0, visible.length - lastCount.current);
    lastCount.current = visible.length;
    if (pinnedRef.current) list.scrollTop = list.scrollHeight;
    else if (added > 0) setUnseen((count) => count + added);
  }, [visible]);

  const selectTab = (next: Tab) => {
    // A different tab is a different list; start it at the newest message.
    pinnedRef.current = true;
    lastCount.current = 0;
    setUnseen(0);
    setTab(next);
  };

  const jumpToLatest = () => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    pinnedRef.current = true;
    setUnseen(0);
  };

  const sourceFor = (accountId: string) => sources.find((source) => source.accountId === accountId);
  const problems = sources.filter((source) => source.state !== "connected" && (activeTab === "all" || source.accountId === activeTab));

  return (
    <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-xl border bg-card" aria-label={t("title")}>
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
      </header>

      {accounts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <img src={connectIcon} alt="" className="size-12" draggable={false} />
          <p className="text-sm text-muted-foreground">{t("noAccounts")}</p>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 gap-1 border-b p-1.5" role="tablist" aria-label={t("title")}>
            <TabButton active={activeTab === "all"} onClick={() => selectTab("all")} label={t("all")}>
              <span className="flex -space-x-1">
                {[...new Set(accounts.map((account) => account.platform))].map((platform) => (
                  <PlatformIcon key={platform} platform={platform} className="size-4 rounded-full bg-card ring-2 ring-card" />
                ))}
              </span>
            </TabButton>
            {accounts.map((account) => (
              <TabButton key={account.id} active={activeTab === account.id} onClick={() => selectTab(account.id)} label={account.displayName} status={sourceFor(account.id)}>
                <PlatformIcon platform={account.platform} className="size-4" />
              </TabButton>
            ))}
          </div>

          {problems.length > 0 && (
            <ul className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
              {problems.map((source) => (
                <li key={source.accountId} className="flex items-center gap-2 py-0.5">
                  <PlatformIcon platform={source.platform} className="size-3.5" />
                  <span className="truncate">
                    {source.state === "error" && source.errorKey ? t(`errors.${source.errorKey}`) : t(`states.${source.state}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="relative min-h-0 flex-1">
            <div
              ref={listRef}
              className="h-full overflow-y-auto px-2 py-2"
              role="log"
              aria-live="polite"
              aria-label={t("messages")}
              onScroll={(event) => {
                const list = event.currentTarget;
                const pinned = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
                pinnedRef.current = pinned;
                if (pinned) setUnseen(0);
              }}
            >
              {visible.length === 0 ? (
                <p className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
              ) : (
                visible.map((message) => <ChatRow key={message.id} message={message} />)
              )}
            </div>
            {unseen > 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                <button
                  type="button"
                  onClick={jumpToLatest}
                  className="animate-chat-in pointer-events-auto flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <ArrowDownIcon className="size-3.5" />
                  {t("newMessages", { count: unseen })}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  label,
  status,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  status?: ChatSourceStatus;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active && "bg-accent font-medium",
      )}
    >
      {children}
      <span className="truncate">{label}</span>
      {status && (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            status.state === "connected" ? "bg-brand-green" : status.state === "error" ? "bg-red-500" : "bg-muted-foreground/50",
          )}
        />
      )}
    </button>
  );
}

const ChatRow = memo(function ChatRow({ message }: { message: ChatMessage }) {
  const t = useTranslations("chat");
  const color = message.authorColor ?? fallbackColor(message.authorId);
  const highlight = message.highlight;

  return (
    <div
      className={cn(
        "animate-chat-in group mb-1 flex gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50",
        highlight?.kind === "paid" && "border border-amber-400/40 bg-amber-400/10",
        (highlight?.kind === "membership" || highlight?.kind === "subscription") && "border border-violet-400/40 bg-violet-400/10",
        highlight?.kind === "announcement" && "border border-sky-400/40 bg-sky-400/10",
      )}
    >
      <div className="relative mt-0.5 size-7 shrink-0">
        {message.avatarUrl ? (
          <img src={message.avatarUrl} alt="" className="size-7 rounded-full object-cover" draggable={false} referrerPolicy="no-referrer" />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: color }} aria-hidden>
            {message.authorName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="absolute -right-1 -bottom-1 rounded-full bg-card p-px" title={t(`platforms.${message.platform}`)}>
          <PlatformIcon platform={message.platform} className="size-3.5" />
        </span>
      </div>
      <div className="min-w-0 flex-1 text-sm leading-snug">
        {highlight && (
          <p className="mb-0.5 text-xs font-semibold text-foreground/80">
            {highlight.kind === "paid" ? <span className="rounded bg-amber-400 px-1.5 py-px text-black">{highlight.label}</span> : highlight.label}
          </p>
        )}
        <span className="mr-1 inline-flex items-center gap-0.5 align-middle">
          {message.badges.map((badge) => {
            const { icon: Icon, className } = BADGE_ICONS[badge];
            return <Icon key={badge} className={cn("size-3.5", className)} aria-label={t(`badges.${badge}`)} />;
          })}
          <span className="font-semibold" style={{ color }}>
            {message.authorName}
          </span>
        </span>
        <span className="break-words text-foreground/90 select-text">
          {message.segments.map((segment, index) =>
            segment.type === "emote" ? (
              <img
                // Emote order is stable within a message.
                key={`${segment.url}-${index}`}
                src={segment.url}
                alt={segment.name}
                title={segment.name}
                className="mx-0.5 inline-block h-6 w-auto align-middle"
                draggable={false}
              />
            ) : (
              <span key={`text-${index}`}>{segment.text}</span>
            ),
          )}
        </span>
      </div>
    </div>
  );
});
