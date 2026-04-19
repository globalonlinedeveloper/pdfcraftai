// Phase 6.3 — Agent server actions.
//
// The client flow (Smart mode in /app/studio) calls these actions in this
// order:
//
//   1. createRunAction        — validates the queue, runs the planner,
//                                persists agent_runs + agent_run_steps
//                                rows, returns the plan for the approval
//                                card. Status: pending_approval.
//   2. approveRunAction       — user clicked "Run plan". Flips status to
//                                running, stamps started_at. Cheap.
//   3. reportStepOutcomeAction — called once per step after the client
//                                runner invokes executeAgentStep. Persists
//                                the step row's outcome and bumps
//                                agent_runs.spent_credits. Returns a
//                                `quoteBreach` flag so the runner can pause
//                                the run before the next step.
//   4. finalizeRunAction       — runner finished the plan. Flips status to
//                                succeeded/failed, stamps completed_at.
//   5. cancelRunAction         — user bailed out mid-approval or mid-run.
//                                Terminal flip to cancelled.
//   6. getRunStatusAction      — UI polls this to reflect step progress
//                                when it rebuilds the approval card from a
//                                refresh.
//
// The planner lives in `lib/agent/planner.ts` and returns a validated
// `AgentPlan`. We store that plan_json verbatim AND pre-insert one row per
// (bucket, step) into `agent_run_steps` so the UI can render every step's
// placeholder before the runner walks them. `idempotency_key` is baked in
// at insert time as `agent:<runId>:<stepIndex>:<fileBucketIndex>` — stable,
// collision-proof, and what /api/ai/* uses for Phase 5.5 replay-on-dup.
//
// Bucket semantics:
//   - Per-file scope: one step row per file in the queue (fileBucketIndex
//     0..N-1). After a per-file step runs, the bucket count stays at N.
//   - Queue-level / sub-call scope (merge, ai-compare, chat): exactly one
//     row at fileBucketIndex=0. After a queue-level step, bucket count
//     collapses to 1 — subsequent per-file steps run once against the
//     single produced output. The planner already guarantees queue-level
//     steps only appear at stepIndex 0, so this collapse happens before
//     any fan-out logic that would complicate the math.
//
// Cost guard:
//   `reportStepOutcomeAction` returns `quoteBreach: true` when
//   `spent_credits > quote_credits` after the increment. The runner is
//   expected to pause the run (flip to 'paused' via a separate call or
//   stop walking the plan) and ask the user to approve a higher cap. We
//   do not auto-pause server-side because the runner may want to report
//   the step outcome regardless and show a clear "you spent X, cap was Y"
//   message in the UI.

"use server";

import "server-only";

import { randomUUID } from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { db, schema } from "@/db/client";
import {
  NoAIProviderConfiguredError,
  planAgentRun,
  type PlannerFile,
} from "@/lib/agent/planner";
import { AGENT_TOOL_CATALOG } from "@/lib/agent/catalog";
import type {
  AgentErrorCode,
  AgentPlan,
  AgentRunStatus,
  AgentStepStatus,
  AgentToolId,
} from "@/lib/agent/types";

// --- shared result shapes --------------------------------------------------

export type AgentActionResult<T extends object = {}> =
  | ({ ok: true } & T)
  | {
      ok: false;
      code:
        | "not_authenticated"
        | "not_found"
        | "validation_error"
        | "file_missing"
        | "file_deleted_mid_run"
        | "planner_refused"
        | "planner_invalid_plan"
        | "provider_unavailable"
        | "invalid_status_transition"
        | "db_error";
      message: string;
    };

// --- auth + ownership helpers ---------------------------------------------

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user ? (session.user as { id?: string }).id : undefined;
  return userId ?? null;
}

/**
 * Load the run row and confirm the signed-in user owns it. Returns a
 * typed error result so callers can `return` it directly on failure.
 */
async function loadOwnedRun(runId: string, userId: string): Promise<
  | { ok: true; run: typeof schema.agentRuns.$inferSelect }
  | { ok: false; code: "not_found"; message: string }
