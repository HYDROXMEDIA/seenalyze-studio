import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { DeviceCodePrompt } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useStudio } from "@/store/studio";

/** Shows the Twitch activation code; closes itself once the account appears. */
export function TwitchCodeDialog({ prompt, onClose }: { prompt: DeviceCodePrompt | null; onClose: () => void }) {
  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (open) return;
        // Dismissed by the user (Escape or outside click): stop waiting for the code too.
        studio.cancelTwitchSignIn().catch((error: unknown) => console.error("[twitch] sign-in could not be cancelled", error));
        onClose();
      }}
    >
      {prompt && <CodeBody prompt={prompt} onClose={onClose} />}
    </Dialog>
  );
}

function CodeBody({ prompt: initialPrompt, onClose }: { prompt: DeviceCodePrompt; onClose: () => void }) {
  const t = useTranslations("twitchCode");
  const tc = useTranslations("common");
  const run = useAction();
  const [prompt, setPrompt] = useState(initialPrompt);
  // Set when this sign-in failed or its code expired; the code shown is then useless.
  const [failed, setFailed] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const twitchAccounts = useStudio((state) => state.snapshot?.accounts.filter((account) => account.platform === "twitch").length ?? 0);
  // Baseline taken when the code is first shown; a new account means sign-in finished.
  const [initialCount] = useState(twitchAccounts);

  useEffect(() => {
    if (twitchAccounts > initialCount) onClose();
  }, [twitchAccounts, initialCount, onClose]);

  // A reconnect replaces an existing account, so also close on the success notice.
  useEffect(
    () =>
      studio.onNotice((notice) => {
        if (notice.key === "notices.accountConnected") onClose();
        else if (notice.kind === "error" && notice.values?.signIn === "twitch") setFailed(true);
      }),
    [onClose],
  );

  const cancel = () => {
    studio.cancelTwitchSignIn().catch((error: unknown) => console.error("[twitch] sign-in could not be cancelled", error));
    onClose();
  };

  const renew = async () => {
    setRenewing(true);
    const next = await run(() => studio.connectTwitch());
    setRenewing(false);
    if (!next) return;
    setPrompt(next);
    setFailed(false);
  };

  return (
    <DialogContent className="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{failed ? t("failed") : t("description")}</DialogDescription>
      </DialogHeader>
      <p
        className={cn(
          "rounded-lg border bg-muted py-4 text-center text-2xl font-semibold tabular-nums select-text",
          failed && "text-muted-foreground line-through",
        )}
      >
        {prompt.userCode}
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={cancel}>
          {tc("cancel")}
        </Button>
        {failed ? (
          <Button disabled={renewing} onClick={() => void renew()}>
            {t("newCode")}
          </Button>
        ) : (
          <Button onClick={() => void run(() => studio.openExternal(prompt.verificationUri))}>{t("open")}</Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
