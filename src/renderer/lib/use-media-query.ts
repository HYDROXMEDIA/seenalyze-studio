import { useCallback, useSyncExternalStore } from "react";

/** Whether a CSS media query currently matches; re-renders when it starts or stops matching. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/** Header buttons show only their icons below this window width (matches `max-[1100px]:` in the header). */
export const COMPACT_HEADER_QUERY = "(width < 1100px)";
