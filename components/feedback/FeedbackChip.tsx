"use client";

// components/feedback/FeedbackChip.tsx — thumbs ↑/↓ on AI results.
//
// PENDING_WORK_ANALYSIS.md §6b stage 2. The data flywheel UI surface.
// Stage 1 (commit `d74fefe`) shipped the schema + persist endpoint +
// admin viewer. This stage 2 ships the user-facing chip; stage 3
// rolls it out across the remaining 52 AI tool result cards.
//
// What this component does
//   Renders two compact buttons (↑ / ↓) at the bottom of an AI result
//   card. Click → fetch POST /api/ai/feedback → optimistic UI flip to
//   the picked verdict + a small "thanks" microcopy. Subsequent clicks
//   on the OTHER button re-POST with the new verdict (the route does
//   ON DUPLICATE KEY UPDATE so the row stays + flips). Clicking the
//   already-picked verdict is a no-op.
//
// Why this is a single-shot component (not a portal / modal)
//   The chip lives inline in the result card. The first version is
//   intentionally minimal: just the two buttons + the optional
//   "thanks" microcopy. Reason chips ("incorrect", "incomplete",
//   "off-topic") + free-text note are deferred — they require modal
//   or expandable UI affordance and the data flywheel benefits from
//   the up/down signal alone first. Adding a reason chip is a
//   future commit; the API already accepts the optional field.
//
// Auth posture
//   The component renders for everyone (the result card is only
//   visible after a successful AI call, which already required auth).
//   If a session expires between the AI call and the click, the POST
//   401s and we surface a quiet "Sign in to leave feedback" pivot.
//   No silent failures — quiet UI but visible state change.
//
// Why no debouncing
//   The route is rate-limited at 60/min/user; that's the abuse-
//   prevention layer. Client-side debouncing would slow legitimate
//   "oops I clicked the wrong one" flips. The optimistic UI gate
//   (busy state during fetch) prevents double-submits within a single
//   click cycle.

import { useState } from "react";
import Link from "next/link";

export interface FeedbackChipProps {
  /**
   * Operation id ("summarize", "translate", etc.). Required — without
   * it the admin view can't slice by tool.
   */
  operation: string;

  /**
   * The ai_usage row id this feedback attaches to. Required for flip
   * semantics — UNIQUE(user_id, ai_usage_id) means feedback flips
   * replace in place. Pass null if the route doesn't surface the id
   * yet; the row will be inserted but the next click creates a NEW
   * row instead of flipping (UNIQUE allows multiple NULLs in MySQL).
   * Stage 3 wires every AI route to surface this; this fallback is
   * only for stage 2 pilot scope.
   */
  aiUsageId?: string | null;

  /**
   * The file id this feedback is about. Optional — null for chat_turn
   * feedback (no file).
   */
  fileId?: string | null;

  /**
   * Provider + model that produced the output. Both denormalized into
   * ai_feedback so admin queries can slice without a join. Optional
   * because legacy callers may not have these readily available; the
   * admin view shows "?" when null.
   */
  providerId?: string | null;
  model?: string | null;
}

type State = "idle" | "submitting" | "submitted" | "auth_required" | "error";

export function FeedbackChip({
  operation,
  aiUsageId = null,
  fileId = null,
  providerId = null,
  model = null,
}: FeedbackChipProps) {
  const [verdict, setVerdict] = useState<"up" | "down" | null>(null);
  const [state, setState] = useState<State>("idle");

  async function submit(v: "up" | "down") {
    // No-op if already submitted with the same verdict — saves a
    // round-trip and keeps the rate-limit budget for legitimate flips.
    if (state === "submitted" && verdict === v) return;
    if (state === "submitting") return;

    // Optimistic UI: flip immediately. On error we revert.
    const prevVerdict = verdict;
    const prevState = state;
    setVerdict(v);
    setState("submitting");

    try {
      const res = await fetch("/api/ai/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation,
          verdict: v,
          aiUsageId,
          fileId,
          providerId,
          model,
        }),
      });

      if (res.status === 401) {
        // Session expired between the AI call and the click. Revert
        // optimistic state and surface a quiet sign-in pivot.
        setVerdict(prevVerdict);
        setState("auth_required");
        return;
      }

      if (!res.ok) {
        setVerdict(prevVerdict);
        setState(prevState === "submitted" ? "submitted" : "error");
        return;
      }

      setState("submitted");
    } catch {
      // Network error. Revert.
      setVerdict(prevVerdict);
      setState(prevState === "submitted" ? "submitted" : "error");
    }
  }

  const baseStyle: React.CSSProperties = {
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--fg-subtle, #a8acb8)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    transition: "background 120ms ease, border-color 120ms ease",
  };

  // Highlight style for the picked verdict. Up = green-tinted; down =
  // amber-tinted (NOT red — red reads as "error", we want "noted, not
  // happy").
  const pickedStyle = (v: "up" | "down"): React.CSSProperties => ({
    ...baseStyle,
    borderColor: v === "up" ? "#4caf50" : "#d97706",
    background:
      v === "up"
        ? "color-mix(in oklab, #4caf50 12%, transparent)"
        : "color-mix(in oklab, #d97706 12%, transparent)",
    color: v === "up" ? "#4caf50" : "#d97706",
  });

  const disabled = state === "submitting";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
      role="group"
      aria-label="Was this output helpful?"
    >
      <span
        style={{
          fontSize: 12,
          color: "var(--fg-subtle, #a8acb8)",
        }}
      >
        Was this helpful?
      </span>
      <button
        type="button"
        onClick={() => submit("up")}
        disabled={disabled}
        aria-pressed={verdict === "up"}
        aria-label="Thumbs up"
        style={verdict === "up" ? pickedStyle("up") : baseStyle}
      >
        <span aria-hidden>↑</span>
        <span>Yes</span>
      </button>
      <button
        type="button"
        onClick={() => submit("down")}
        disabled={disabled}
        aria-pressed={verdict === "down"}
        aria-label="Thumbs down"
        style={verdict === "down" ? pickedStyle("down") : baseStyle}
      >
        <span aria-hidden>↓</span>
        <span>No</span>
      </button>

      {state === "submitted" && (
        <span
          style={{
            fontSize: 12,
            color: "var(--fg-subtle, #a8acb8)",
            fontStyle: "italic",
          }}
          aria-live="polite"
        >
          Thanks — noted.
        </span>
      )}

      {state === "auth_required" && (
        <Link
          href="/login"
          style={{
            fontSize: 12,
            color: "var(--accent)",
            textDecoration: "underline",
          }}
        >
          Sign in to leave feedback
        </Link>
      )}

      {state === "error" && (
        <span
          style={{
            fontSize: 12,
            color: "var(--fg-subtle, #a8acb8)",
          }}
          aria-live="polite"
        >
          Couldn&apos;t save — try again later.
        </span>
      )}
    </div>
  );
}
