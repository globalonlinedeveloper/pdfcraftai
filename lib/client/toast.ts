// lib/client/toast.ts — tiny, dependency-free toast bus (backlog #53).
//
// Any client code can call `toast("Copied")` to show transient feedback.
// It dispatches a window CustomEvent that the single mounted <Toaster/>
// (components/ui/Toaster.tsx) renders. No context provider / no tree
// wrapping (keeps the root layout untouched), and it's an SSR-safe no-op
// on the server. Replaces the ad-hoc inline alerts that gave inconsistent
// feedback across tools.

export type ToastKind = "success" | "error" | "info";
export const TOAST_EVENT = "pdfcraft:toast";

export type ToastDetail = {
  message: string;
  kind: ToastKind;
  durationMs: number;
};

export function toast(
  message: string,
  opts?: { kind?: ToastKind; durationMs?: number },
): void {
  if (typeof window === "undefined" || !message) return;
  const detail: ToastDetail = {
    message,
    kind: opts?.kind ?? "info",
    durationMs: opts?.durationMs ?? 3000,
  };
  try {
    window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
  } catch {
    /* never let UI feedback throw */
  }
}
