"use client";

import type { CSSProperties } from "react";

// Shared skeleton-loading primitive (2026-06-05) — the single source for "busy"
// states, replacing per-tool spinner/pulse cards with one consistent shimmer.
// Token-based (spacing / radius / colour from globals.css design tokens). The
// shimmer is decorative (aria-hidden); the surrounding ToolBusy carries the SR
// announcement. prefers-reduced-motion is honoured globally (globals.css G14).
export function Skeleton({
  width = "100%",
  height = 12,
  radius,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{
        display: "block",
        width,
        height,
        borderRadius: radius ?? "var(--radius-sm)",
        ...style,
      }}
    />
  );
}

// Standard busy card for the shared tool bases: the operation label + a few
// skeleton lines mimicking the incoming result. role=status + aria-busy so
// screen readers announce progress; the shimmer itself is aria-hidden.
export function ToolBusy({ label }: { label: string }) {
  return (
    <div
      className="card"
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        padding: "var(--space-4)",
        background: "var(--bg-1)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <div style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--fg-muted)" }}>
        {label}
      </div>
      <Skeleton width="70%" />
      <Skeleton />
      <Skeleton width="85%" />
    </div>
  );
}
