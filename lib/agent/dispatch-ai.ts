// lib/agent/dispatch-ai.ts
//
// H6 — first real ai-route dispatch path. Calls lib/ai/ functions
// directly (not via HTTP — same-process, no auth re-check). Charges
// credits via the same spendCredits the user-facing routes use, so
// admin /admin/usage rolls up agent runs alongside per-tool runs.
//
// Today's coverage: text-input AI ops only — ai-summarize / ai-tldr
// when called with a `text` param. PDF-input variants (file_id) wait
// for file-storage infrastructure (the storage_key column in the
// files table is a "Phase 2 stub" — see db/schema/app.ts).
//
// Architecture decision: we DON'T re-implement what /api/ai/<op>/route.ts
// does. We call lib/ai/<op>.ts directly. The route handler is just a
// thin HTTP/auth/multipart wrapper around the lib function — for the
// agent we already have user context + plan, so we skip the wrapper.
//
// Idempotency: the executor's runId + stepIdx forms a stable
// idempotency key. spendCredits collapses retries via that key, so
// even if the executor re-invokes a step (e.g. after sys.ask.user
// approval) the user only gets charged once.

import { spendCredits } from "@/lib/ai/credits";
import { summarizePdf } from "@/lib/ai/summarize";
import type { AgentStep } from "./types";

export interface AiDispatchInput {
  step: AgentStep;
  /** AI op key from the registry (e.g. "summarize", "translate"). */
  aiOp: string;
  userId: string;
  runId: string;
  /**
   * Output of the prior step (when the planner chose to consume it).
   * String for text/markdown, or JSON-stringified for structured outputs.
   * undefined when this is the first AI step in the plan.
   */
  priorOutput?: string;
  priorOutputType?: string;
}

export interface AiDispatchResult {
  /** Markdown / text output the user sees. */
  outputRef: string;
  outputType: string;
  /** Credits actually debited (0 if the call failed before spendCredits). */
  costCredits: number;
}

/**
 * Dispatch an ai-route step. Returns the new step output + cost.
 *
 * Throws on:
 *   - missing input (no file_id and no text and no priorOutput)
 *   - underlying AI provider failure (executor catches → step="failed")
 *   - insufficient credits (spendCredits throws)
 *
 * Skips with a stub on:
 *   - file_id input (file-storage infra not yet shipped — H7)
 *   - non-summarize ops (only summarize/tldr wired in H6)
 */
export async function dispatchAiStep(
  input: AiDispatchInput,
): Promise<AiDispatchResult> {
  const params = input.step.params as {
    file_id?: string;
    text?: string;
    depth?: "tldr" | "standard" | "detailed";
  };

  // Resolve text input — explicit `text` param wins, else fall back to
  // priorOutput (from the previous step if any).
  const text = params.text ?? input.priorOutput;

  // file_id path is gated on file-storage infra — record a structured
  // stub so the timeline shows what's pending.
  if (params.file_id && !text) {
    return {
      outputRef: JSON.stringify({
        stub: true,
        reason: "file_id input requires file-storage infra (deferred to H7)",
        file_id: params.file_id,
        runDirectlyAt: `/tool/${input.step.tool}`,
      }),
      outputType: "json/stub-ai-fileid",
      costCredits: 0,
    };
  }

  if (!text) {
    throw new Error(
      `ai-route step needs either text param or priorOutput (got neither for tool ${input.step.tool})`,
    );
  }

  // Only summarize-class ops wired in H6. Translate/rewrite/etc. follow
  // the same pattern but each needs its own dispatch case below.
  switch (input.aiOp) {
    case "summarize": {
      // ai-tldr maps to summarize with depth="tldr".
      const depth =
        input.step.tool === "ai-tldr" ? "tldr" : (params.depth ?? "standard");

      // Charge first (idempotent — same key collapses retries). Refund
      // on adapter failure happens in the executor's outer catch via
      // refundCredits keyed off the same idempotencyKey.
      const idempotencyKey = `agent:${input.runId}:${input.step.idx}`;
      const spent = await spendCredits({
        userId: input.userId,
        operation: "summarize",
        idempotencyKey,
      });
      if (!spent.ok) {
        if (spent.reason === "insufficient") {
          throw new Error(
            `Out of credits — agent step ${input.step.idx} needs ${spent.required}, you have ${spent.balance}. Top up at /pricing.`,
          );
        }
        // duplicate — treat as success path; the prior call's output
        // should already be on the step row from the earlier execute.
        // For agent re-invocation safety we still call the adapter so
        // we have a fresh markdown output (cheaper than rehydrating).
        // Future: skip the adapter call when we can fetch the prior
        // ai_outputs row by idempotencyKey.
      }

      try {
        const result = await summarizePdf({
          text,
          pageCount: estimatePageCount(text),
          depth,
          filename: `agent-step-${input.step.idx}`,
          userId: input.userId,
        });
        return {
          outputRef: result.markdown,
          outputType: "text/markdown",
          costCredits: spent.ok ? spent.creditsSpent : 0,
        };
      } catch (err) {
        // Refund handled by the executor's try/catch — but log here for
        // diagnostics so the step's error message is informative.
        throw new Error(
          `Summarize call failed: ${(err as Error).message ?? "unknown"}`,
        );
      }
    }

    default:
      // For ai-translate, ai-rewrite, ai-redact etc. we'd add a case here
      // calling the matching lib function. Each needs its own input shape
      // (translate: target_lang; rewrite: tone; redact: categories; etc.).
      // Until those cases land, return a structured stub.
      return {
        outputRef: JSON.stringify({
          stub: true,
          reason: `ai-route dispatch for op '${input.aiOp}' not yet wired (text-input variants land in H7+)`,
          tool: input.step.tool,
          aiOp: input.aiOp,
          runDirectlyAt: `/tool/${input.step.tool}`,
        }),
        outputType: "json/stub-ai-op",
        costCredits: 0,
      };
  }
}

/**
 * Cheap page-count estimate from text length. The summarize lib uses
 * pageCount in the system prompt to set tone (5-page memo vs 50-page
 * report), so an approximation is fine. ~3000 chars per page is the
 * average for a typical PDF.
 */
function estimatePageCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3000));
}
