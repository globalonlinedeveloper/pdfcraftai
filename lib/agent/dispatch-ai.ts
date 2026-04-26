// lib/agent/dispatch-ai.ts
//
// H6 / H7.3 — ai-route dispatch path. Calls lib/ai/ functions
// directly (not via HTTP — same-process, no auth re-check). Charges
// credits via the same spendCredits the user-facing routes use, so
// admin /admin/usage rolls up agent runs alongside per-tool runs.
//
// Coverage today:
//   • summarize / tldr  — text input
//   • translate          — text input  (H7.3)
//   • rewrite            — text input  (H7.3)
//   • generate           — prompt-only (H7.3, no source file_ids)
//
// Still stubbed (need file-storage infra for the file_id input path,
// or are inherently page/PDF-bound):
//   • ocr, redact, table, compare        — require pdfBytes / file_id
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
import { translatePdf } from "@/lib/ai/translate";
import { rewritePdf } from "@/lib/ai/rewrite";
import { generatePdf } from "@/lib/ai/generate";
import type { AIOperationId } from "@/lib/pricing";
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
 *   - file_id input (file-storage infra not yet shipped)
 *   - non-wired ops (compare, redact, table, ocr — see file header)
 */
export async function dispatchAiStep(
  input: AiDispatchInput,
): Promise<AiDispatchResult> {
  const params = input.step.params as Record<string, unknown>;

  // Resolve text input — explicit `text` param wins, else fall back to
  // priorOutput from the previous step.
  const text =
    typeof params.text === "string" ? (params.text as string) : input.priorOutput;
  const fileId = typeof params.file_id === "string" ? (params.file_id as string) : undefined;

  // file_id without text → stub. ai-generate is exempt (it doesn't
  // take input text at all — generates fresh from a prompt).
  if (fileId && !text && input.aiOp !== "generate") {
    return stubResult({
      step: input.step,
      aiOp: input.aiOp,
      reason: "file_id input requires file-storage infra (not yet shipped)",
      file_id: fileId,
    });
  }

  switch (input.aiOp) {
    case "summarize":
      return runSummarize(input, text, params);
    case "translate":
      return runTranslate(input, text, params);
    case "rewrite":
      return runRewrite(input, text, params);
    case "generate":
      return runGenerate(input, params);
    default:
      // ocr, redact, table, compare — still stubbed (need PDF bytes
      // or two file_ids that we can't yet produce).
      return stubResult({
        step: input.step,
        aiOp: input.aiOp,
        reason: `ai-route dispatch for op '${input.aiOp}' is not yet wired (still requires file_id or PDF bytes)`,
      });
  }
}

// ─── Per-op handlers ────────────────────────────────────────────────────────

async function runSummarize(
  input: AiDispatchInput,
  text: string | undefined,
  params: Record<string, unknown>,
): Promise<AiDispatchResult> {
  if (!text) throwNoInput("summarize", input.step.tool);
  // ai-tldr maps to summarize with depth="tldr".
  const depth =
    input.step.tool === "ai-tldr"
      ? ("tldr" as const)
      : ((params.depth as "tldr" | "standard" | "detailed" | undefined) ??
        "standard");

  const spent = await charge(input, "summarize");
  try {
    const result = await summarizePdf({
      text: text!,
      pageCount: estimatePageCount(text!),
      depth,
      filename: `agent-step-${input.step.idx}`,
      userId: input.userId,
    });
    return {
      outputRef: result.markdown,
      outputType: "text/markdown",
      costCredits: spent,
    };
  } catch (err) {
    throw new Error(`Summarize failed: ${(err as Error).message ?? "unknown"}`);
  }
}

async function runTranslate(
  input: AiDispatchInput,
  text: string | undefined,
  params: Record<string, unknown>,
): Promise<AiDispatchResult> {
  if (!text) throwNoInput("translate", input.step.tool);
  const targetLang = params.target_lang as string | undefined;
  if (!targetLang) {
    throw new Error(`ai-translate step ${input.step.idx} is missing target_lang`);
  }

  const spent = await charge(input, "translate");
  try {
    const result = await translatePdf({
      text: text!,
      pageCount: estimatePageCount(text!),
      targetLang,
      filename: `agent-step-${input.step.idx}`,
    });
    return {
      outputRef: result.markdown,
      outputType: "text/markdown",
      costCredits: spent,
    };
  } catch (err) {
    throw new Error(`Translate failed: ${(err as Error).message ?? "unknown"}`);
  }
}

/**
 * Map the agent's friendly tone names onto the lib/ai/rewrite RewriteMode
 * enum. The agent's options are user-facing labels ("clearer",
 * "shorter") while the lib uses internal mode names ("simplify",
 * "concise"). Keeping the agent's vocabulary friendly was a deliberate
 * choice in the registry — we adapt at the dispatch boundary.
 */