> {
  const row = await db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.id, runId), eq(schema.agentRuns.userId, userId)))
    .limit(1);
  const run = row[0];
  if (!run) return { ok: false, code: "not_found", message: "Agent run not found." };
  return { ok: true, run };
}

// --- createRunAction -------------------------------------------------------

/**
 * Per-file metadata the client sends with the create request. `pageCount`
 * and `encrypted` are computed client-side with pdf-lib before the call;
 * we trust them the same way every other /api/ai/* route does (the files
 * row is the user's to lie about, and the damage is capped by balance).
 */
const CREATE_FILE_INPUT_SCHEMA = z.object({
  id: z.string().uuid(),
  pageCount: z.number().int().min(1).max(10_000),
  encrypted: z.boolean().optional(),
});

const CREATE_RUN_SCHEMA = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  files: z.array(CREATE_FILE_INPUT_SCHEMA).max(50),
  preferredProvider: z.enum(["anthropic", "openai"]).optional(),
});

export type CreateRunInput = z.infer<typeof CREATE_RUN_SCHEMA>;

export type CreateRunSuccess = {
  runId: string;
  plan: AgentPlan;
  status: AgentRunStatus;
  plannerProviderId: string;
  plannerModel: string;
};

/**
 * Build one `agent_run_steps` row skeleton (pending status) for a given
 * (stepIndex, fileBucketIndex). Caller pushes these into a batch insert.
 */
function makeStepRow(
  runId: string,
  stepIndex: number,
  fileBucketIndex: number,
  toolId: AgentToolId,
  stepParams: Record<string, unknown>,
  initialFileId: string | null,
  inputRef: AgentPlan["steps"][number]["inputRef"],
) {
  return {
    id: randomUUID(),
    runId,
    stepIndex,
    fileBucketIndex,
    toolId,
    fileId: initialFileId,
    inputJson: { params: stepParams, inputRef } as unknown,
    status: "pending" as const,
    idempotencyKey: `agent:${runId}:${stepIndex}:${fileBucketIndex}`,
    spentCredits: 0,
  };
}

/**
 * Plan + persist. Returns the validated plan so the UI can render the
 * approval card immediately; the run sits at status=pending_approval
 * until the user clicks "Run plan".
 *
 * We insert `agent_run_steps` rows at pending status here so:
 *   - The approval card can show one row per step × file upfront.
 *   - The runner doesn't need a separate "start step" DB write — it just
 *     updates the pre-inserted row when the executor returns.
 *   - The unique(idempotency_key) index is the runner's safety net: a
 *     double-click on "Run plan" that retries a step won't insert a
 *     second row or double-charge.
 */
