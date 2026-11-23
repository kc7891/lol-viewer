import { useEffect, useState } from "react";

/** The loading bar is a hint, not a promise: stop showing it this long after loading began. */
export const LOADING_BAR_MAX_MS = 30_000;

/**
 * Calls `onExpire` `ms` after `start()`, unless `stop()` (or another `start()`) comes first.
 * Framework-free so the timing can be unit-tested.
 */
export function createLoadingTimeout(onExpire: () => void, ms = LOADING_BAR_MAX_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    start() {
      stop();
      timer = setTimeout(() => {
        timer = undefined;
        onExpire();
      }, ms);
    },
    stop,
  };
}

/**
 * Whether to show the loading bar. True while `loading`, but at most LOADING_BAR_MAX_MS from when
 * loading began (or from when `key` — the page URL — last changed during loading). Repeated
 * "loading" reports from sub-frames do not restart the clock.
 */
export function useLoadingBar(loading: boolean, key: string, ms = LOADING_BAR_MAX_MS): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (!loading) return;
    const t = createLoadingTimeout(() => setExpired(true), ms);
    t.start();
    return t.stop;
  }, [loading, key, ms]);
  return loading && !expired;
}
