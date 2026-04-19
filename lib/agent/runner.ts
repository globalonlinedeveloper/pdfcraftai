// Phase 6.3 — Agent runner loop with cost-cap guard.
//
// Orchestrates the full client-side walk of an approved agent plan:
//
//   1. For each bucket × step, resolve `inputRef` → `ExecutorInput`.
//   2. Call `executeAgentStep` (lib/agent/executor.ts) to actually run the
//      tool — AI routes hit /api/ai/*, client tools use pdf-lib.
//   3. Call `reportStepOutcomeAction` (lib/agent-actions.ts) to persist
//      the step row's outcome and bump `agent_runs.spent_credits`.
//   4. If that call returns `quoteBreach` (spent > quote) or the executor
//      surfaced `insufficient_credits`, stop the walk and finalize the
//      run as failed with the matching error code. v1 does not support
//      resume-after-top-up; a paused run is terminal.
//   5. When the walk completes normally (all buckets × steps succeeded),
//      call `finalizeRunAction({ok: true})`.
//
// Bucket topology: if `plan.steps[0]` is a queue-level or sub-call tool
// (merge, ai-compare, chat), the bucket count collapses to 1 immediately
// — the server pre-inserted exactly one step row at stepIndex=0,
// fileBucketIndex=0, and subsequent per-file steps (if any) run once
// against bucket 0. Otherwise we iterate buckets 0..N-1.
//
// Iteration order is FILE-MAJOR: the runner finishes every step for
// bucket 0 before moving to bucket 1. Rationale:
//
//   - Users see per-file completion faster ("file 1 done, file 2 running").
//   - A bucket's chain failure is localized — we short-circuit the rest
//     of that bucket but other buckets can still succeed.
//   - Matches the approval-card mental model ("file 1: OCR, then
//     Summarize — file 2: OCR, then Summarize").
//
// This module is CLIENT-ONLY (imports the executor which uses fetch and
// pdf-lib). Do not import it from server code.
//
// This file deliberately does NOT render UI. The Smart mode component
// (task #127) owns state + presentation; this runner just emits
// progress events and resolves with a terminal `RunAgentPlanResult`.

"use client";

import { executeAgentStep, type ExecutorInput, type ExecutorOutput } from "./executor";
import { AGENT_TOOL_CATALOG } from "./catalog";
import type {
  AgentPlan,
  AgentPlanStep,
  AgentStepInputRef,
  AgentStepStatus,
  AgentToolId,
  AgentToolScope,
} from "./types";
import {
  finalizeRunAction,
  reportStepOutcomeAction,
  type ReportStepOutcomeResult,
} from "@/lib/agent-actions";

// --- public event shapes --------------------------------------------------

/**
 * Events the runner emits as it walks the plan. The UI subscribes to these
 * to update the approval-card grid live. Per-step events are emitted in
 * file-major order. Terminal `run-completed` fires exactly once; either
 * `run-completed` OR `run-paused` fires — never both — to simplify the
 * UI's "are we done?" check.
 */
export type RunnerProgressEvent =
  | {
      kind: "step-start";
      runId: string;
      stepIndex: number;
      fileBucketIndex: number;
      toolId: AgentToolId;
    }
  | {
      kind: "step-succeeded";
      runId: string;
      stepIndex: number;
      fileBucketIndex: number;
      toolId: AgentToolId;
      output: ExecutorOutput;
      creditsSpent: number;
      /** Run-level total after this step's debit. */
      spentCreditsTotal: number;
    }
  | {
      kind: "step-failed";
      runId: string;
      stepIndex: number;
      fileBucketIndex: number;
      toolId: AgentToolId;
      /** Narrow code the UI can map to copy (e.g. "insufficient_credits"). */
      code: string;
      message: string;
      /** For insufficient_credits — server's report of required/balance. */
      required?: number;
      balance?: number;
    }
  | {
      kind: "step-skipped";
      runId: string;
      stepIndex: number;
      fileBucketIndex: number;
      toolId: AgentToolId;
      reason: string;
    }
  | {
      kind: "run-paused";
      runId: string;
      reason: "quote_exceeded" | "insufficient_credits";
      spentCredits: number;
      quoteCredits: number;
      message: string;
    }
  | {
      kind: "run-completed";
      runId: string;
      status: "succeeded" | "failed" | "cancelled";
      spentCredits: number;
      /** Populated on failure so the UI can show the right banner. */
      errorCode?: string;
    };

