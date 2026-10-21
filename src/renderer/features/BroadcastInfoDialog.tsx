import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { BroadcastInfo, CategoryOption, DestinationConfig, YouTubeBroadcastOption } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { BROADCAST_PRIVACY, broadcastPrivacy } from "@/lib/limits";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";

const NEW_BROADCAST = "new";

/** Title, category (Twitch) and privacy (YouTube) for an account destination. */
export function BroadcastInfoDialog({ destination, onClose }: { destination: DestinationConfig | null; onClose: () => void }) {
  return (
    <Dialog open={destination !== null} onOpenChange={(open) => !open && onClose()}>
      {destination && <InfoForm destination={destination} onClose={onClose} />}
    </Dialog>
  );
}

function InfoForm({ destination, onClose }: { destination: DestinationConfig; onClose: () => void }) {
  const t = useTranslations("streamInfo");
  const tc = useTranslations("common");
  const run = useAction();
  const [info, setInfo] = useState<BroadcastInfo | null>(null);
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [pending, setPending] = useState(false);
  const [broadcasts, setBroadcasts] = useState<YouTubeBroadcastOption[] | null>(destination.platform === "youtube" ? null : []);
  // Saving a form that never loaded would overwrite the live title and drop the picked broadcast.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void run(() => studio.getBroadcastInfo(destination.id)).then((result) => {
      if (cancelled) return;
      if (result) setInfo(result);
      else setLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [destination.id, run, attempt]);

  useEffect(() => {
    if (destination.platform !== "youtube") return;
    let cancelled = false;
    void run(() => studio.listYouTubeBroadcasts(destination.id)).then((result) => {
      if (cancelled) return;
      if (result) setBroadcasts(result);
      else setLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [destination.id, destination.platform, run, attempt]);

  useEffect(() => {
    if (destination.platform !== "twitch" || !destination.accountId || query.trim().length < 2) return;
    const accountId = destination.accountId;
    const timer = window.setTimeout(() => {
      void run(() => studio.searchCategories(accountId, query)).then((result) => setCategories(result ?? []));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, destination.platform, destination.accountId, run]);

  if (loadFailed) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("loadFailed")}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setLoadFailed(false);
              setInfo(null);
              if (destination.platform === "youtube") setBroadcasts(null);
              setAttempt((value) => value + 1);
            }}
          >
            {tc("retry")}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  if (!info || !broadcasts) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="flex h-24 items-center justify-center">
          <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" aria-label={tc("loading")} />
        </div>
      </DialogContent>
    );
  }

  // A broadcast that has started or ended since it was picked is no longer offered.
  const picked = info.youtubeBroadcastId && broadcasts.some((broadcast) => broadcast.id === info.youtubeBroadcastId) ? info.youtubeBroadcastId : undefined;

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        {destination.platform === "youtube" && (
          <Field label={t("broadcast")} htmlFor="broadcast-pick">
            <Select
              value={picked ?? NEW_BROADCAST}
              onValueChange={(value) => setInfo({ ...info, youtubeBroadcastId: value === NEW_BROADCAST ? undefined : value })}
            >
              <SelectTrigger id="broadcast-pick">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_BROADCAST}>{t("newBroadcast")}</SelectItem>
                {broadcasts.map((broadcast) => (
                  <SelectItem key={broadcast.id} value={broadcast.id}>
                    {broadcast.scheduledStartTime
                      ? t("scheduledBroadcast", { title: broadcast.title, start: new Date(broadcast.scheduledStartTime) })
                      : broadcast.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {!picked && (
          <Field label={t("streamTitle")} htmlFor="broadcast-title">
            <Input id="broadcast-title" value={info.title} maxLength={140} onChange={(event) => setInfo({ ...info, title: event.target.value })} />
          </Field>
        )}

        {destination.platform === "twitch" && (
          <Field label={t("category")} htmlFor="broadcast-category">
            <Input
              id="broadcast-category"
              value={query}
              placeholder={info.categoryName ?? t("searchCategory")}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query.trim().length >= 2 && categories.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-md border" role="listbox" aria-label={t("category")}>
                {categories.map((category) => (
                  <li key={category.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={category.id === info.categoryId}
                      className={cn(
                        "w-full px-3 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        category.id === info.categoryId && "bg-accent",
                      )}
                      onClick={() => {
                        setInfo({ ...info, categoryId: category.id, categoryName: category.name });
                        setQuery("");
                        setCategories([]);
                      }}
                    >
                      {category.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        )}

        {destination.platform === "youtube" && !picked && (
          <Field label={t("privacy")} htmlFor="broadcast-privacy">
            <Select value={broadcastPrivacy(info.privacy)} onValueChange={(value) => setInfo({ ...info, privacy: broadcastPrivacy(value) })}>
              <SelectTrigger id="broadcast-privacy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BROADCAST_PRIVACY.map((privacy) => (
                  <SelectItem key={privacy} value={privacy}>
                    {t(`privacyOptions.${privacy}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const ok = await run(async () => {
              // Sends the privacy the form shows; only YouTube has one.
              const privacy = destination.platform === "youtube" ? broadcastPrivacy(info.privacy) : undefined;
              await studio.setBroadcastInfo(destination.id, { ...info, privacy, youtubeBroadcastId: picked });
              return true;
            });
            setPending(false);
            if (ok) onClose();
          }}
        >
          {tc("save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
