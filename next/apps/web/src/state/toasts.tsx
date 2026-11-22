import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_TOASTS = 20;
export const TOAST_MS = 5000;

export type ToastKind = "info" | "success" | "warn";
export type Toast = { id: number; kind: ToastKind; text: string };

export type ToastApi = {
  toasts: Toast[];
  push(text: string, kind?: ToastKind): void;
  dismiss(id: number): void;
  clear(): void;
};

/** At most MAX_TOASTS are kept (oldest dropped). They fade after TOAST_MS unless `autoDismiss` is false (stories). */
export function useToasts(initial: Toast[] = [], autoDismiss = true): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>(initial);
  const nextId = useRef(initial.reduce((m, t) => Math.max(m, t.id), 0) + 1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((all) => all.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (text: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setToasts((all) => [...all, { id, kind, text }].slice(-MAX_TOASTS));
      if (autoDismiss) timers.current.set(id, setTimeout(() => dismiss(id), TOAST_MS));
    },
    [autoDismiss, dismiss],
  );

  const clear = useCallback(() => setToasts([]), []);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

  return { toasts, push, dismiss, clear };
}