export interface RunAgentPlanArgs {
  runId: string;
  plan: AgentPlan;
  /**
   * Client-side File objects for the queue, in the same order as
   * `queueFileIds`. Typically produced by the Smart-mode dropzone. The
   * runner does NOT re-fetch files from the server — the queue is frozen
   * by the UI between `createRunAction` and `runAgentPlan`.
   */
  queueFiles: File[];
  /**
   * `files.id` values matching `queueFiles[i]`. Needed so the runner can
   * tell the server which source file a per-file step consumed when
   * reporting outcomes (step 0's row already has `file_id` set at insert
   * time, but later steps may need the id re-asserted for the UI grid).
   */
  queueFileIds: string[];
  /**
   * Optional abort signal. Checked at step boundaries; an abort
   * cancels the walk but does NOT call cancelRunAction — the caller
   * should invoke that separately (the UI may want to show "cancelling…"
   * before the DB flip).
   */
  signal?: AbortSignal;
  onProgress?: (ev: RunnerProgressEvent) => void;
}

export type RunAgentPlanResult =
  | { ok: true; status: "succeeded"; spentCredits: number }
  | {
      ok: false;
      status: "failed" | "paused" | "cancelled";
      code: string;
      message: string;
      spentCredits: number;
    };

// --- internal types -------------------------------------------------------

/**
 * Per-bucket output cache. `outputs.get(bucket).get(stepIndex)` returns the
 * ExecutorOutput from a previous step so `{kind: "step", stepIndex}` refs
 * can be resolved.
 */
type OutputsMap = Map<number, Map<number, ExecutorOutput>>;

// --- public entrypoint ----------------------------------------------------

/**
 * Walk the approved plan to completion (or first fatal condition). The
 * caller is responsible for having already gotten the plan approved
 * (status = 'running') via `approveRunAction`; this function does not
 * flip that status itself.
 */
