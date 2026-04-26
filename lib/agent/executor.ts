// lib/agent/executor.ts
//
// Walks an AgentPlan one step at a time, dispatching to the right handler:
//
//   handler="system"    → in-process (lib/agent/system-tools.ts)
//   handler="ai-route"  → POST internally to /api/ai/<op> (H3)
//   handler="wasm-node" → server-side pdf-lib invocation (H3)
//
// H2 ships system-tool dispatch only — ai-route + wasm-node steps are
// marked "skipped" with a TODO message so the run still completes and
// the UI can render the timeline. H3 wires the other dispatch paths.
//
// Lifecycle:
//   1. setRunStatus(running)
//   2. for each step (in idx order):
//        - if status is already terminal, skip
//        - setStepStatus(running)
//        - dispatch handler
//        - setStepStatus(succeeded | failed | awaiting_approval)
//        - if awaiting_approval → break, leave run paused
//        - if failed and not recoverable → break, mark run failed
//   3. setRunStatus(completed | failed)
//
// Why synchronous (not background-job-queued):
//   For H2 the executor runs in the same request as POST /api/agent/run.
//   Hostinger's request budget is generous (~30s) and our typical plan
//   is 4-7 steps of <2s each. If we exceed that we'll move to a queued
//   pattern in H4 (the existing batch-jobs table can host agent work).

import { getAgentTool } from "./tool-registry";
import { getRunForUser, setRunStatus, setStepStatus } from "./run-store";
import { SYSTEM_TOOL_HANDLERS } from "./system-tools";
import { dispatchAiStep } from "./dispatch-ai";
import type { AgentPlan, AgentStep, StepStatus } from "./types";

const MICROS_PER_CREDIT = 40_000;

export interface ExecutorInput {
  runId: string;
  userId: string;
  plan: AgentPlan;
}

export interface ExecutorOutput {
  /** Final run status. */
  status: "completed" | "failed" | "awaiting_approval";
  /** Total cost in micros across all succeeded steps. */
  totalCostMicros: number;
  /** Number of steps that ran (any non-pending status). */
  stepsExecuted: number;
}

/**
 * Run a plan to completion (or until it pauses for approval / fails).
 * Returns the final status. Persists every step's status as it goes.
 */
export async function executePlan(
  input: ExecutorInput,
): Promise<ExecutorOutput> {
  await setRunStatus({ runId: input.runId, status: "running" });

  // Bundle H5: load existing step statuses so re-invocation (after a
  // sys.ask.user approval) skips steps already in terminal state. Without
  // this, calling executePlan twice would re-run completed steps.
  const existing = await getRunForUser({
    runId: input.runId,
    userId: input.userId,
  });
  const existingStatusByIdx = new Map<number, StepStatus>();
  if (existing) {
    for (const s of existing.steps) {
      existingStatusByIdx.set(s.idx, s.status);
    }
  }
  const TERMINAL: ReadonlySet<StepStatus> = new Set([
    "succeeded",
    "failed",
    "skipped",
  ]);

  let totalCostMicros = 0;
  let stepsExecuted = 0;
  let finalStatus: ExecutorOutput["status"] = "completed";

  // H6: thread the most recent succeeded step's output to subsequent
  // ai-route steps so they can use it as input. Pre-load from the
  // existing run snapshot for steps already done; populated incrementally
  // as new steps succeed in the loop below.
  const stepOutputs = new Map<number, { ref: string; type: string | null }>();
  if (existing) {
    for (const s of existing.steps) {
      if (s.status === "succeeded" && s.outputRef) {
        stepOutputs.set(s.idx, { ref: s.outputRef, type: s.outputType });
      }
    }
  }

  for (const step of input.plan.steps) {
    // Skip steps that already reached a terminal state (typical when this
    // is a resume after sys.ask.user approval — the awaiting step has
    // been flipped to "succeeded" by the approve handler before re-invoke).
    if (TERMINAL.has(existingStatusByIdx.get(step.idx) ?? "pending")) {
      continue;
    }

    const def = getAgentTool(step.tool);
    if (!def) {
      // Should never happen — planner already validated against the
      // registry. Skip + record so we don't crash the loop.
      await setStepStatus({
        runId: input.runId,
        idx: step.idx,
        status: "failed",
        errorMessage: `Unknown tool: ${step.tool}`,
      });
      finalStatus = "failed";
      break;
    }

    await setStepStatus({
      runId: input.runId,
      idx: step.idx,
      status: "running",
    });

    try {
      // Pass the most recent succeeded step's output to dispatch so AI
      // steps can chain (e.g. ai-ocr → ai-summarize). Naïve "last
      // succeeded step" wins for now; the planner's `dependsOn` array
      // is the right wiring once step output gets multi-source.
      const lastSucceededIdx = Math.max(...stepOutputs.keys(), 0);
      const priorOutput =
        lastSucceededIdx > 0 ? stepOutputs.get(lastSucceededIdx) : undefined;

      const result = await dispatchStep(
        step,
        def.handler,
        def.aiOp,
        input,
        priorOutput,
      );
      stepsExecuted++;

      if (result.status === "awaiting_approval") {
        // The executor halts here. The user approves via /api/agent/
        // runs/<id>/approve, which re-invokes executePlan with the
        // step status flipped to "succeeded" — the loop picks up at
        // the next step. (H3 wires that endpoint.)
        await setStepStatus({
          runId: input.runId,
          idx: step.idx,
          status: "awaiting_approval",
          outputRef: result.outputRef,
          outputType: result.outputType,
        });
        finalStatus = "awaiting_approval";
        break;
      }

      // succeeded
      const stepCostMicros = (result.costCredits ?? 0) * MICROS_PER_CREDIT;
      totalCostMicros += stepCostMicros;
      await setStepStatus({
        runId: input.runId,
        idx: step.idx,
        status: "succeeded",
        outputRef: result.outputRef,
        outputType: result.outputType,
        costMicros: stepCostMicros,
      });
      // Make this step's output available to downstream steps.
      if (result.outputRef) {
        stepOutputs.set(step.idx, {
          ref: result.outputRef,
          type: result.outputType ?? null,
        });
      }
    } catch (err) {
      const message = (err as Error).message ?? "unknown error";
      await setStepStatus({
        runId: input.runId,
        idx: step.idx,
        status: "failed",
        errorMessage: message.slice(0, 500),
      });
      finalStatus = "failed";
      // Mark remaining steps as skipped so the UI doesn't show them
      // as eternally pending.
      for (const remaining of input.plan.steps.filter(
        (s) => s.idx > step.idx,
      )) {
        await setStepStatus({
          runId: input.runId,
          idx: remaining.idx,
          status: "skipped",
        });
      }
      break;
    }
  }

  await setRunStatus({
    runId: input.runId,
    status: finalStatus,
    totalCostMicros,
    ...(finalStatus === "failed" && { errorMessage: "See step error." }),
  });

  return { status: finalStatus, totalCostMicros, stepsExecuted };
}

