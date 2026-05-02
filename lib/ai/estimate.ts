// Pre-flight credit estimator (plan §5, Day 2).
//
// Single source of truth for "how many credits will this op cost?"
// Both the new POST /api/ai/estimate endpoint AND the existing route
// handlers will eventually call estimateCredits() with the same inputs
// — that way the estimate the user saw before clicking Run can never
// drift from what gets debited.
//
// Today (Day 2 commit): the estimate function is the authority for
// the /api/ai/estimate endpoint. Route handlers continue to call
// spendCredits() with their existing flat / multiplier mix. Day 1.7
// converts translate/redact/sign route handlers to call this helper
// before spendCredits(), at which point the only difference between
// estimate and live is the auth + idempotency layer.
//
// CRITICAL design constraint: this function is PURE. No DB calls, no
// network, no env var reads beyond isMultiplierPricingEnabled() (which
// itself is a single sync env-var check). That keeps the estimator
// fast (<5ms server-side) and deterministic — same input gives same
// output, same as a pure-math `costMicros(usage)` would.

import "server-only";

import {
  AI_OPERATION_COSTS,
  type AIOperationId,
  isMultiplierPricingEnabled,
} from "@/lib/pricing";

/**
 * Soft chunk-size proxy used by translate's map-reduce chunker. Real
 * chunker in lib/ai/translate.ts splits on paragraph boundaries within
 * a 10K-char budget; using 10_000 here gives us a forward-compatible
 * estimate that under-counts by at most 10% for paragraph-boundary
 * variability. Margin direction is in the user's favour — they pay
 * what we quoted or slightly less, never more.
 */
const TRANSLATE_CHUNK_CHARS = 10_000;

/**
 * Inputs the estimator can use. All optional — different ops need
 * different signals. The endpoint routes the relevant fields based
 * on `op`.
 *
 *   - pageCount: number of pages in the input PDF. Used by ops that
 *     scale per-page (ocr, redact, sign).
 *   - charCount: total character count of extracted text. Used by
 *     translate's chunkCount estimate.
 *   - For flat ops (chat_turn, summarize, rewrite, table, compare,
 *     generate) neither field is consulted — base cost is constant.
 */
export interface EstimateInput {
  pageCount?: number;
  charCount?: number;
}

export interface EstimateResult {
  /** Total credits debited if the user runs this op. */
  credits: number;
  /**
   * Multiplier applied to the base cost. Surface this for admin
   * diagnostics + the /admin/users/[id] page; users never see it
   * (per principle 3 — admin sees everything; users see minimum).
   */
  multiplier: number;
  /**
   * Op base cost, useful for explaining the math in admin dashboards
   * (not user-facing).
   */
  baseCost: number;
}

/**
 * Compute the credit cost for an AI op given pre-upload signals. Pure
 * function — no I/O, no awaits.
 *
 * Multiplier semantics:
 *   - ocr: pageCount (already shipped, route-handler proven)
 *   - redact: pageCount (Day 1.7 will wire route handler to match)
 *   - sign: pageCount (Day 1.7 will wire route handler to match)
 *   - translate: ceil(charCount / 10K) chunks (Day 1.7 will wire)
 *   - all others: flat base cost
 *
 * If `isMultiplierPricingEnabled()` returns false (env var override),
 * every op falls back to flat base cost. This matches what the route
 * handlers do TODAY (pre-Day-1.7 they're flat regardless of input
 * size, except OCR which is already shipped). The flag is the rollback
 * lever for the pricing change — flip it to "false" in Hostinger panel
 * if user complaints spike post-Day-1.7 deploy.
 *
 * Returns the same shape regardless of op so callers don't need a
 * switch — just read result.credits.
 */
export function estimateCredits(
  op: AIOperationId,
  input: EstimateInput = {}
): EstimateResult {
  const baseCost = AI_OPERATION_COSTS[op];
  const useMultiplier = isMultiplierPricingEnabled();

  // Flat ops always return baseCost. List them explicitly so a new op
  // added to AIOperationId without an estimator branch is a TS error.
  switch (op) {
    case "ocr":
    case "redact":
    case "sign": {
      // Per-page multiplier. Default to 1 if pageCount is missing —
      // gives a floor estimate the user can rely on. Real PDFs always
      // have at least 1 page; missing pageCount means client didn't
      // measure (ok — they'll see the real number after upload).
      const pages = Math.max(1, Math.floor(input.pageCount ?? 1));
      const multiplier = useMultiplier ? pages : 1;
      return { credits: baseCost * multiplier, multiplier, baseCost };
    }
    case "translate": {
      // Chunk count = ceil(charCount / 10K). Default to 1 chunk if
      // charCount is missing or zero — same floor-estimate rationale.
      const chars = Math.max(1, Math.floor(input.charCount ?? 0));
      const chunks = Math.max(1, Math.ceil(chars / TRANSLATE_CHUNK_CHARS));
      const multiplier = useMultiplier ? chunks : 1;
      return { credits: baseCost * multiplier, multiplier, baseCost };
    }
    case "chat_turn":
    case "summarize":
    case "rewrite":
    case "table":
    case "compare":
    case "generate": {
      // Flat ops. multiplier always 1.
      return { credits: baseCost, multiplier: 1, baseCost };
    }
  }
}
