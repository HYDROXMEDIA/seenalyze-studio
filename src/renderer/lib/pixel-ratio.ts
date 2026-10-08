/**
 * Notifies when devicePixelRatio changes: the window moved to a screen with
 * another scale, the screen's scaling changed, or the page zoom changed. The
 * query matches only the current ratio, so it is renewed after every change.
 * Use with useSyncExternalStore(subscribePixelRatio, readPixelRatio).
 */
export function subscribePixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | null = null;
  function changed() {
    listen();
    onChange();
  }
  function listen() {
    query?.removeEventListener("change", changed);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", changed);
  }
  listen();
  return () => query?.removeEventListener("change", changed);
}

export const readPixelRatio = () => window.devicePixelRatio;
