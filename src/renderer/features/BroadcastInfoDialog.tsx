import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { BroadcastInfo, CategoryOption, DestinationConfig } from "../../shared/types";
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
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";

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

  useEffect(() => {
    let cancelled = false;
    void run(() => studio.getBroadcastInfo(destination.id)).then((result) => {
      if (!cancelled) setInfo(result ?? { title: "" });
    });
    return () => {
      cancelled = true;
    };
  }, [destination.id, run]);

  useEffect(() => {
    if (destination.platform !== "twitch" || !destination.accountId || query.trim().length < 2) return;
    const accountId = destination.accountId;
    const timer = window.setTimeout(() => {
      void run(() => studio.searchCategories(accountId, query)).then((result) => setCategories(result ?? []));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, destination.platform, destination.accountId, run]);

  if (!info) {
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

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        <Field label={t("streamTitle")} htmlFor="broadcast-title">
          <Input id="broadcast-title" value={info.title} maxLength={140} onChange={(event) => setInfo({ ...info, title: event.target.value })} />
        </Field>

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
                      className={cn("w-full px-3 py-1.5 text-left text-sm hover:bg-accent", category.id === info.categoryId && "bg-accent")}
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

        {destination.platform === "youtube" && (
          <Field label={t("privacy")} htmlFor="broadcast-privacy">
            <Select value={info.privacy ?? "public"} onValueChange={(value) => setInfo({ ...info, privacy: value as BroadcastInfo["privacy"] })}>
              <SelectTrigger id="broadcast-privacy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["public", "unlisted", "private"] as const).map((privacy) => (
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
              await studio.setBroadcastInfo(destination.id, info);
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
