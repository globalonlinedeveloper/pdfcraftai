// Phase 6.3 — Agent tool catalog.
//
// Machine-readable metadata for every tool the planner is allowed to pick.
// The planner embeds this verbatim in its system prompt (see
// `lib/agent/planner.ts`) so the LLM knows exactly which tools exist, what
// they take, what they produce, and how much they cost. The executor reads
// the same rows at dispatch time to validate params, wire up `inputRef`
// resolution, and debit credits in line with what the approval card quoted.
//
// Keep this file small and data-only — no runtime side effects. Anything
// that needs a fetch (an AI call, a file read) lives in the executor.
//
// Source of truth for allowed tool IDs: `AgentToolId` in `types.ts`. Adding
// a row here without extending that union is a TS error, and vice versa.
//
// Cost shapes mirror `AI_OPERATION_COSTS` in `lib/pricing.ts`:
//   summarize=3, translate=5, compare=15, ocr=2/page, chat_turn=1.
// Free client-side tools (merge/split/rotate/compress) cost zero credits.

import { AI_OPERATION_COSTS } from "@/lib/pricing";
import type { AgentToolId, AgentToolSpec } from "./types";

/**
 * Upper bound on OCR pages we'll quote up front. The real page count is
 * fetched at plan time via a server-side peek; if a file exceeds the cap,
 * the planner refuses (or downgrades the recommendation). Kept at 50 to
 * match the existing `/api/ai/ocr` per-request ceiling and keep quotes
 * bounded so a surprise 500-page scan can't blow through a user's balance.
 */
const OCR_PAGE_CAP = 50;

/**
 * Frozen registry of every tool the planner may emit.
 *
 * Iteration order matches the planner's preferred mention order in the
 * system prompt: AI ops first (highest user value), queue-level PDF ops
 * next, then per-file PDF ops, with `chat` last as the escape hatch for
 * zero-file reasoning.
 */
export const AGENT_TOOL_CATALOG: Readonly<Record<AgentToolId, AgentToolSpec>> = {
  // --- AI tools (server-side, cost credits) -------------------------------
  "ai-summarize": {
    id: "ai-summarize",
    displayName: "Summarize",
    description:
      "Produce an executive summary plus section bullets for one PDF. Output is markdown.",
    side: "server",
    scope: "per-file",
    inputKind: "pdf",
    outputKind: "markdown",
    cost: { kind: "flat", credits: AI_OPERATION_COSTS.summarize },
    paramsHint: `{depth: "tldr" | "standard" | "detailed"}`,
    constraints: [
      "Requires a readable (non-encrypted) PDF. For scans, run ai-ocr first.",
      "Depth defaults to 'standard' if the user's request is ambiguous.",
    ],
  },
  "ai-translate": {
    id: "ai-translate",
    displayName: "Translate",
    description:
      "Translate a PDF's text into a target language. Output is markdown preserving section structure.",
    side: "server",
    scope: "per-file",
    inputKind: "pdf",
    outputKind: "markdown",
    cost: { kind: "flat", credits: AI_OPERATION_COSTS.translate },
    paramsHint: `{targetLang: string /* ISO 639-1 code, e.g. "es", "fr", "zh" */}`,
    constraints: [
      "Requires a readable (non-encrypted) PDF. For scans, run ai-ocr first.",
      "`targetLang` MUST be a two-letter ISO code. Use 'es' (not 'Spanish').",
    ],
  },
  "ai-compare": {
    id: "ai-compare",
    displayName: "Compare",
    description:
      "Diff two PDFs and return a structured change list with AI severity analysis. Output is markdown.",
    side: "server",
    scope: "queue-level",
    inputKind: "pdf-pair",
    outputKind: "markdown",
    cost: { kind: "flat", credits: AI_OPERATION_COSTS.compare },
    paramsHint: `{}  /* pair input carries both sides */`,
    constraints: [
      "Requires EXACTLY two input PDFs. Refuse if the queue has !=2 files.",
      "Both sides must be readable (non-encrypted). For scans, run ai-ocr first on each, then compare is out of scope for v1.",
      "Runs once per plan (queue-level), not per file. May only appear at stepIndex 0.",
    ],
  },
  "ai-ocr": {
    id: "ai-ocr",
    displayName: "OCR",
    description:
      "Turn a scanned or image-based PDF into searchable text + structured data. Output is markdown.",
    side: "server",
    scope: "per-file",
    inputKind: "pdf",
    outputKind: "markdown",
    cost: {
      kind: "perPage",
      creditsPerPage: AI_OPERATION_COSTS.ocr,
      pageCap: OCR_PAGE_CAP,
    },
    paramsHint: `{}`,
    constraints: [
      `Per-page cost applies — quote = pages * ${AI_OPERATION_COSTS.ocr}. Files over ${OCR_PAGE_CAP} pages are refused at plan time.`,
      "Most useful as step 0 for scanned PDFs; downstream ai-summarize / ai-translate then run against the OCR'd text is NOT yet wired for v1 (they take the original PDF).",
    ],
  },

  // --- Free tools (client-side, zero credits) -----------------------------
  merge: {
    id: "merge",
    displayName: "Merge",
    description:
      "Combine every file in the queue into a single PDF, in queue order. Output is one PDF.",
    side: "client",
    scope: "queue-level",
    inputKind: "pdf",
    outputKind: "pdf",
    cost: { kind: "zero" },
    paramsHint: `{}`,
    constraints: [
      "Requires at least 2 input PDFs.",
      "Runs once per plan (queue-level). May only appear at stepIndex 0.",
      "All inputs must be non-encrypted.",
    ],
  },
  split: {
    id: "split",
    displayName: "Split",
    description:
      "Split one PDF into multiple PDFs by page range. Output is multiple PDFs — terminal in v1 (cannot feed another step).",
    side: "client",
    scope: "per-file",
    inputKind: "pdf",
    outputKind: "pdf-multi",
    cost: { kind: "zero" },
    paramsHint: `{ranges: string /* e.g. "1-5,10-,12" */}`,
    constraints: [
      "Output kind is pdf-multi; v1 planner MUST terminate the chain at a split step.",
      "Requires a non-encrypted PDF.",
      "`ranges` must be a valid range spec; the executor validates with Zod.",
    ],
  },
  rotate: {
    id: "rotate",
    displayName: "Rotate",
    description:
      "Rotate every page of a PDF by a fixed angle. Output is a new PDF with the same page count.",
    side: "client",
    scope: "per-file",
    inputKind: "pdf",
    outputKind: "pdf",
    cost: { kind: "zero" },
    paramsHint: `{rotation: 90 | 180 | 270}`,
    constraints: [
      "Requires a non-encrypted PDF.",
      "Only 90, 180, 270 are valid rotations; 0 is a no-op and rejected.",
    ],
  },
  compress: {
    id: "compress",
    displayName: "Compress",
    description:
      "Shrink a PDF's file size. Output is a new, smaller PDF with the same page count.",
    side: "client",
    scope: "per-file",
    inputKind: "pdf",
    outputKind: "pdf",
    cost: { kind: "zero" },
    paramsHint: `{}`,
    constraints: [
      "Requires a non-encrypted PDF.",
      "Large savings are not guaranteed — worst case returns the original bytes.",
    ],
  },

  // --- Sub-call / reasoning tool ------------------------------------------
  chat: {
    id: "chat",
    displayName: "Chat",
    description:
      "One-shot reasoning step that does not touch the file queue. Useful when the user's ask is an open-ended question the agent can answer without running a tool.",
    side: "server",
    scope: "sub-call",
    inputKind: "none",
    outputKind: "text",
    cost: { kind: "chatTurn", credits: AI_OPERATION_COSTS.chat_turn },
    paramsHint: `{prompt: string}`,
    constraints: [
      "Does not fan out per file. Runs exactly once.",
      "Output is free-form text — terminal in any chain (cannot feed another step).",
      "Prefer concrete tools (summarize/translate/etc) when the user's ask maps to one.",
    ],
  },
} as const;