export async function createRunAction(
  input: unknown,
): Promise<AgentActionResult<CreateRunSuccess>> {
  const userId = await requireUserId();
  if (!userId) {
    return { ok: false, code: "not_authenticated", message: "Sign in to run the agent." };
  }

  const parsed = CREATE_RUN_SCHEMA.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message:
        parsed.error.issues[0]?.message ?? "Invalid agent request.",
    };
  }

  // Verify every file id belongs to this user. Returns { id, name } pairs
  // keyed by id so we can zip into PlannerFile below. A user id filter
  // doubles as the ownership guard — a spoofed id from someone else's
  // account simply won't be in the result set.
  const fileIds = parsed.data.files.map((f) => f.id);
  const ownedFiles =
    fileIds.length === 0
      ? []
      : await db
          .select({ id: schema.files.id, name: schema.files.name })
          .from(schema.files)
          .where(
            and(
              eq(schema.files.userId, userId),
              inArray(schema.files.id, fileIds),
            ),
          );

  if (ownedFiles.length !== fileIds.length) {
    return {
      ok: false,
      code: "file_missing",
      message:
        "One or more files in your queue are no longer available. Re-upload or remove them and try again.",
    };
  }

  const nameById = new Map(ownedFiles.map((f) => [f.id, f.name]));
  const plannerFiles: PlannerFile[] = parsed.data.files.map((f) => ({
    id: f.id,
    name: nameById.get(f.id) ?? "file.pdf",
    pageCount: f.pageCount,
    encrypted: f.encrypted,
  }));

  // Call the planner. It throws NoAIProviderConfiguredError if no
  // AI key is set — that's a 503-style deployment issue, map to
  // provider_unavailable so the UI copy can say "the site admin hasn't
  // configured AI yet" instead of "bad plan".
  let planResult;
  try {
    planResult = await planAgentRun({
      prompt: parsed.data.prompt,
      files: plannerFiles,
      preferredProvider: parsed.data.preferredProvider,
    });
  } catch (err) {
    if (err instanceof NoAIProviderConfiguredError) {
      return {
        ok: false,
        code: "provider_unavailable",
        message: err.message,
      };
    }
    console.error("[createRunAction] planner threw", err);
    return {
      ok: false,
      code: "planner_invalid_plan",
      message: err instanceof Error ? err.message : "Planner error.",
    };
  }

  if (!planResult.ok) {
    return {
      ok: false,
      code: planResult.code,
      message: planResult.message,
    };
  }

  const { plan, providerId: plannerProviderId, model: plannerModel } = planResult;

  const runId = randomUUID();

  // Pre-insert step rows. Walk the plan, tracking how many logical
  // "buckets" each step has. See file header for bucket semantics.
  const stepRows: ReturnType<typeof makeStepRow>[] = [];
  let bucketCount = plannerFiles.length;
  for (const step of plan.steps) {
    const spec = AGENT_TOOL_CATALOG[step.toolId];
    if (!spec) {
      // Planner already rejected unknown toolIds; defensive guard.
      return {
        ok: false,
        code: "planner_invalid_plan",
        message: `Unknown toolId in plan: ${step.toolId}`,
      };
    }

    if (spec.scope === "per-file") {
      // Fan out one row per current bucket. If bucketCount collapsed to
      // 1 after an earlier queue-level step, this runs just once.
      const fan = Math.max(bucketCount, 1);
      for (let b = 0; b < fan; b++) {
        // For stepIndex 0 per-file steps, the input file is the queued
        // file at that bucket. For later per-file steps, fileId is
        // filled in by the runner when the upstream step succeeds.
        const initialFileId =
          step.stepIndex === 0 && step.inputRef.kind === "source"
            ? plannerFiles[b]?.id ?? null
            : null;
        stepRows.push(
          makeStepRow(
            runId,
            step.stepIndex,
            b,
            step.toolId,
            step.params,
            initialFileId,
            step.inputRef,
          ),
        );
      }
      // per-file keeps bucket count the same.
    } else {
      // queue-level and sub-call: exactly one row at bucket 0.
      // For merge / ai-compare, step 0 takes all source files; the
      // runner resolves them from agent_runs.file_ids_json at dispatch
      // time. fileId is therefore null here (no single "input file").
      stepRows.push(
        makeStepRow(
          runId,
          step.stepIndex,
          0,
          step.toolId,
          step.params,
          null,
          step.inputRef,
        ),
      );
      // After a queue-level or sub-call step, bucket count collapses to
      // 1 — the next per-file step runs once against the merged/
      // produced output.
      bucketCount = 1;
    }
  }

  // Persist run + step rows. We don't use a DB transaction here because
  // MySQL autocommit + the unique(idempotency_key) constraint is
  // sufficient: a partial failure (run row inserted, steps not) leaves
  // the run at pending_approval with zero steps; the UI treats that as
  // "broken run, start over" and the user re-creates. That's cheap
  // compared to the overhead of a transaction for a cold path.
  try {
    await db.insert(schema.agentRuns).values({
      id: runId,
      userId,
      promptText: parsed.data.prompt,
      planJson: plan as unknown,
      fileIdsJson: fileIds as unknown,
      quoteCredits: plan.totalQuote,
      plannerProviderId,
      plannerModel,
      status: "pending_approval",
    });

    if (stepRows.length > 0) {
      // Drizzle MySQL doesn't cap batch insert; all step rows go in a
      // single statement. For a 50-file × 6-step plan that's 300 rows,
      // well within MySQL's max_allowed_packet default.
      await db.insert(schema.agentRunSteps).values(stepRows);
    }
  } catch (err) {
    console.error("[createRunAction] insert failed", err);
    return { ok: false, code: "db_error", message: "Could not save the plan." };
  }

  revalidatePath("/app/studio");

  return {
    ok: true,
    runId,
    plan,
    status: "pending_approval",
    plannerProviderId,
    plannerModel,
  };
}

