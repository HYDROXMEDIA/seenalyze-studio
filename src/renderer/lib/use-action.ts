import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { errorCode } from "./studio";

/** Runs an engine call and shows a translated toast when it fails. */
export function useAction() {
  const t = useTranslations("errors.codes");
  return useCallback(
    async <T>(call: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await call();
      } catch (error) {
        const code = errorCode(error);
        toast.error(t.has(code) ? t(code) : t("generic"));
        return undefined;
      }
    },
    [t],
  );
}
