"use client";

// components/ui/Toaster.tsx — renders toasts dispatched via lib/client/toast.
// Mounted ONCE in the root layout. Listens for the window event, stacks
// transient messages bottom-center, auto-dismisses, and is screen-reader
// friendly (aria-live). Renders nothing when idle.

import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastDetail, type ToastKind } from "@/lib/client/toast";

type Item = { id: number; message: string; kind: ToastKind };

const TONE: Record<ToastKind, { border: string; dot: string }> = {
  success: { border: "var(--green, #2f855a)", dot: "var(--green, #2f855a)" },
  error: { border: "var(--red, #b23b3b)", dot: "var(--red, #b23b3b)" },
  info: { border: "var(--border, #2e313c)", dot: "var(--fg-subtle, #a8acb8)" },
};

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let seq = 0;
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      if (!d?.message) return;
      const id = ++seq;
      // Cap the stack so a noisy loop can't fill the screen.
      setItems((prev) => [...prev.slice(-4), { id, message: d.message, kind: d.kind }]);
      const ms = Math.min(Math.max(d.durationMs || 3000, 1000), 8000);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, ms);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 20,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
        padding: "0 16px",
      }}
    >
      {items.map((t) => {
        const tone = TONE[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            style={{
              pointerEvents: "auto",
              cursor: "pointer",
              maxWidth: 420,
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--bg-2, #1e2029)",
              color: "var(--fg, #e6e6ea)",
              border: `1px solid ${tone.border}`,
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone.dot, flexShrink: 0 }} />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