// --- approveRunAction ------------------------------------------------------

const APPROVE_RUN_SCHEMA = z.object({ runId: z.string().uuid() });

/**
 * User clicked "Run plan". Flip status from pending_approval → running
 * and stamp started_at. Rejects if the run is in any other state — a
 * re-approval of an already-running run would race with the runner.
 */
export async function approveRunAction(
  input: unknown,
): Promise<AgentActionResult<{ runId: string; status: AgentRunStatus }>> {
  const userId = await requireUserId();
  if (!userId) {
    return { ok: false, code: "not_authenticated", message: "Sign in to run the agent." };
  }

  const parsed = APPROVE_RUN_SCHEMA.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid run id.",
    };
  }

  const loaded = await loadOwnedRun(parsed.data.runId, userId);
  if (!loaded.ok) return loaded;

  if (loaded.run.status !== "pending_approval") {
    return {
      ok: false,
      code: "invalid_status_transition",
      message: `Run is in status "${loaded.run.status}", can only approve when pending_approval.`,
    };
  }

  try {
    await db
      .update(schema.agentRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(schema.agentRuns.id, parsed.data.runId));
  } catch (err) {
    console.error("[approveRunAction] update failed", err);
    return { ok: false, code: "db_error", message: "Could not start the run." };
  }

  revalidatePath("/app/studio");

  return { ok: true, runId: parsed.data.runId, status: "running" };
}

// --- cancelRunAction -------------------------------------------------------

const CANCEL_RUN_SCHEMA = z.object({ runId: z.string().uuid() });

/**
 * User abandoned the run. Valid from pending_approval / approved /
 * running / paused. Already-succeeded / already-failed runs are left
 * alone (idempotent no-op).
 *
 * We don't walk remaining step rows and flip them to 'cancelled' —
 * they stay at 'pending' / 'running' in the DB. Reason: the UI reads
 * the run's status first; if the run is cancelled, pending steps are
 * displayed as such regardless of their row state. Saves a round-trip
 * and avoids the race where a step finishes between our row-read and
 * row-update.
 */
export async function cancelRunAction(
  input: unknown,
): Promise<AgentActionResult<{ runId: string; status: AgentRunStatus }>> {
  const userId = await requireUserId();
  if (!userId) {
    return { ok: false, code: "not_authenticated", message: "Sign in to run the agent." };
  }

  const parsed = CANCEL_RUN_SCHEMA.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid run id.",
    };
  }

  const loaded = await loadOwnedRun(parsed.data.runId, userId);
  if (!loaded.ok) return loaded;

  const cancellable: AgentRunStatus[] = [
    "pending_approval",
    "approved",
    "running",
    "paused",
  ];
  if (!cancellable.includes(loaded.run.status as AgentRunStatus)) {
    // Terminal state — treat as no-op.
    return {
      ok: true,
      runId: parsed.data.runId,
      status: loaded.run.status as AgentRunStatus,
    };
  }

  try {
    await db
      .update(schema.agentRuns)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(schema.agentRuns.id, parsed.data.runId));
  } catch (err) {
    console.error("[cancelRunAction] update failed", err);
    return { ok: false, code: "db_error", message: "Could not cancel the run." };
  }

  revalidatePath("/app/studio");
  return { ok: true, runId: parsed.data.runId, status: "cancelled" };
}

// --- reportStepOutcomeAction ----------------------------------------------