export async function runAgentPlan(
  args: RunAgentPlanArgs,
): Promise<RunAgentPlanResult> {
  const { runId, plan, queueFiles, queueFileIds, signal, onProgress } = args;

  // Defensive: queue length must match what the plan was built against.
  // A mismatch means the UI violated its contract (e.g. added a file
  // after approval). Fail fast rather than produce a confusing trace.
  if (queueFiles.length !== queueFileIds.length) {
    return await finalizeFailed(
      runId,
      "validation_error",
      "Queue files and ids length mismatch.",
      0,
      onProgress,
    );
  }
  if (queueFiles.length !== plan.fileCount) {
    return await finalizeFailed(
      runId,
      "validation_error",
      `Queue has ${queueFiles.length} files, plan expected ${plan.fileCount}.`,
      0,
      onProgress,
    );
  }

  // Determine bucket topology from the first step's scope. Planner
  // invariant: queue-level / sub-call steps only appear at stepIndex 0,
  // so looking at step[0] is enough.
  const step0Scope = scopeOf(plan.steps[0]?.toolId);
  const collapses = step0Scope !== "per-file";
  const bucketCount = collapses ? 1 : plan.fileCount;

  const outputs: OutputsMap = new Map();
  let spentCreditsTotal = 0;

  // Terminal-condition accumulators, set inside the walk.
  let firstFailureCode: string | null = null;
  let firstFailureMessage: string | null = null;
  let pauseReason: "quote_exceeded" | "insufficient_credits" | null = null;
  let pauseMessage: string | null = null;
  let reportFailure: { code: string; message: string } | null = null;
  let cancelled = false;

  walk: for (let bucket = 0; bucket < bucketCount; bucket++) {
    if (!outputs.has(bucket)) outputs.set(bucket, new Map());

    for (let sIdx = 0; sIdx < plan.steps.length; sIdx++) {
      const step = plan.steps[sIdx]!;
      const spec = AGENT_TOOL_CATALOG[step.toolId];

      // Queue-level / sub-call steps only have a row at bucket 0. Guard
      // against a future topology where the planner emits them elsewhere;
      // today this is a no-op for bucketCount=1 flows.
      if (spec && spec.scope !== "per-file" && bucket !== 0) {
        continue;
      }

      // Signal check before starting potentially-expensive work.
      if (signal?.aborted) {
        cancelled = true;
        break walk;
      }

      onProgress?.({
        kind: "step-start",
        runId,
        stepIndex: sIdx,
        fileBucketIndex: bucket,
        toolId: step.toolId,
      });

      // Resolve the step's input from the inputRef.
      const resolved = resolveInput(step, bucket, queueFiles, outputs);
      if (!resolved.ok) {
        await safeReport(runId, sIdx, bucket, {
          status: "failed",
          errorCode: resolved.code,
          errorNote: resolved.message,
          creditsSpent: 0,
        });
        onProgress?.({
          kind: "step-failed",
          runId,
          stepIndex: sIdx,
          fileBucketIndex: bucket,
          toolId: step.toolId,
          code: resolved.code,
          message: resolved.message,
        });
        if (!firstFailureCode) {
          firstFailureCode = resolved.code;
          firstFailureMessage = resolved.message;
        }
        // Bucket chain broken — skip the rest of this bucket. Downstream
        // steps have nothing to consume. Emit 'step-skipped' for UI clarity.
        skipRemainingSteps(
          runId,
          bucket,
          sIdx + 1,
          plan.steps,
          "upstream step failed",
          onProgress,
        );
        break; // next bucket
      }

      // Dispatch to the executor.
      const idempotencyKey = `agent:${runId}:${sIdx}:${bucket}`;
      const sourceFilename = pickSourceFilename(step, bucket, queueFiles);
      const execResult = await executeAgentStep({
        toolId: step.toolId,
        params: step.params,
        input: resolved.input,
        idempotencyKey,
        sourceFilename,
      });

      if (!execResult.ok) {
        // Always report the row as failed so it doesn't sit at 'pending'
        // in the UI. The server-side credit counter didn't move (AI
        // routes refund on internal failures).
        await safeReport(runId, sIdx, bucket, {
          status: "failed",
          errorCode: execResult.code,
          errorNote: execResult.message,
          creditsSpent: 0,
        });
        onProgress?.({
          kind: "step-failed",
          runId,
          stepIndex: sIdx,
          fileBucketIndex: bucket,
          toolId: step.toolId,
          code: execResult.code,
          message: execResult.message,
          required: execResult.required,
          balance: execResult.balance,
        });

        if (execResult.code === "insufficient_credits") {
          // Fatal for the whole run — topping up mid-run isn't wired
          // in v1. Short-circuit out of the outer loop.
          pauseReason = "insufficient_credits";
          pauseMessage = execResult.message;
          skipRemainingSteps(
            runId,
            bucket,
            sIdx + 1,
            plan.steps,
            "run paused (insufficient credits)",
            onProgress,
          );
          break walk;
        }

        if (!firstFailureCode) {
          firstFailureCode = execResult.code;
          firstFailureMessage = execResult.message;
        }
        skipRemainingSteps(
          runId,
          bucket,
          sIdx + 1,
          plan.steps,
          "upstream step failed",
          onProgress,
        );
        break; // next bucket
      }

      // Success path: cache output, report outcome, check quote.
      const output = execResult.output;
      outputs.get(bucket)!.set(sIdx, output);

      const creditsSpent = creditsFromOutput(output);
      const inputFileId = resolveInputFileId(
        step.inputRef,
        bucket,
        queueFileIds,
        outputs,
      );
      const outputFileId = outputFileIdFromExec(output);
      const outputText = outputTextFromExec(output);

      const report = await safeReport(runId, sIdx, bucket, {
        status: "succeeded",
        outputFileId,
        inputFileId,
        outputText,
        creditsSpent,
      });

      if (!report.ok) {
        // The step ran (and was charged) but we couldn't persist the
        // outcome. Surface this as a step-failure for the UI and halt
        // the run — continuing would produce a split-brain DB state.
        onProgress?.({
          kind: "step-failed",
          runId,
          stepIndex: sIdx,
          fileBucketIndex: bucket,
          toolId: step.toolId,
          code: "report_failed",
          message: report.message,
        });
        reportFailure = { code: report.code, message: report.message };
        break walk;
      }

      spentCreditsTotal = report.spentCredits;
      onProgress?.({
        kind: "step-succeeded",
        runId,
        stepIndex: sIdx,
        fileBucketIndex: bucket,
        toolId: step.toolId,
        output,
        creditsSpent,
        spentCreditsTotal,
      });

      if (report.quoteBreach) {
        pauseReason = "quote_exceeded";
        pauseMessage = `Spent ${report.spentCredits} credits, quote was ${report.quoteCredits}. Run halted to protect your balance.`;
        skipRemainingSteps(
          runId,
          bucket,
          sIdx + 1,
          plan.steps,
          "run paused (quote exceeded)",
          onProgress,
        );
        // Also skip any later buckets entirely.
        skipRemainingBuckets(
          runId,
          bucket + 1,
          bucketCount,
          plan.steps,
          collapses,
          "run paused (quote exceeded)",
          onProgress,
        );
        break walk;
      }
    }
  }

  // --- terminal state resolution ----------------------------------------

  if (cancelled) {
    onProgress?.({
      kind: "run-completed",
      runId,
      status: "cancelled",
      spentCredits: spentCreditsTotal,
    });
    return {
      ok: false,
      status: "cancelled",
      code: "aborted",
      message: "Run aborted by user.",
      spentCredits: spentCreditsTotal,
    };
  }

  if (pauseReason) {
    const msg = pauseMessage ?? "Run paused.";
    // v1 semantics: a paused run finalizes to failed so the DB doesn't
    // hold a zombie 'running' row. The errorCode makes the reason
    // machine-readable for the UI banner.
    await safeFinalize(runId, {
      ok: false,
      errorCode: pauseReason,
      errorNote: msg,
    });
    onProgress?.({
      kind: "run-paused",
      runId,
      reason: pauseReason,
      spentCredits: spentCreditsTotal,
      quoteCredits: plan.totalQuote,
      message: msg,
    });
    return {
      ok: false,
      status: "paused",
      code: pauseReason,
      message: msg,
      spentCredits: spentCreditsTotal,
    };
  }

  if (reportFailure) {
    await safeFinalize(runId, {
      ok: false,
      errorCode: reportFailure.code,
      errorNote: reportFailure.message,
    });
    onProgress?.({
      kind: "run-completed",
      runId,
      status: "failed",
      spentCredits: spentCreditsTotal,
      errorCode: reportFailure.code,
    });
    return {
      ok: false,
      status: "failed",
      code: reportFailure.code,
      message: reportFailure.message,
      spentCredits: spentCreditsTotal,
    };
  }

  if (firstFailureCode) {
    const code = firstFailureCode;
    const msg = firstFailureMessage ?? "One or more steps failed.";
    await safeFinalize(runId, { ok: false, errorCode: code, errorNote: msg });
    onProgress?.({
      kind: "run-completed",
      runId,
      status: "failed",
      spentCredits: spentCreditsTotal,
      errorCode: code,
    });
    return {
      ok: false,
      status: "failed",
      code,
      message: msg,
      spentCredits: spentCreditsTotal,
    };
  }

  // All buckets, all steps — success.
  await safeFinalize(runId, { ok: true });
  onProgress?.({
    kind: "run-completed",
    runId,
    status: "succeeded",
    spentCredits: spentCreditsTotal,
  });
  return {
    ok: true,
    status: "succeeded",
    spentCredits: spentCreditsTotal,
  };
}