const REWRITE_TONE_MAP: Record<string, "simplify" | "formal" | "casual" | "concise" | "expand"> = {
  formal: "formal",
  casual: "casual",
  clearer: "simplify",
  shorter: "concise",
  // "academic" maps to formal — closest existing mode. A dedicated
  // "academic" mode would need a new system prompt in lib/ai/rewrite.
  academic: "formal",
};

async function runRewrite(
  input: AiDispatchInput,
  text: string | undefined,
  params: Record<string, unknown>,
): Promise<AiDispatchResult> {
  if (!text) throwNoInput("rewrite", input.step.tool);
  const tone = (params.tone as string | undefined) ?? "formal";
  const mode = REWRITE_TONE_MAP[tone] ?? "formal";

  const spent = await charge(input, "rewrite");
  try {
    const result = await rewritePdf({
      text: text!,
      pageCount: estimatePageCount(text!),
      mode,
      filename: `agent-step-${input.step.idx}`,
    });
    return {
      outputRef: result.markdown,
      outputType: "text/markdown",
      costCredits: spent,
    };
  } catch (err) {
    throw new Error(`Rewrite failed: ${(err as Error).message ?? "unknown"}`);
  }
}

async function runGenerate(
  input: AiDispatchInput,
  params: Record<string, unknown>,
): Promise<AiDispatchResult> {
  // ai-generate doesn't consume priorOutput — it's a fresh generation
  // step. The `prompt` param IS the input. source_file_ids would
  // ground it but require file-storage infra → stub if used.
  const prompt = params.prompt as string | undefined;
  if (!prompt) {
    throw new Error(`ai-generate step ${input.step.idx} is missing prompt`);
  }
  const sourceFileIds = params.source_file_ids as string[] | undefined;
  if (sourceFileIds && sourceFileIds.length > 0) {
    return stubResult({
      step: input.step,
      aiOp: input.aiOp,
      reason: "source_file_ids requires file-storage infra (not yet shipped)",
    });
  }

  const spent = await charge(input, "generate");
  try {
    const result = await generatePdf({
      prompt,
      title: (params.output_name as string | undefined) ?? undefined,
    });
    // generatePdf returns markdown + a buffered PDF. For the agent
    // step output, we surface the markdown body — the Download
    // button picks the markdown and produces a .md file. PDF binary
    // surfacing would need a base64 path or a server-side blob store
    // (deferred with file-storage infra).
    return {
      outputRef: result.markdown,
      outputType: "text/markdown",
      costCredits: spent,
    };
  } catch (err) {
    throw new Error(`Generate failed: ${(err as Error).message ?? "unknown"}`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Charge credits for this step. Returns the credits actually spent
 * (0 on duplicate idempotency-key collapse). Throws on insufficient
 * balance — caller shouldn't catch; the executor's outer try/catch
 * will mark the step failed and surface the reason in the agent log.
 */
async function charge(
  input: AiDispatchInput,
  operation: AIOperationId,
): Promise<number> {
  const idempotencyKey = `agent:${input.runId}:${input.step.idx}`;
  const spent = await spendCredits({
    userId: input.userId,
    operation,
    idempotencyKey,
  });
  if (!spent.ok) {
    if (spent.reason === "insufficient") {
      throw new Error(
        `Out of credits — agent step ${input.step.idx} needs ${spent.required}, you have ${spent.balance}. Top up at /pricing.`,
      );
    }
    // duplicate — re-invocation safety. The adapter still runs and
    // produces a fresh output ref; we just return 0 cost since the
    // ledger was already debited.
    return 0;
  }
  return spent.creditsSpent;
}

function throwNoInput(opName: string, tool: string): never {
  throw new Error(
    `ai-${opName} step needs either text param or priorOutput (got neither for tool ${tool})`,
  );
}

function stubResult(args: {
  step: AgentStep;
  aiOp: string;
  reason: string;
  file_id?: string;
}): AiDispatchResult {
  return {
    outputRef: JSON.stringify({
      stub: true,
      reason: args.reason,
      tool: args.step.tool,
      aiOp: args.aiOp,
      ...(args.file_id ? { file_id: args.file_id } : {}),
      runDirectlyAt: `/tool/${args.step.tool}`,
    }),
    outputType: args.aiOp === "generate" || args.file_id ? "json/stub-ai-fileid" : "json/stub-ai-op",
    costCredits: 0,
  };
}

/**
 * Cheap page-count estimate from text length. The lib/ai/* funcs use
 * pageCount in the system prompt to set tone (5-page memo vs 50-page
 * report), so an approximation is fine. ~3000 chars per page is the
 * average for a typical PDF.
 */
function estimatePageCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3000));
}