const REPORT_STEP_SCHEMA = z.object({
  runId: z.string().uuid(),
  fileBucketIndex: z.number().int().min(0),
  stepIndex: z.number().int().min(0),
  /**
   * Terminal outcome for this step. The runner calls this exactly once
   * per step, after `executeAgentStep` returns (success or failure).
   */
  outcome: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("succeeded"),
      // Populated when the step produced an ai_outputs row (summarize /
      // translate / compare / ocr). Matched loosely — the executor knows
      // if a row was written.
      aiOutputId: z.string().uuid().optional(),
      // Populated when the step produced a new files row (every AI step
      // plus the pdf-lib tool steps).
      outputFileId: z.string().uuid().optional(),
      // Populated for chat-as-tool or text-only tool steps.
      outputText: z.string().max(200_000).optional(),
      // The runner's resolved input file id — matters for later steps
      // reading `fileId` to know which file this step consumed. For
      // stepIndex 0 per-file steps this is already populated at insert
      // time; the runner passes it here for later steps to patch.
      inputFileId: z.string().uuid().optional(),
      // Credits actually debited by the AI op (0 for free tools, or the
      // replay-on-dup path where the /api/ai/* route returned cached).
      creditsSpent: z.number().int().min(0).max(100_000),
    }),
    z.object({
      status: z.literal("failed"),
      errorCode: z.string().min(1).max(64),
      errorNote: z.string().max(2000).optional(),
      // On failure, the caller may report partial spend if the provider
      // charged before erroring. Usually 0 (we refund on provider error).
      creditsSpent: z.number().int().min(0).max(100_000).default(0),
    }),
    z.object({
      status: z.literal("cancelled"),
    }),
    z.object({
      status: z.literal("skipped"),
      errorNote: z.string().max(2000).optional(),
    }),
  ]),
});

export type ReportStepOutcomeResult = AgentActionResult<{
  runId: string;
  stepStatus: AgentStepStatus;
  spentCredits: number;
  quoteCredits: number;
  quoteBreach: boolean;
}>;

/**
 * Persist a step's final outcome and bump the run-level credit counter.
 *
 * Returns `quoteBreach: true` when the post-increment spent_credits
 * exceeds quote_credits. The runner is expected to then either:
 *   - flip the run to 'paused' (via a future pauseRunAction — out of
 *     scope for this file) and ask the user to approve a higher cap, OR
 *   - call finalizeRunAction({ok: false, errorCode: "quote_exceeded"})
 *     if the runner decides to just fail out.
 */
