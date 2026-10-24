import { Loader2Icon, LogInIcon, LogOutIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import type { SeenalyzeAccount } from "../../../shared/overlays";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/overlays";
import { Tooltip } from "@/components/ui/tooltip";
import { studio } from "@/lib/studio";
import { useAction } from "@/lib/use-action";
import type { useSeenalyzeAccount } from "@/lib/use-seenalyze-account";
import { cn } from "@/lib/utils";
import { SettingRow, SettingsCard } from "./parts";

function initialsOf(account: SeenalyzeAccount): string {
  const source = (account.displayName ?? account.email ?? "").trim();
  return source ? Array.from(source)[0].toUpperCase() : "?";
}

/** The account state and actions, read once by the settings page and shared by everything that shows the account. */
export type AccountApi = ReturnType<typeof useSeenalyzeAccount>;

/** The account picture, or the first letter of the name when there is none or it cannot be loaded. */
export function AccountAvatar({ account, className }: { account: SeenalyzeAccount; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = account.avatarUrl && account.avatarUrl !== failedUrl ? account.avatarUrl : null;
  return (
    <span aria-hidden className={cn("flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-base font-semibold", className)}>
      {url ? (
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => {
            console.warn("[account] profile picture could not be loaded; showing initials");
            setFailedUrl(url);
          }}
        />
      ) : (
        initialsOf(account)
      )}
    </span>
  );
}

/** Settings › Account: who is signed in, with the account's states (loading, check failed, waiting, signed out). */
export function AccountCard({ api }: { api: AccountApi }) {
  const t = useTranslations("settings");
  const ta = useTranslations("settings.accountCard");
  const tc = useTranslations("common");
  const run = useAction();
  const { state, retry, signIn, cancelSignIn, signingIn, signOut } = api;
  const account = state.status === "ready" ? state.account : null;

  return (
    <SettingsCard title={t("account")}>
      <div className="flex items-center gap-4">
        {account ? (
          <AccountAvatar account={account} className="size-14 text-xl" />
        ) : (
          <span aria-hidden className="size-14 shrink-0 rounded-full bg-accent" />
        )}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-base font-semibold">{account ? (account.displayName ?? account.email ?? t("seenalyzeAccount")) : t("seenalyzeAccount")}</span>
          <span className="truncate text-sm text-muted-foreground">
            {state.status === "failed"
              ? t("seenalyzeCheckFailed")
              : account
                ? account.displayName
                  ? (account.email ?? "")
                  : ""
                : state.status === "ready"
                  ? signingIn
                    ? t("seenalyzeWaiting")
                    : t("seenalyzeSignedOut")
                  : ""}
          </span>
        </div>
        {state.status === "loading" ? (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label={tc("loading")} />
        ) : state.status === "failed" ? (
          <Button variant="outline" size="sm" onClick={retry}>
            {tc("retry")}
          </Button>
        ) : account ? (
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            <LogOutIcon />
            {t("signOut")}
          </Button>
        ) : signingIn ? (
          <Button variant="ghost" size="sm" onClick={cancelSignIn}>
            {tc("cancel")}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void signIn()}>
            <LogInIcon />
            {t("signIn")}
          </Button>
        )}
      </div>
      {account && (
        <SettingRow title={ta("designer")} detail={account.canUseDesigner ? ta("designerIncluded") : ta("designerNotIncluded")}>
          <Button variant="outline" size="sm" onClick={() => void run(() => studio.openSeenalyzeDashboard())}>
            {ta("managePlan")}
          </Button>
        </SettingRow>
      )}
    </SettingsCard>
  );
}

/** The account at the bottom of the settings navigation: opens the Account section; Sign out is one click away. */
export function NavAccount({ api, active, onOpen }: { api: AccountApi; active: boolean; onOpen: () => void }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { state, retry, signOut } = api;
  const account = state.status === "ready" ? state.account : null;

  if (state.status === "loading") return <Loader2Icon className="m-3 size-4 animate-spin text-muted-foreground" aria-label={tc("loading")} />;
  if (state.status === "failed") {
    return (
      <Button variant="ghost" size="sm" className="w-full justify-start text-destructive" onClick={retry}>
        <TriangleAlertIcon />
        {tc("retry")}
      </Button>
    );
  }
  if (!account) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        className={cn("flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring", active && "bg-accent font-medium")}
      >
        <LogInIcon aria-hidden className="size-4 shrink-0" />
        {t("signIn")}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring", active && "bg-accent")}
      >
        <AccountAvatar account={account} className="size-8 text-sm" />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{account.displayName ?? account.email ?? t("seenalyzeAccount")}</span>
          {account.displayName && account.email && <span className="truncate text-xs text-muted-foreground">{account.email}</span>}
        </span>
      </button>
      <Tooltip label={t("signOut")}>
        <Button variant="ghost" size="icon-sm" aria-label={t("signOut")} onClick={() => void signOut()}>
          <LogOutIcon />
        </Button>
      </Tooltip>
    </div>
  );
}

type Confirm = "erase" | "delete" | null;

/** End of Account: erase this computer's data, or delete the account on the website. Both ask first. */
export function DangerZone({ locked, signedIn }: { locked: boolean; signedIn: boolean }) {
  const t = useTranslations("settings.dangerZone");
  const tc = useTranslations("common");
  const run = useAction();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [working, setWorking] = useState(false);

  const act = async () => {
    const action = confirm;
    setConfirm(null);
    if (!action) return;
    setWorking(true);
    try {
      // Erasing restarts the app; a failure shows its message and leaves everything as it was.
      await run(() => (action === "erase" ? studio.eraseLocalData() : studio.openSeenalyzeDashboard()));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="grid gap-4 rounded-xl border border-red-600/40 bg-card p-6">
      <h3 className="text-xl font-bold text-neutral-900 dark:text-white">{t("title")}</h3>
      <SettingRow title={t("eraseTitle")} detail={locked ? t("eraseLocked") : t("eraseDetail")}>
        <Button variant="outline" size="sm" className="border-red-600/50 text-red-700 hover:text-red-700 dark:text-red-400" disabled={locked || working} onClick={() => setConfirm("erase")}>
          {t("erase")}
        </Button>
      </SettingRow>
      {signedIn && (
        <SettingRow title={t("deleteTitle")} detail={t("deleteDetail")}>
          <Button variant="outline" size="sm" className="border-red-600/50 text-red-700 hover:text-red-700 dark:text-red-400" disabled={working} onClick={() => setConfirm("delete")}>
            {t("delete")}
          </Button>
        </SettingRow>
      )}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        {confirm && (
          <AlertDialogContent>
            <DialogHeader>
              <AlertDialogTitle>{t(confirm === "erase" ? "eraseConfirmTitle" : "deleteConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t(confirm === "erase" ? "eraseConfirmDescription" : "deleteConfirmDescription")}</AlertDialogDescription>
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void act()}>{t(confirm === "erase" ? "eraseAction" : "deleteAction")}</AlertDialogAction>
            </DialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </section>
  );
}
