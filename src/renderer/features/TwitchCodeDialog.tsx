import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { DeviceCodePrompt } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import { useStudio } from "@/store/studio";

/** Shows the Twitch activation code; closes itself once the account appears. */
export function TwitchCodeDialog({ prompt, onClose }: { prompt: DeviceCodePrompt | null; onClose: () => void }) {
  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      {prompt && <CodeBody prompt={prompt} onClose={onClose} />}
    </Dialog>
  );
}

function CodeBody({ prompt, onClose }: { prompt: DeviceCodePrompt; onClose: () => void }) {
  const t = useTranslations("twitchCode");
  const tc = useTranslations("common");
  const run = useAction();
  const twitchAccounts = useStudio((state) => state.snapshot?.accounts.filter((account) => account.platform === "twitch").length ?? 0);
  // Baseline taken when the code is first shown; a new account means sign-in finished.
  const [initialCount] = useState(twitchAccounts);

  useEffect(() => {
    if (twitchAccounts > initialCount) onClose();
  }, [twitchAccounts, initialCount, onClose]);

  return (
    <DialogContent className="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <p className="rounded-lg border bg-muted py-4 text-center text-2xl font-semibold tabular-nums select-text">{prompt.userCode}</p>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button onClick={() => void run(() => studio.openExternal(prompt.verificationUri))}>{t("open")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