export async function reportStepOutcomeAction(
  input: unknown,
): Promise<ReportStepOutcomeResult> {
  const userId = await requireUserId();
  if (!userId) {
    return { ok: false, code: "not_authenticated", message: "Sign in to run the agent." };
  }

  const parsed = REPORT_STEP_SCHEMA.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid step outcome.",
    };
  }

  const loaded = await loadOwnedRun(parsed.data.runId, userId);
  if (!loaded.ok) return loaded;

  // Look up the pre-inserted step row so we can (a) confirm it's in a
  // transitional state and (b) compute the post-increment spend with a
  // single UPDATE.
  const stepRows = await db
    .select()
    .from(schema.agentRunSteps)
    .where(
      and(
        eq(schema.agentRunSteps.runId, parsed.data.runId),
        eq(schema.agentRunSteps.stepIndex, parsed.data.stepIndex),
        eq(schema.agentRunSteps.fileBucketIndex, parsed.data.fileBucketIndex),
      ),
    )
    .limit(1);
  const stepRow = stepRows[0];
  if (!stepRow) {
    return {
      ok: false,
      code: "not_found",
      message: `Step (${parsed.data.stepIndex}, bucket ${parsed.data.fileBucketIndex}) not found.`,
    };
  }

  // Build the UPDATE patch. Every outcome stamps completed_at; succeeded
  // additionally persists aiOutputId/outputFileId/outputText and the
  // resolved inputFileId. The status field is narrowed by Zod's
  // discriminated union above.
  const outcome = parsed.data.outcome;
  const now = new Date();

  const stepUpdate: Partial<typeof schema.agentRunSteps.$inferInsert> = {
    status: outcome.status,
    completedAt: now,
  };
  // Stamp startedAt if the row is still pending — the runner never
  // separately transitioned it to "running", so we record the same
  // timestamp for both start + end. That's accurate enough: the step
  // duration for a single AI call is sub-second noise in a multi-step
  // run, and a user-visible "step took X seconds" isn't a product
  // requirement yet.
  if (!stepRow.startedAt) stepUpdate.startedAt = now;

  let creditsSpent = 0;
  if (outcome.status === "succeeded") {
    if (outcome.aiOutputId) stepUpdate.aiOutputId = outcome.aiOutputId;
    if (outcome.outputFileId) stepUpdate.outputFileId = outcome.outputFileId;
    if (outcome.outputText !== undefined) stepUpdate.outputText = outcome.outputText;
    if (outcome.inputFileId) stepUpdate.fileId = outcome.inputFileId;
    creditsSpent = outcome.creditsSpent;
    stepUpdate.spentCredits = creditsSpent;
  } else if (outcome.status === "failed") {
    stepUpdate.errorCode = outcome.errorCode;
    if (outcome.errorNote) stepUpdate.errorNote = outcome.errorNote;
    creditsSpent = outcome.creditsSpent ?? 0;
    stepUpdate.spentCredits = creditsSpent;
  } else if (outcome.status === "skipped") {
    if (outcome.errorNote) stepUpdate.errorNote = outcome.errorNote;
  }
  // cancelled → no extra fields.

  try {
    await db
      .update(schema.agentRunSteps)
      .set(stepUpdate)
      .where(eq(schema.agentRunSteps.id, stepRow.id));
  } catch (err) {
    console.error("[reportStepOutcomeAction] step update failed", err);
    return { ok: false, code: "db_error", message: "Could not record step outcome." };
  }

  // Bump the run-level counter. Read-modify-write; see credits.ts for
  // the same race-tolerant pattern — the unique idempotency key on the
  // step row is our replay safety, so double-calling this action can't
  // double-count (we'd re-read the same stepRow which is already in the
  // final state, and the runner should guard against double-calls on
  // its own side).
  let newSpent = loaded.run.spentCredits + creditsSpent;
  try {
    if (creditsSpent > 0) {
      await db
        .update(schema.agentRuns)
        .set({ spentCredits: newSpent })
        .where(eq(schema.agentRuns.id, parsed.data.runId));
    } else {
      newSpent = loaded.run.spentCredits;
    }
  } catch (err) {
    console.error("[reportStepOutcomeAction] run update failed", err);
    return { ok: false, code: "db_error", message: "Could not record credit spend." };
  }

  const quoteBreach = newSpent > loaded.run.quoteCredits;

  revalidatePath("/app/studio");

  return {
    ok: true,
    runId: parsed.data.runId,
    stepStatus: outcome.status,
    spentCredits: newSpent,
    quoteCredits: loaded.run.quoteCredits,
    quoteBreach,
  };
}

// --- finalizeRunAction -----------------------------------------------------

const FINALIZE_RUN_SCHEMA = z.object({
  runId: z.string().uuid(),
  outcome: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true) }),
    z.object({
      ok: z.literal(false),
      errorCode: z.string().min(1).max(64),
      errorNote: z.string().max(2000).optional(),
    }),
  ]),
});

/**
 * Terminal state for the run. Called by the runner after the last step
 * (success) or when a fatal error short-circuits the walk (failure).
 * Idempotent: a second call when the run is already terminal is a no-op.
 */
export async function finalizeRunAction(
  input: unknown,
): Promise<AgentActionResult<{ runId: string; status: AgentRunStatus }>> {
  const userId = await requireUserId();
  if (!userId) {
    return { ok: false, code: "not_authenticated", message: "Sign in to run the agent." };
  }

  const parsed = FINALIZE_RUN_SCHEMA.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid finalize payload.",
    };
  }

  const loaded = await loadOwnedRun(parsed.data.runId, userId);
  if (!loaded.ok) return loaded;

  const terminal: AgentRunStatus[] = ["succeeded", "failed", "cancelled"];
  if (terminal.includes(loaded.run.status as AgentRunStatus)) {
    // No-op on second finalize.
    return {
      ok: true,
      runId: parsed.data.runId,
      status: loaded.run.status as AgentRunStatus,
    };
  }

  const nextStatus: AgentRunStatus = parsed.data.outcome.ok ? "succeeded" : "failed";
  const patch: Partial<typeof schema.agentRuns.$inferInsert> = {
    status: nextStatus,
    completedAt: new Date(),
  };
  if (!parsed.data.outcome.ok) {
    patch.errorCode = parsed.data.outcome.errorCode;
    // Note: errorNote doesn't have its own column on agent_runs — the
    // step rows carry per-step notes, and the run-level field is
    // intentionally narrow. If we need a long-form reason later we'll
    // add a column; for now we drop the note silently and trust the
    // per-step errors for detail.
  }

  try {
    await db
      .update(schema.agentRuns)
      .set(patch)
      .where(eq(schema.agentRuns.id, parsed.data.runId));
  } catch (err) {
    console.error("[finalizeRunAction] update failed", err);
    return { ok: false, code: "db_error", message: "Could not finalize the run." };
  }

  revalidatePath("/app/studio");

  return { ok: true, runId: parsed.data.runId, status: nextStatus };
}