// --- input resolution -----------------------------------------------------

type ResolveInputOk = { ok: true; input: ExecutorInput };
type ResolveInputErr = {
  ok: false;
  code: "validation_error" | "file_deleted_mid_run";
  message: string;
};

/**
 * Map a step's `inputRef` + current bucket to a concrete `ExecutorInput`.
 *
 * merge/ai-compare are special: they don't fan per-bucket, and their
 * expected ExecutorInput shape is pdf-list / pdf-pair respectively. The
 * function handles them by short-circuiting on toolId before falling
 * through to the generic single-file resolution.
 */
function resolveInput(
  step: AgentPlanStep,
  bucket: number,
  queueFiles: File[],
  outputs: OutputsMap,
): ResolveInputOk | ResolveInputErr {
  const spec = AGENT_TOOL_CATALOG[step.toolId];
  if (!spec) {
    return {
      ok: false,
      code: "validation_error",
      message: `Unknown toolId: ${step.toolId}`,
    };
  }

  // chat and other inputKind="none" tools.
  if (spec.inputKind === "none") {
    return { ok: true, input: { kind: "none" } };
  }

  // merge: always the whole queue, regardless of what inputRef says.
  if (spec.id === "merge") {
    if (queueFiles.length < 2) {
      return {
        ok: false,
        code: "validation_error",
        message: "merge requires at least 2 files.",
      };
    }
    return {
      ok: true,
      input: { kind: "pdf-list", files: [...queueFiles] },
    };
  }

  // ai-compare: pair input. Planner guarantees exactly two files.
  if (spec.id === "ai-compare") {
    if (queueFiles.length < 2) {
      return {
        ok: false,
        code: "validation_error",
        message: "ai-compare requires exactly two files in the queue.",
      };
    }
    if (step.inputRef.kind !== "pair") {
      return {
        ok: false,
        code: "validation_error",
        message: "ai-compare step must use a pair inputRef.",
      };
    }
    // Convention: pair leg a → queueFiles[0], leg b → queueFiles[1].
    // `resolveSingle` accepts a `sourceBucket` override so the two legs
    // can disambiguate which source file to pull.
    const legA = resolveSingle(step.inputRef.a, bucket, queueFiles, outputs, 0);
    if (!legA.ok) return legA;
    const legB = resolveSingle(step.inputRef.b, bucket, queueFiles, outputs, 1);
    if (!legB.ok) return legB;
    if (!legA.file || !legB.file) {
      return {
        ok: false,
        code: "validation_error",
        message: "ai-compare pair legs must resolve to PDF files.",
      };
    }
    return {
      ok: true,
      input: { kind: "pdf-pair", a: legA.file, b: legB.file },
    };
  }

  // All other tools: single-file (or chained-markdown) input.
  const single = resolveSingle(step.inputRef, bucket, queueFiles, outputs, bucket);
  if (!single.ok) return single;

  if (single.file) {
    return { ok: true, input: { kind: "pdf", file: single.file } };
  }
  if (single.markdown !== undefined) {
    return { ok: true, input: { kind: "markdown", text: single.markdown } };
  }

  return {
    ok: false,
    code: "validation_error",
    message: `Could not resolve input for step ${step.stepIndex}, bucket ${bucket}.`,
  };
}

