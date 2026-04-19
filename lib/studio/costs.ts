// Phase 6.2 — Studio cost estimator.
//
// Studio shows a pre-flight "this batch will cost N credits" figure
// before the user clicks Run. The number has to be a conservative
// UPPER BOUND so we never whisper-charge more than advertised.
//
// Why a separate module instead of inlining in StudioRunner:
//   - Same logic is useful in docs/tests without pulling React.
//   - A single place to update when pricing changes (in parallel with
//     lib/pricing.ts) — the grep for "estimateCost" finds every caller.
//   - Lets the docs example reference the helper by name.

import type { AIOperationId } from "@/lib/pricing";
import { AI_OPERATION_COSTS } from "@/lib/pricing";

import type { BatchItem, StudioToolId } from "@/lib/studio/types";

/**
 * Maximum pages per OCR run. Mirrors CLIENT_MAX_OCR_PAGES in
 * OcrPdfTool.tsx and MAX_OCR_PAGES in lib/ai/ocr.ts — when a PDF's
 * page count isn't known client-side yet (or fails to parse), we
 * use this as the worst-case multiplier so the pre-flight never
 * UNDER-estimates spend.
 *
 * Duplicating the constant (vs. re-exporting from the tool) is
 * intentional: the tool component is a "use client" boundary and
 * importing it from server-side code would pull React into the
 * bundle. A 3-place grep is the lesser evil.
 */
const STUDIO_OCR_PAGE_CAP = 50;

/**
 * Map Studio's UI tool id onto the ledger's AI_OPERATION_COSTS key.
 * Kept as a function (vs. a const object) so adding a new StudioToolId
 * fires a TypeScript non-exhaustive switch error at this site, forcing
 * a deliberate choice of operation id.
 */
function operationForTool(toolId: StudioToolId): AIOperationId {
  switch (toolId) {
    case "ai-summarize":
      return "summarize";
    case "ai-translate":
      return "translate";
    case "ai-ocr":
      return "ocr";
  }
}

/**
 * Estimate the credit cost of a single run.
 *
 *   Summarize / Translate: flat per-file cost from AI_OPERATION_COSTS.
 *   OCR:                   per-page cost × pageCount (falls back to
 *                          STUDIO_OCR_PAGE_CAP when the count is
 *                          unknown — conservative upper bound).
 *
 * The route handler is the source of truth for actual spend; the
 * estimate may legitimately over-count (e.g. a 12-page OCR quoted as
 * 24 credits actually spends 24, but an unknown-page OCR quoted as
 * 100 credits might spend only 24 once the PDF is parsed server-side).
 * That's acceptable — users would rather see "≤ 100" up-front and
 * spend less than the reverse.
 */
export function estimateCost(
  toolId: StudioToolId,
  pageCount?: number
): number {
  const op = operationForTool(toolId);
  const unit = AI_OPERATION_COSTS[op];

  if (toolId === "ai-ocr") {
    // If we parsed a page count already, charge exactly that many
    // pages' worth; otherwise assume the per-tool cap.
    const pages =
      typeof pageCount === "number" && pageCount > 0 && pageCount <= STUDIO_OCR_PAGE_CAP
        ? pageCount
        : STUDIO_OCR_PAGE_CAP;
    return unit * pages;
  }

  // Summarize + Translate are flat per file — pageCount is ignored.
  return unit;
}

/**
 * Sum estimated cost across a queue. Only `pending` + `running` items
 * contribute — already-succeeded, failed, or cancelled rows are no
 * longer in scope for the "you need N credits to continue" warning.
 *
 * Why not include failed items? Retrying a failed item may replay
 * against Phase 5.5's idempotency cache and not re-spend. Quoting
 * the retry cost again would be misleading. If the user clicks
 * Retry-failed, the runner requotes at that moment.
 */
export function sumEstimatedBatchCost(
  toolId: StudioToolId,
  items: ReadonlyArray<BatchItem>
): number {
  let total = 0;
  for (const item of items) {
    if (item.status !== "pending" && item.status !== "running") continue;
    total += estimateCost(toolId, item.pageCount);
  }
  return total;
}