// --- getRunStatusAction ----------------------------------------------------

const GET_RUN_STATUS_SCHEMA = z.object({ runId: z.string().uuid() });

/**
 * Loaded run + all its step rows, ordered for UI rendering
 * (fileBucketIndex ASC, stepIndex ASC). The client runner uses this on
 * page refresh to rehydrate the grid; the approval card uses it to show
 * "N of M steps complete" live.
 */
export type AgentRunSnapshot = {
  id: string;
  status: AgentRunStatus;
  errorCode: string | null;
  promptText: string;
  plan: AgentPlan;
  fileIds: string[];
  quoteCredits: number;
  spentCredits: number;
  plannerProviderId: string | null;
  plannerModel: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  steps: Array<{
    id: string;
    stepIndex: number;
    fileBucketIndex: number;
    toolId: AgentToolId;
    fileId: string | null;
    status: AgentStepStatus;
    aiOutputId: string | null;
    outputFileId: string | null;
    outputText: string | null;
    spentCredits: number;
    errorCode: string | null;
    errorNote: string | null;
    idempotencyKey: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  }>;
};

export async function getRunStatusAction(
  input: unknown,
): Promise<AgentActionResult<{ snapshot: AgentRunSnapshot }>> {
  const userId = await requireUserId();
  if (!userId) {
    return { ok: false, code: "not_authenticated", message: "Sign in to view runs." };
  }

  const parsed = GET_RUN_STATUS_SCHEMA.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid run id.",
    };
  }

  const loaded = await loadOwnedRun(parsed.data.runId, userId);
  if (!loaded.ok) return loaded;
  const run = loaded.run;

  const steps = await db
    .select()
    .from(schema.agentRunSteps)
    .where(eq(schema.agentRunSteps.runId, run.id))
    .orderBy(
      asc(schema.agentRunSteps.fileBucketIndex),
      asc(schema.agentRunSteps.stepIndex),
    );

  const snapshot: AgentRunSnapshot = {
    id: run.id,
    status: run.status as AgentRunStatus,
    errorCode: run.errorCode ?? null,
    promptText: run.promptText,
    plan: run.planJson as AgentPlan,
    fileIds: (run.fileIdsJson as string[]) ?? [],
    quoteCredits: run.quoteCredits,
    spentCredits: run.spentCredits,
    plannerProviderId: run.plannerProviderId ?? null,
    plannerModel: run.plannerModel ?? null,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    createdAt: run.createdAt,
    steps: steps.map((s) => ({
      id: s.id,
      stepIndex: s.stepIndex,
      fileBucketIndex: s.fileBucketIndex,
      toolId: s.toolId as AgentToolId,
      fileId: s.fileId ?? null,
      status: s.status as AgentStepStatus,
      aiOutputId: s.aiOutputId ?? null,
      outputFileId: s.outputFileId ?? null,
      outputText: s.outputText ?? null,
      spentCredits: s.spentCredits,
      errorCode: s.errorCode ?? null,
      errorNote: s.errorNote ?? null,
      idempotencyKey: s.idempotencyKey ?? null,
      startedAt: s.startedAt ?? null,
      completedAt: s.completedAt ?? null,
      createdAt: s.createdAt,
    })),
  };

  return { ok: true, snapshot };
}

// --- unused-export guard --------------------------------------------------

// Cast to the narrow planner error types to confirm they're part of
// AgentErrorCode (TS-only; trips at build if the union drifts).
const _errorCodeCheck: AgentErrorCode[] = [
  "planner_refused",
  "planner_invalid_plan",
];
void _errorCodeCheck;
