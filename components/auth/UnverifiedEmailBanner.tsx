// UnverifiedEmailBanner — surfaced on /app/dashboard when the
// user's email_verified is null. PENDING auth-flow gap #2 + #4
// (2026-05-06).
//
// Why a banner:
//   #2: gives unverified users a one-click way to re-trigger the
//       verification email (replaces the previous "they need to
//       contact support" workaround when the 24h token expires).
//   #4: surfaces the SMTP-fail-open recovery path. If the original
//       send failed silently in the registerAction microtask, the
//       user lands here with no obvious next step. The banner
//       makes the resend the obvious next step.
//
// POSTs to /api/auth/resend-verification (which runs anti-
// impersonation + rate-limit + SMTP-error mapping). Renders four
// terminal states inline:
//   - idle / submitting
//   - sent (green, "check your inbox")
//   - rate_limited (orange, "try again in a minute")
//   - smtp_failed (red, "try again or contact support")
//   - already_verified (green, "you're all set — refresh the
//     page to dismiss this banner")

"use client";

import { useState, useTransition } from "react";

type Outcome =
  | { kind: "idle" }
  | { kind: "sent" }
  | { kind: "already_verified" }
  | { kind: "rate_limited"; detail: string }
  | { kind: "smtp_failed"; detail: string }
  | { kind: "error"; detail: string };

export function UnverifiedEmailBanner({ email }: { email: string }) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onResend() {
    setOutcome({ kind: "idle" });
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/resend-verification", {
          method: "POST",
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          alreadyVerified?: boolean;
          error?: string;
          detail?: string;
        };
        if (res.ok && body.alreadyVerified) {
          setOutcome({ kind: "already_verified" });
          return;
        }
        if (res.ok) {
          setOutcome({ kind: "sent" });
          return;
        }
        if (res.status === 429) {
          setOutcome({
            kind: "rate_limited",
            detail:
              body.detail ?? "Too soon — try again in a minute.",
          });
          return;
        }
        if (res.status === 502) {
          setOutcome({
            kind: "smtp_failed",
            detail:
              body.detail ??
              "We couldn't send the email right now. Try again in a minute.",
          });
          return;
        }
        setOutcome({
          kind: "error",
          detail:
            body.detail ??
            `Couldn't resend (HTTP ${res.status}). Refresh the page and try again.`,
        });
      } catch (e) {
        setOutcome({
          kind: "error",
          detail: "Network error — check your connection and try again.",
        });
      }
    });
  }

  // Sent / already-verified — green confirmation copy
  if (outcome.kind === "sent" || outcome.kind === "already_verified") {
    return (
      <div
        role="status"
        className="card"
        style={{
          padding: "12px 16px",
          marginBottom: 24,
          borderColor: "color-mix(in oklab, #4caf50 30%, var(--border))",
          background: "color-mix(in oklab, #4caf50 6%, transparent)",
          fontSize: 13,
          color: "#2e7d32",
        }}
      >
        {outcome.kind === "sent" ? (
          <>
            <strong>Verification email sent.</strong> Check{" "}
            <code style={{ fontSize: 12 }}>{email}</code> — the link is
            valid for 24 hours. You may need to check spam or
            promotions.
          </>
        ) : (
          <>
            <strong>Already verified.</strong> Refresh the page to
            dismiss this banner — you&rsquo;re all set.
          </>
        )}
      </div>
    );
  }

  // Default + error states — orange/red banner with Resend button
  const isError =
    outcome.kind === "smtp_failed" || outcome.kind === "error";
  return (
    <div
      role="alert"
      className="card"
      style={{
        padding: "12px 16px",
        marginBottom: 24,
        borderColor: isError
          ? "color-mix(in oklab, #c00 30%, var(--border))"
          : "color-mix(in oklab, #f57c00 30%, var(--border))",
        background: isError
          ? "color-mix(in oklab, #c00 6%, transparent)"
          : "color-mix(in oklab, #f57c00 6%, transparent)",
        fontSize: 13,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div>
        <strong style={{ color: isError ? "#c00" : "#f57c00" }}>
          Verify your email to use AI tools.
        </strong>{" "}
        <span className="muted">
          We sent a verification link to{" "}
          <code style={{ fontSize: 12 }}>{email}</code> when you
          signed up. Free credits + AI tools (chat, summarize,
          translate, etc.) unlock once you click it. Free non-AI
          tools (merge, split, etc.) work without verification.
        </span>
      </div>
      {outcome.kind === "rate_limited" ||
      outcome.kind === "smtp_failed" ||
      outcome.kind === "error" ? (
        <div
          style={{
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 4,
            background: "color-mix(in oklab, var(--bg) 80%, transparent)",
            color: isError ? "#c00" : "#f57c00",
          }}
        >
          {outcome.detail}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn btn-outline"
          style={{
            fontSize: 13,
            padding: "6px 14px",
          }}
          onClick={onResend}
          disabled={pending || outcome.kind === "rate_limited"}
        >
          {pending
            ? "Sending…"
            : outcome.kind === "rate_limited"
            ? "Try again in a minute"
            : "Resend verification email"}
        </button>
      </div>
    </div>
  );
}
