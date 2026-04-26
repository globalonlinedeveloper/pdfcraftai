// /api/agent/runs/[id]/approve — resume a run paused on an awaiting_approval step.
//
// REQUEST  (POST, application/json)
//   {
//     stepIdx: number,           // step that's currently awaiting approval
//     decision: "approve" | "deny",
//     // when decision === "approve", optionally the option the user
//     // picked from sys.ask.user (e.g. "Yes — send")
//     selectedOption?: string,
//   }
//
// RESPONSE
//   200 { runId, status }   — run resumed (executor restarted from next step)
//   404 ............ run not found / not yours
//   409 ............ step is not in awaiting_approval state
//   401 ............ not signed in
//
// Resume semantics:
//   - on "approve" we mark the awaiting step as succeeded with the user's
//     selectedOption persisted in outputRef, then re-invoke the executor.
//     The executor's loop walks ALL steps from idx=1 again but skips
//     ones already in a terminal state (succeeded/failed/skipped) — so
//     it picks up cleanly at the next pending step.
//   - on "deny" we mark the run as cancelled.

import "server-only";

import { auth } from "@/auth";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { executePlan } from "@/lib/agent/executor";
import { getRunForUser, setRunStatus, setStepStatus } from "@/lib/agent/run-store";
import type { AgentPlan } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApproveBody {
  stepIdx?: unknown;
  decision?: unknown;
  selectedOption?: unknown;
}

export async function POST(
  req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json(
      { error: { code: "auth_required", message: "Sign in to approve agent runs." } },
      { status: 401 },
    );
  }

  const userId = session.user.id;
  const runId = ctx.params.id;

  // Body
  let body: ApproveBody;
  try {
    body = (await req.json()) as ApproveBody;
  } catch {
    return Response.json(
      { error: { code: "bad_json", message: "Body must be valid JSON." } },
      { status: 400 },
    );
  }
  const stepIdx = typeof body.stepIdx === "number" ? body.stepIdx : null;
  const decision =
    body.decision === "approve" || body.decision === "deny"
      ? body.decision
      : null;
  const selectedOption =
    typeof body.selectedOption === "string" ? body.selectedOption : null;

  if (stepIdx === null || decision === null) {
    return Response.json(
      {
        error: {
          code: "bad_request",
          message: "Body must include {stepIdx: number, decision: 'approve' | 'deny'}.",
        },
      },
      { status: 400 },
    );
  }

  // Fetch run + verify ownership
  const run = await getRunForUser({ runId, userId });
  if (!run) {
    return Response.json(
      { error: { code: "not_found", message: "Run not found or not yours." } },
      { status: 404 },
    );
  }
  // Verify the step is actually awaiting approval — otherwise this is a
  // racing approval (e.g. UI fired after another tab already approved).
  const step = run.steps.find((s) => s.idx === stepIdx);
  if (!step || step.status !== "awaiting_approval") {
    return Response.json(
      {
        error: {
          code: "step_not_awaiting_approval",
          message: `Step ${stepIdx} is in status '${step?.status ?? "missing"}', not awaiting_approval.`,
        },
      },
      { status: 409 },
    );
  }

  if (decision === "deny") {
    // User rejected. Mark the step as failed (not "skipped" — the user
    // explicitly chose not to proceed) and cancel the run.
    await setStepStatus({
      runId,
      idx: stepIdx,
      status: "failed",
      errorMessage: "User denied approval.",
    });
    // Mark all later pending steps as skipped.
    for (const s of run.steps.filter((s) => s.idx > stepIdx && s.status === "pending")) {
      await setStepStatus({ runId, idx: s.idx, status: "skipped" });
    }
    await setRunStatus({ runId, status: "cancelled", errorMessage: "Cancelled by user." });
    return Response.json({ runId, status: "cancelled" }, { status: 200 });
  }

  // decision === "approve"
  // Mark the awaiting step as succeeded with the user's selectedOption
  // persisted so downstream steps (or audit) can see what was chosen.
  await db
    .update(schema.agentRunSteps)
    .set({
      status: "succeeded",
      outputRef: JSON.stringify({
        approved: true,
        selectedOption: selectedOption ?? "approve",
        approvedAt: new Date().toISOString(),
      }),
      outputType: "json/approval-response",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(schema.agentRunSteps.runId, runId),
        eq(schema.agentRunSteps.idx, stepIdx),
      ),
    );

  // Re-invoke the executor. It walks all steps from idx=1 and skips
  // those already in terminal state, so it picks up at the next pending.
  const plan = run.planJson as AgentPlan;
  try {
    const result = await executePlan({ runId, userId, plan });
    return Response.json(
      {
        runId,
        status: result.status,
        totalCostMicros: result.totalCostMicros,
        stepsExecuted: result.stepsExecuted,
      },
      { status: 200 },
    );
  } catch (e) {
    console.error(`[/api/agent/runs/${runId}/approve] executor crashed:`, e);
    await setRunStatus({
      runId,
      status: "failed",
      errorMessage: (e as Error).message ?? "Executor crashed during approval resume.",
    });
    return Response.json(
      { runId, status: "failed", error: { code: "executor_crash" } },
      { status: 500 },
    );
  }
}