type ResolveSingleOk = {
  ok: true;
  /** PDF file if the resolved ref produced one; null for text/markdown refs. */
  file: File | null;
  /** Set when the ref resolved to a markdown/text output from a prior step. */
  markdown?: string;
};

/**
 * Resolve a single (non-pair) inputRef. `sourceBucket` lets callers
 * override which queueFiles[] entry the "source" kind maps to — used by
 * ai-compare to split a pair across queueFiles[0] and queueFiles[1].
 */
function resolveSingle(
  ref: AgentStepInputRef,
  bucket: number,
  queueFiles: File[],
  outputs: OutputsMap,
  sourceBucket: number,
): ResolveSingleOk | ResolveInputErr {
  switch (ref.kind) {
    case "source": {
      const f = queueFiles[sourceBucket];
      if (!f) {
        return {
          ok: false,
          code: "file_deleted_mid_run",
          message: `Source file at index ${sourceBucket} is missing from the queue.`,
        };
      }
      return { ok: true, file: f };
    }
    case "step": {
      const prior = outputs.get(bucket)?.get(ref.stepIndex);
      if (!prior) {
        return {
          ok: false,
          code: "validation_error",
          message: `No output cached for step ${ref.stepIndex}, bucket ${bucket} — upstream step did not produce a usable output.`,
        };
      }
      switch (prior.kind) {
        case "pdf":
          return { ok: true, file: prior.file };
        case "markdown":
          return { ok: true, file: null, markdown: prior.text };
        case "text":
          return { ok: true, file: null, markdown: prior.text };
        case "pdf-multi":
          return {
            ok: false,
            code: "validation_error",
            message:
              "Cannot chain from a split step — pdf-multi output is terminal in v1.",
          };
      }
      // Exhaustive — unreachable but satisfies the linter.
      return {
        ok: false,
        code: "validation_error",
        message: "Unhandled output kind.",
      };
    }
    case "pair":
      // Nested pair is not part of v1 semantics. Planner validation
      // should have rejected it; surface loudly.
      return {
        ok: false,
        code: "validation_error",
        message: "Nested pair refs are not supported in v1.",
      };
  }
}

