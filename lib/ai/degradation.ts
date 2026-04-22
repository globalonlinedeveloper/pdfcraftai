// Phase D / Task #22 — shared AI-degradation classifier.
//
// Every /api/ai/* route can fail the same four "system-level" ways,
// and before this module each of our ten tool components (Summarize,
// Translate, Rewrite, Redact, Sign, Compare, Generate, TableExtract,
// Ocr, PdfToOffice) duplicated its own shaky interpretation of the
// JSON body. That drift made for contradictory UX:
//
//   - Some tools said "the summarizer is offline" for a plain
//     `daily_cost_ceiling_exceeded` 429 — frightening and wrong.
//   - Others said "no AI provider is configured" for a 503
//     `op_disabled` — accurate only if the operator happened to
//     intentionally kill the op, misleading otherwise.
//   - None surfaced the Retry-After hint the server sends.
//
// This module gives every tool one consistent classifier. The tool
// keeps full control over its non-AI-specific error strings (413
// file too large, 422 no-text, 402 out-of-credits); what's shared
// is the interpretation of the 401 / 429 / 503 / 502 band, all of
// which are "the AI stack is unhappy" rather than "this file is
// bad".
//
// Design:
//   - A tiny discriminated-union result. Each variant carries just
//     the fields the caller needs to render a human message.
//   - No JSX / no React — this is a pure function so it's trivial
//     to unit-test and can be re-used server-side (admin tooling
//     that replays a webhook body, for example).
//   - classifyAiError never throws. A malformed body returns
//     `kind: "unknown"` — fall through to the tool's per-op default.
//
// Why call this "degradation" rather than "error"?
// -------------------------------------------------
// An HTTP error is a signal; a degradation is a posture. When the
// daily cap trips we're not broken — we're intentionally throttling.
// When the kill switch is flipped we're not broken — we're gating.
// Speaking in degradation language in the UI avoids the
// "something-is-wrong" panic copy (red banner, "contact support")
// that the operator doesn't want attached to every over-budget user.
//
// Server-side response contracts this mirrors:
//   - lib/ai/route-guards.ts 503 op_disabled          { error, op, envVar }
//   - lib/ai/route-guards.ts 429 daily_cost_ceiling   { error, usedMicros, capMicros, retryAfterSeconds }
//   - adapter-layer 502 provider error                { error: "provider_error", detail }
//   - registry 503 no_provider_configured             { error: "no_provider_configured" }

/**
 * Result of classifying an AI API error response.
 *
 * The `kind` discriminator drives both the copy and any auxiliary
 * UX (retry button, "upgrade plan" CTA, link to status page).
 * All variants also carry a `userMessage` so the most common case
 * — tool just wants a string to drop into a banner — is a single
 * field access.
 */
export type AiDegradation =
  | {
      kind: "op_disabled";
      /** AI op identifier, e.g. "summarize", "rewrite". */
      op: string;
      /** Env var the operator flipped (for operator-facing audit). */
      envVar: string;
      userMessage: string;
    }
  | {
      kind: "budget_exhausted";
      /** µUSD used today — pre-computed sum. */
      usedMicros: number;
      /** µUSD cap — the per-user daily ceiling. */
      capMicros: number;
      /** Seconds until 00:00 UTC when the cap resets. */
      retryAfterSeconds: number;
      userMessage: string;
    }
  | {
      kind: "no_provider_configured";
      userMessage: string;
    }
  | {
      kind: "provider_unavailable";
      /** Operator-supplied detail if present; otherwise empty. */
      detail: string;
      /** Seconds the server suggested waiting; 0 if unspecified. */
      retryAfterSeconds: number;
      userMessage: string;
    }
  | {
      kind: "not_authenticated";
      userMessage: string;
    }
  | {
      /**
       * Not an AI-stack problem — the caller should fall through to
       * its own tool-specific error mapping (413 size, 422 no-text,
       * 402 out-of-credits, etc.).
       */
      kind: "unknown";
    };

type BodyRecord = Record<string, unknown>;