interface DispatchResult {
  status: "succeeded" | "awaiting_approval";
  outputRef?: string;
  outputType?: string;
  costCredits?: number;
}

/**
 * Single-step dispatcher. Routes by handler type to the right execution
 * path. H2 implements `system`; H3 fills in `ai-route` and `wasm-node`.
 */
async function dispatchStep(
  step: AgentStep,
  handler: "ai-route" | "wasm-node" | "system",
  aiOp: string | undefined,
  ctx: ExecutorInput,
  priorOutput?: { ref: string; type: string | null },
): Promise<DispatchResult> {
  switch (handler) {
    case "system": {
      const fn = SYSTEM_TOOL_HANDLERS[step.tool];
      if (!fn) {
        throw new Error(`No system handler registered for ${step.tool}`);
      }
      const r = await fn(step.params, {
        userId: ctx.userId,
        runId: ctx.runId,
        stepIdx: step.idx,
      });
      return {
        status: r.status,
        outputRef: r.outputRef,
        outputType: r.outputType,
      };
    }

    case "ai-route": {
      // H6 — real dispatch via lib/agent/dispatch-ai.ts. Today only
      // text-input ops (ai-summarize / ai-tldr with `text` param) run
      // for real. file_id input + non-summarize ops return a structured
      // stub from the dispatcher so the timeline still completes.
      if (!aiOp) {
        throw new Error(`Tool ${step.tool} has handler="ai-route" but no aiOp`);
      }
      // Only thread priorOutput as text when it's actually text — JSON
      // stubs (output_type starts with "json/") aren't useful as text
      // input to summarize/etc.
      const priorText =
        priorOutput &&
        priorOutput.type &&
        !priorOutput.type.startsWith("json/")
          ? priorOutput.ref
          : undefined;

      const r = await dispatchAiStep({
        step,
        aiOp,
        userId: ctx.userId,
        runId: ctx.runId,
        priorOutput: priorText,
        priorOutputType: priorOutput?.type ?? undefined,
      });
      return {
        status: "succeeded",
        outputRef: r.outputRef,
        outputType: r.outputType,
        costCredits: r.costCredits,
      };
    }

    case "wasm-node":
      // H6 will run pdf-lib server-side via shared lib/wasm-server/<tool>.ts
      // helpers. Same gating: needs persistent file storage. Today: stub.
      return {
        status: "succeeded",
        outputRef: JSON.stringify({
          stub: true,
          tool: step.tool,
          params: step.params,
          message:
            "Free-tool step recorded as no-op pending file-storage infrastructure (H6).",
          runDirectlyAt: `/tool/${step.tool}`,
        }),
        outputType: "json/stub-wasm",
        costCredits: 0,
      };

    default:
      throw new Error(`Unknown handler type: ${handler as string}`);
  }
}