// --- outcome helpers ------------------------------------------------------

/**
 * Extract the credit cost the executor surfaced. Markdown (AI routes) and
 * text (chat) outputs carry `creditCost` straight from the server
 * response. Client pdf-lib outputs (pdf, pdf-multi) are always 0.
 */
function creditsFromOutput(out: ExecutorOutput): number {
  switch (out.kind) {
    case "markdown":
      return out.creditCost;
    case "text":
      return out.creditCost;
    case "pdf":
    case "pdf-multi":
      return 0;
  }
}

/**
 * Pull the `files.id` the server assigned to the step's primary output,
 * if any. Markdown outputs always have one (the AI route writes both a
 * files row and an ai_outputs row). pdf-lib outputs have none — the
 * Smart-mode UI can persist them lazily via Phase 3's logToolResultAction
 * if desired, but that's not the runner's job.
 */
function outputFileIdFromExec(out: ExecutorOutput): string | undefined {
  switch (out.kind) {
    case "markdown":
      return out.fileId;
    case "pdf":
      return out.fileId; // usually undefined for client tools.
    case "text":
    case "pdf-multi":
      return undefined;
  }
}

/**
 * For chat / text outputs, surface the short free-form answer so the
 * server row captures it. Capped at 200k chars by the Zod schema upstream.
 */
function outputTextFromExec(out: ExecutorOutput): string | undefined {
  return out.kind === "text" ? out.text : undefined;
}

/**
 * Derive the file id the step consumed as input. Used so the
 * agent_run_steps row records a back-pointer for the UI grid.
 *
 *   source  → queueFileIds[bucket]
 *   step N  → outputs[bucket][N].fileId (if any — pdf-lib outputs omit it)
 *   pair    → undefined; the row for a pair step carries both sides in
 *             input_json rather than a single input_file_id.
 */
function resolveInputFileId(
  ref: AgentStepInputRef,
  bucket: number,
  queueFileIds: string[],
  outputs: OutputsMap,
): string | undefined {
  switch (ref.kind) {
    case "source":
      return queueFileIds[bucket];
    case "step": {
      const prior = outputs.get(bucket)?.get(ref.stepIndex);
      if (!prior) return undefined;
      if (prior.kind === "pdf") return prior.fileId;
      if (prior.kind === "markdown") return prior.fileId;
      return undefined;
    }
    case "pair":
      return undefined;
  }
}

/**
 * Best-effort source filename passed to the executor for naming
 * pdf-lib outputs ("invoice.pdf" → "invoice-rotated90.pdf"). For
 * queue-level steps we pick the first file so the output has a
 * human-meaningful prefix.
 */
function pickSourceFilename(
  step: AgentPlanStep,
  bucket: number,
  queueFiles: File[],
): string | undefined {
  const spec = AGENT_TOOL_CATALOG[step.toolId];
  if (!spec) return undefined;
  if (spec.scope === "per-file") return queueFiles[bucket]?.name;
  return queueFiles[0]?.name;
}