function readString(body: BodyRecord, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v : "";
}

function readNumber(body: BodyRecord, key: string): number {
  const v = body[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Format µUSD as "$X.XX" for inline UI strings. Keeps this module
 * self-contained — lib/admin/format.ts is server-admin only.
 */
export function formatMicrosUsdInline(micros: number): string {
  const usd = micros / 1_000_000;
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format seconds as "Xh Ym" (or "Xm" if under an hour).
 * Used to soften the Retry-After countdown in budget-exhausted copy.
 */
export function formatRetryWindow(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "a moment";
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Classify an AI API error. Pure function — no fetches, no globals.
 *
 * @param status HTTP status code from the /api/ai/* response.
 * @param body   Parsed JSON body (empty object is fine).
 * @param opts   Optional hints for friendlier copy.
 */
export function classifyAiError(
  status: number,
  body: BodyRecord | null | undefined,
  opts: { opLabel?: string } = {}
): AiDegradation {
  const b: BodyRecord = body ?? {};
  const errorCode = readString(b, "error");
  const detail = readString(b, "detail");
  const opLabel = opts.opLabel ?? "this feature";

  if (status === 401) {
    return {
      kind: "not_authenticated",
      userMessage: `Sign in to use ${opLabel} — credits are per-user.`,
    };
  }

  if (status === 503) {
    if (errorCode === "op_disabled") {
      const op = readString(b, "op");
      const envVar = readString(b, "envVar");
      return {
        kind: "op_disabled",
        op,
        envVar,
        userMessage:
          detail ||
          `${opLabel.charAt(0).toUpperCase() + opLabel.slice(1)} is temporarily paused by the operator. Try again in a few minutes.`,
      };
    }
    if (errorCode === "no_provider_configured") {
      return {
        kind: "no_provider_configured",
        userMessage:
          detail ||
          "This deployment has no AI provider configured yet. Ask your admin to set an API key.",
      };
    }
    // Generic 503 — treat as provider unavailable so the user gets
    // a "try again" nudge rather than a scary failure message.
    const retryAfterHeaderRaw = readString(b, "retryAfterSeconds");
    return {
      kind: "provider_unavailable",
      detail,
      retryAfterSeconds: readNumber(b, "retryAfterSeconds") || Number(retryAfterHeaderRaw) || 0,
      userMessage:
        detail ||
        `${opLabel.charAt(0).toUpperCase() + opLabel.slice(1)} is temporarily unavailable. Try again shortly.`,
    };
  }

  if (status === 429) {
    if (errorCode === "daily_cost_ceiling_exceeded") {
      const usedMicros = readNumber(b, "usedMicros");
      const capMicros = readNumber(b, "capMicros");
      const retryAfterSeconds = readNumber(b, "retryAfterSeconds");
      const used = formatMicrosUsdInline(usedMicros);
      const cap = formatMicrosUsdInline(capMicros);
      const window = formatRetryWindow(retryAfterSeconds);
      return {
        kind: "budget_exhausted",
        usedMicros,
        capMicros,
        retryAfterSeconds,
        userMessage:
          detail ||
          `You've hit today's AI usage budget (${used} of ${cap}). It resets in ${window} at 00:00 UTC.`,
      };
    }
    // Generic 429 (rate-limit) — not a kill-switch/cap. Present as
    // a retry nudge without the cap numbers.
    return {
      kind: "provider_unavailable",
      detail,
      retryAfterSeconds: readNumber(b, "retryAfterSeconds"),
      userMessage:
        detail ||
        `Too many ${opLabel} requests — try again in a minute.`,
    };
  }

  if (status === 502) {
    // Upstream AI provider errored. Credits are refunded by the
    // server — say so up front to head off panicked top-ups.
    return {
      kind: "provider_unavailable",
      detail,
      retryAfterSeconds: 0,
      userMessage:
        detail ||
        "The AI provider errored mid-request. Your credits were refunded; try again in a moment.",
    };
  }

  return { kind: "unknown" };
}