/**
 * Convenience accessor. Throws on an unknown id so a bad LLM output surfaces
 * as a runtime error caught by the executor's try/catch, not a silent
 * `undefined` dereference deeper in the dispatch code.
 */
export function getAgentToolSpec(id: AgentToolId): AgentToolSpec {
  const spec = AGENT_TOOL_CATALOG[id];
  if (!spec) {
    throw new Error(`[agent/catalog] unknown toolId: ${id}`);
  }
  return spec;
}

/**
 * The ordered list of tool IDs the planner's system prompt cites. Declared
 * here (rather than `Object.keys(AGENT_TOOL_CATALOG)`) so the order is
 * stable regardless of object-literal iteration semantics across engines.
 */
export const AGENT_TOOL_ORDER: readonly AgentToolId[] = [
  "ai-summarize",
  "ai-translate",
  "ai-compare",
  "ai-ocr",
  "merge",
  "split",
  "rotate",
  "compress",
  "chat",
] as const;

/**
 * Compute the per-unit upper bound cost for a tool, given the known inputs
 * at plan time. Used by the planner to fill `AgentPlanStep.estimatedCostPerUnit`
 * and by the runner to cross-check a step's declared cost before execution.
 *
 *   flat     → returns spec.cost.credits
 *   perPage  → returns spec.cost.creditsPerPage * min(pages, pageCap)
 *              Caller passes the real page count; missing input falls back
 *              to pageCap (conservative upper bound) so a quote is never
 *              under-stated.
 *   zero     → returns 0
 *   chatTurn → returns spec.cost.credits
 *
 * The planner multiplies this by fileCount for per-file scope or by 1 for
 * queue-level / sub-call scope — handled in planner.ts, not here, since
 * this function only knows per-unit cost.
 */
export function computeStepUnitCost(
  spec: AgentToolSpec,
  opts?: { pages?: number },
): number {
  switch (spec.cost.kind) {
    case "flat":
      return spec.cost.credits;
    case "zero":
      return 0;
    case "chatTurn":
      return spec.cost.credits;
    case "perPage": {
      const pages = Math.max(
        1,
        Math.min(opts?.pages ?? spec.cost.pageCap, spec.cost.pageCap),
      );
      return spec.cost.creditsPerPage * pages;
    }
  }
}