function scopeOf(toolId: AgentToolId | undefined): AgentToolScope {
  if (!toolId) return "per-file";
  return AGENT_TOOL_CATALOG[toolId]?.scope ?? "per-file";
}

// --- emit "skipped" events so the UI can clear the pending rows ----------

function skipRemainingSteps(
  runId: string,
  bucket: number,
  fromStepIndex: number,
  steps: AgentPlanStep[],
  reason: string,
  onProgress?: (ev: RunnerProgressEvent) => void,
): void {
  if (!onProgress) return;
  for (let i = fromStepIndex; i < steps.length; i++) {
    const step = steps[i]!;
    const spec = AGENT_TOOL_CATALOG[step.toolId];
    if (spec && spec.scope !== "per-file" && bucket !== 0) continue;
    onProgress({
      kind: "step-skipped",
      runId,
      stepIndex: i,
      fileBucketIndex: bucket,
      toolId: step.toolId,
      reason,
    });
  }
}

function skipRemainingBuckets(
  runId: string,
  fromBucket: number,
  bucketCount: number,
  steps: AgentPlanStep[],
  collapsed: boolean,
  reason: string,
  onProgress?: (ev: RunnerProgressEvent) => void,
): void {
  if (!onProgress) return;
  if (collapsed) return; // only 1 bucket exists
  for (let b = fromBucket; b < bucketCount; b++) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const spec = AGENT_TOOL_CATALOG[step.toolId];
      if (spec && spec.scope !== "per-file" && b !== 0) continue;
      onProgress({
        kind: "step-skipped",
        runId,
        stepIndex: i,
        fileBucketIndex: b,
        toolId: step.toolId,
        reason,
      });
    }
  }
}

// --- server-action wrappers (swallow network errors) ---------------------

/**
 * Inline argument shape for `reportStepOutcomeAction` — inferred from
 * the server-action's Zod schema. Stated here so TS catches drift between
 * the runner's report calls and the action's contract.
 */
type ReportOutcomeBody =
  | {
      status: "succeeded";
      aiOutputId?: string;
      outputFileId?: string;
      outputText?: string;
      inputFileId?: string;
      creditsSpent: number;
    }
  | {
      status: "failed";
      errorCode: string;
      errorNote?: string;
      creditsSpent: number;
    }
  | { status: AgentStepStatus & ("cancelled" | "skipped"); errorNote?: string };

async function safeReport(
  runId: string,
  stepIndex: number,
  fileBucketIndex: number,
  outcome: ReportOutcomeBody,
): Promise<ReportStepOutcomeResult> {
  try {
    return await reportStepOutcomeAction({
      runId,
      stepIndex,
      fileBucketIndex,
      outcome,
    });
  } catch (err) {
    // Network / serialization blip. Surface as an action-level failure
    // the runner can treat like any other step report failure.
    console.error("[runAgentPlan] reportStepOutcomeAction threw", err);
    return {
      ok: false,
      code: "db_error",
      message:
        err instanceof Error
          ? `Failed to record step outcome: ${err.message}`
          : "Failed to record step outcome.",
    };
  }
}

/**
 * `finalizeRunAction` is idempotent server-side. We still wrap the call
 * so a transient network error during finalize doesn't throw out of the
 * runner — the UI polls `getRunStatusAction` later and will eventually
 * reconcile the state.
 */
async function safeFinalize(
  runId: string,
  outcome:
    | { ok: true }
    | { ok: false; errorCode: string; errorNote?: string },
): Promise<void> {
  try {
    await finalizeRunAction({ runId, outcome });
  } catch (err) {
    console.error("[runAgentPlan] finalizeRunAction threw", err);
  }
}

async function finalizeFailed(
  runId: string,
  code: string,
  message: string,
  spentCredits: number,
  onProgress?: (ev: RunnerProgressEvent) => void,
): Promise<RunAgentPlanResult> {
  await safeFinalize(runId, { ok: false, errorCode: code, errorNote: message });
  onProgress?.({
    kind: "run-completed",
    runId,
    status: "failed",
    spentCredits,
    errorCode: code,
  });
  return {
    ok: false,
    status: "failed",
    code,
    message,
    spentCredits,
  };
}
