// AgentSmartMode — Phase 6.3 Smart mode for /app/studio.
//
// The other half of the Studio page: a natural-language prompt + a file
// queue + an approval card + a live per-step status grid. Wires together:
//
//   createRunAction    (plan the run)        — lib/agent-actions
//   approveRunAction   (flip pending→running) — lib/agent-actions
//   runAgentPlan       (walk the plan)       — lib/agent/runner
//   cancelRunAction    (user bail)           — lib/agent-actions
//   registerFileAction (create files rows)   — lib/files-actions
//
// UI flow:
//   1. User drops PDFs → we peek pageCount + encrypted flag in pdf-lib,
//      compute sha256, and call `registerFileAction` to create a files
//      row. The returned `id` is the UUID we hand to `createRunAction`.
//      Upload is metadata-only (same policy as /app/files).
//   2. User types a prompt, optionally picks a preferred provider, hits
//      "Plan it". We call `createRunAction` and render the returned plan
//      in an approval card — summary line, per-step list, quote.
//   3. User reviews the plan and hits "Approve & run". We flip status to
//      running via `approveRunAction`, build the live grid (one row per
//      bucket × one column per step), and call `runAgentPlan` with an
//      `onProgress` handler that maps RunnerProgressEvent → cell state.
//   4. Terminal banners: succeeded / failed / paused (quote_exceeded or
//      insufficient_credits) / cancelled. "Start over" resets the phase
//      back to idle so the user can re-run with a different prompt or
//      different files.
//
// Design notes:
//   - This is its own client component (not fused with StudioRunner) so
//     the Batch vs Smart tabs can mount/unmount independently. It also
//     keeps StudioRunner's tested per-tool path untouched.
//   - File bytes never leave the browser. `registerFileAction` stores
//     name/size/sha256 only; the actual PDF is passed straight to the
//     /api/ai/* route as multipart form data by the runner.
//   - No resume-on-refresh in v1. Closing the tab mid-run orphans the
//     agent_runs row; the server's `getRunStatusAction` can still show
//     progress via pollling if we want to add it later, but for now the
//     UI is strictly in-memory from plan → finish.

"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PDFDocument } from "pdf-lib";

import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "@/components/tools/ToolDropzone";
import { humanSize, sha256HexOfFile } from "@/lib/client/pdf-utils";

import {
  createRunAction,
  approveRunAction,
  cancelRunAction,
} from "@/lib/agent-actions";
import { registerFileAction } from "@/lib/files-actions";
import { runAgentPlan, type RunnerProgressEvent } from "@/lib/agent/runner";
import { AGENT_TOOL_CATALOG } from "@/lib/agent/catalog";
import type {
  AgentPlan,
  AgentPlanStep,
  AgentStepStatus,
  AgentToolId,
} from "@/lib/agent/types";

// --- Constants --------------------------------------------------------

const MAX_FILES_PER_RUN = 25;
const MAX_PROMPT_LEN = 4000;

// --- Types ------------------------------------------------------------

type QueueItemStatus = "uploading" | "ready" | "failed";

type QueueItem = {
  /** Client-side id for list keys + removal. */
  localId: string;
  file: File;
  /** files.id once `registerFileAction` succeeds. */
  fileId?: string;
  pageCount?: number;
  encrypted?: boolean;
  status: QueueItemStatus;
  error?: string;
};

type Phase =
  | { kind: "idle" }
  | { kind: "planning" }
  | { kind: "review"; runId: string; plan: AgentPlan }
  | { kind: "running"; runId: string; plan: AgentPlan }
  | {
      kind: "terminal";
      runId: string;
      plan: AgentPlan;
      outcome:
        | { status: "succeeded"; spentCredits: number }
        | { status: "failed"; spentCredits: number; code: string; message: string }
        | {
            status: "paused";
            spentCredits: number;
            reason: "quote_exceeded" | "insufficient_credits";
            quoteCredits: number;
            message: string;
          }
        | { status: "cancelled"; spentCredits: number };
    };

type CellState = {
  status: AgentStepStatus | "running";
  creditsSpent?: number;
  errorMessage?: string;
  /** files.id of the produced output, if any — for a "View" link. */
  outputFileId?: string;
};

/**
 * Keyed by `${bucket}:${stepIndex}`. Cleared when the user starts a new
 * run so the old grid doesn't bleed through.
 */
type StepStateMap = Record<string, CellState>;

// --- Helpers ----------------------------------------------------------

function newLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cellKey(bucket: number, step: number): string {
  return `${bucket}:${step}`;
}

/**
 * Peek pageCount + encryption flag via pdf-lib. Both are best-effort —
 * a missing pageCount falls back to the worst-case cap in the planner's
 * OCR cost estimator; a missing `encrypted` flag defaults to false.
 */
async function peekPdfMetadata(
  file: File,
): Promise<{ pageCount?: number; encrypted?: boolean }> {
  try {
    const bytes = await file.arrayBuffer();
    // Two loads: one ignoring encryption (always succeeds on valid PDFs)
    // gives us the page count; the second WITHOUT ignoreEncryption tells
    // us if the file is actually encrypted (throws on encrypted PDFs).
    const docLenient = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageCount = docLenient.getPageCount();
    let encrypted = false;
    try {
      await PDFDocument.load(bytes);
    } catch {
      encrypted = true;
    }
    return {
      pageCount: pageCount > 0 ? pageCount : undefined,
      encrypted,
    };
  } catch {
    return {};
  }
}

/**
 * Human copy for the various terminal error codes + pause reasons. Kept
 * centralized so the banner + the per-cell message agree.
 */
function mapTerminalCopy(
  outcome: Extract<Phase, { kind: "terminal" }>["outcome"],
): { tone: "success" | "danger" | "warning" | "neutral"; title: string; body: string } {
  switch (outcome.status) {
    case "succeeded":
      return {
        tone: "success",
        title: "Run complete",
        body: `Spent ${outcome.spentCredits} credit${outcome.spentCredits === 1 ? "" : "s"}.`,
      };
    case "failed":
      return {
        tone: "danger",
        title: "Run failed",
        body:
          outcome.code === "provider_error"
            ? "An AI provider errored during the run. Credits for failed steps were refunded."
            : outcome.code === "validation_error"
              ? `Plan validation failed: ${outcome.message}`
              : `${outcome.code}: ${outcome.message}`,
      };
    case "paused":
      return {
        tone: "warning",
        title:
          outcome.reason === "quote_exceeded"
            ? "Run halted — quote exceeded"
            : "Run halted — insufficient credits",
        body:
          outcome.reason === "quote_exceeded"
            ? `Spent ${outcome.spentCredits} credits, cap was ${outcome.quoteCredits}. Start a new run to continue.`
            : outcome.message,
      };
    case "cancelled":
      return {
        tone: "neutral",
        title: "Run cancelled",
        body: `Spent ${outcome.spentCredits} credit${outcome.spentCredits === 1 ? "" : "s"} before you cancelled.`,
      };
  }
}

// --- Component --------------------------------------------------------

export function AgentSmartMode() {
  // --- Queue -----------------------------------------------------------

  const [queue, setQueue] = useState<QueueItem[]>([]);

  // --- Prompt + provider -----------------------------------------------

  const [prompt, setPrompt] = useState<string>("");
  const [providerChoice, setProviderChoice] = useState<
    "auto" | "anthropic" | "openai"
  >("auto");

  // --- Phase / plan / error --------------------------------------------

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [pageError, setPageError] = useState<string | null>(null);

  // Per-cell live state. Reset at the start of every run.
  const [stepStates, setStepStates] = useState<StepStateMap>({});
  const [spentCredits, setSpentCredits] = useState<number>(0);

  // AbortController for the in-flight run. Ref so we can fire it from
  // the cancel button even if state has since moved on.
  const abortRef = useRef<AbortController | null>(null);

  // --- File intake -----------------------------------------------------

  /**
   * Add a batch of files to the queue. For each one:
   *   1. Insert a placeholder row at status=uploading.
   *   2. Peek pdf-lib metadata (page count + encryption).
   *   3. Hash + call `registerFileAction` to get a files.id.
   *   4. Flip the row to status=ready with the server-side fileId.
   *
   * Failures at any step set status=failed with a short error message.
   */
  const addFiles = useCallback(
    async (incoming: File[]) => {
      setPageError(null);

      setQueue((prev) => {
        if (prev.length + incoming.length > MAX_FILES_PER_RUN) {
          const remaining = MAX_FILES_PER_RUN - prev.length;
          setPageError(
            `Smart mode is capped at ${MAX_FILES_PER_RUN} files per run. ` +
              (remaining > 0
                ? `Add up to ${remaining} more.`
                : "Remove some first."),
          );
          return prev;
        }
        return prev;
      });
      if (queue.length + incoming.length > MAX_FILES_PER_RUN) return;

      const stubs: QueueItem[] = incoming.map((file) => ({
        localId: newLocalId(),
        file,
        status: "uploading",
      }));
      setQueue((prev) => [...prev, ...stubs]);

      // Process each file independently so a slow one doesn't block the
      // others. We still update state one file at a time via functional
      // setState to avoid stomping concurrent updates.
      for (const stub of stubs) {
        try {
          const meta = await peekPdfMetadata(stub.file);
          if (meta.encrypted) {
            setQueue((prev) =>
              prev.map((q) =>
                q.localId === stub.localId
                  ? {
                      ...q,
                      status: "failed",
                      error:
                        "Encrypted PDF — Smart mode cannot process it. Remove the password and re-upload.",
                    }
                  : q,
              ),
            );
            continue;
          }

          const hash = await sha256HexOfFile(stub.file);
          const fd = new FormData();
          fd.set("name", stub.file.name);
          fd.set("mime", stub.file.type || "application/pdf");
          fd.set("sizeBytes", String(stub.file.size));
          fd.set("sha256", hash);
          const reg = await registerFileAction(undefined, fd);
          if (!reg.ok || !reg.id) {
            setQueue((prev) =>
              prev.map((q) =>
                q.localId === stub.localId
                  ? {
                      ...q,
                      status: "failed",
                      error: reg.error ?? "Could not register file.",
                    }
                  : q,
              ),
            );
            continue;
          }

          setQueue((prev) =>
            prev.map((q) =>
              q.localId === stub.localId
                ? {
                    ...q,
                    fileId: reg.id,
                    pageCount: meta.pageCount,
                    encrypted: false,
                    status: "ready",
                  }
                : q,
            ),
          );
        } catch (err) {
          console.error("[AgentSmartMode.addFiles] file failed", err);
          setQueue((prev) =>
            prev.map((q) =>
              q.localId === stub.localId
                ? {
                    ...q,
                    status: "failed",
                    error:
                      err instanceof Error
                        ? err.message
                        : "Upload failed.",
                  }
                : q,
            ),
          );
        }
      }
    },
    [queue.length],
  );

  const removeQueueItem = useCallback((localId: string) => {
    setQueue((prev) => prev.filter((q) => q.localId !== localId));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setPageError(null);
  }, []);

  // --- Plan submission -------------------------------------------------

  const readyFiles = useMemo(
    () => queue.filter((q): q is QueueItem & { fileId: string } =>
      q.status === "ready" && Boolean(q.fileId),
    ),
    [queue],
  );

  const canPlan =
    phase.kind === "idle" &&
    prompt.trim().length > 0 &&
    readyFiles.length > 0 &&
    queue.every((q) => q.status !== "uploading");

  const submitPlan = useCallback(async () => {
    if (!canPlan) return;
    setPageError(null);
    setPhase({ kind: "planning" });

    const preferredProvider =
      providerChoice === "auto" ? undefined : providerChoice;

    const res = await createRunAction({
      prompt: prompt.trim(),
      files: readyFiles.map((q) => ({
        id: q.fileId,
        pageCount: q.pageCount ?? 1,
        encrypted: false,
      })),
      preferredProvider,
    });

    if (!res.ok) {
      setPhase({ kind: "idle" });
      setPageError(
        res.code === "planner_refused"
          ? `The planner declined to build a plan: ${res.message}`
          : res.code === "planner_invalid_plan"
            ? "The planner returned an unworkable plan. Try rewording your request."
            : res.code === "provider_unavailable"
              ? "No AI provider is configured on this deployment."
              : res.code === "file_missing"
                ? "One or more files disappeared from your queue. Reset and try again."
                : res.message || "Could not plan the run.",
      );
      return;
    }

    // Reset per-run live state.
    setStepStates({});
    setSpentCredits(0);
    setPhase({ kind: "review", runId: res.runId, plan: res.plan });
  }, [canPlan, prompt, providerChoice, readyFiles]);

  // --- Approve + run ---------------------------------------------------

  const approveAndRun = useCallback(async () => {
    if (phase.kind !== "review") return;
    const runId = phase.runId;
    const plan = phase.plan;

    // Flip status server-side.
    const approve = await approveRunAction({ runId });
    if (!approve.ok) {
      setPageError(approve.message || "Could not start the run.");
      return;
    }

    setPhase({ kind: "running", runId, plan });

    const ac = new AbortController();
    abortRef.current = ac;

    const queueFiles = readyFiles.map((q) => q.file);
    const queueFileIds = readyFiles.map((q) => q.fileId);

    const onProgress = (ev: RunnerProgressEvent) => {
      if (ev.kind === "step-start") {
        setStepStates((prev) => ({
          ...prev,
          [cellKey(ev.fileBucketIndex, ev.stepIndex)]: { status: "running" },
        }));
      } else if (ev.kind === "step-succeeded") {
        const out = ev.output;
        const outputFileId =
          out.kind === "markdown"
            ? out.fileId
            : out.kind === "pdf"
              ? out.fileId
              : undefined;
        setStepStates((prev) => ({
          ...prev,
          [cellKey(ev.fileBucketIndex, ev.stepIndex)]: {
            status: "succeeded",
            creditsSpent: ev.creditsSpent,
            outputFileId,
          },
        }));
        setSpentCredits(ev.spentCreditsTotal);
      } else if (ev.kind === "step-failed") {
        setStepStates((prev) => ({
          ...prev,
          [cellKey(ev.fileBucketIndex, ev.stepIndex)]: {
            status: "failed",
            errorMessage: ev.message,
          },
        }));
      } else if (ev.kind === "step-skipped") {
        setStepStates((prev) => ({
          ...prev,
          [cellKey(ev.fileBucketIndex, ev.stepIndex)]: {
            status: "skipped",
            errorMessage: ev.reason,
          },
        }));
      }
      // `run-paused` / `run-completed` are handled via the returned
      // RunAgentPlanResult; we don't need to duplicate banner logic here.
    };

    let result;
    try {
      result = await runAgentPlan({
        runId,
        plan,
        queueFiles,
        queueFileIds,
        signal: ac.signal,
        onProgress,
      });
    } catch (err) {
      console.error("[AgentSmartMode] runAgentPlan threw", err);
      result = {
        ok: false as const,
        status: "failed" as const,
        code: "runner_crashed",
        message:
          err instanceof Error
            ? err.message
            : "The runner crashed unexpectedly.",
        spentCredits: 0,
      };
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }

    if (result.ok) {
      setPhase({
        kind: "terminal",
        runId,
        plan,
        outcome: {
          status: "succeeded",
          spentCredits: result.spentCredits,
        },
      });
      return;
    }

    if (result.status === "paused") {
      setPhase({
        kind: "terminal",
        runId,
        plan,
        outcome: {
          status: "paused",
          spentCredits: result.spentCredits,
          reason:
            result.code === "insufficient_credits"
              ? "insufficient_credits"
              : "quote_exceeded",
          quoteCredits: plan.totalQuote,
          message: result.message,
        },
      });
      return;
    }

    if (result.status === "cancelled") {
      setPhase({
        kind: "terminal",
        runId,
        plan,
        outcome: {
          status: "cancelled",
          spentCredits: result.spentCredits,
        },
      });
      return;
    }

    setPhase({
      kind: "terminal",
      runId,
      plan,
      outcome: {
        status: "failed",
        spentCredits: result.spentCredits,
        code: result.code,
        message: result.message,
      },
    });
  }, [phase, readyFiles]);

  // --- Cancel / discard ------------------------------------------------

  const cancelRun = useCallback(async () => {
    if (phase.kind !== "running" && phase.kind !== "review") return;
    const runId = phase.runId;

    // Signal the runner first so it stops before the DB flip races.
    abortRef.current?.abort();
    await cancelRunAction({ runId });

    // The runner's abort path will resolve to {status:"cancelled"} and
    // set the terminal phase. We only handle the review→cancel path
    // here (runner never started, so no onProgress will fire).
    if (phase.kind === "review") {
      setPhase({
        kind: "terminal",
        runId,
        plan: phase.plan,
        outcome: { status: "cancelled", spentCredits: 0 },
      });
    }
  }, [phase]);

  const startOver = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase({ kind: "idle" });
    setStepStates({});
    setSpentCredits(0);
    setPageError(null);
    // Keep the queue intact — the user may want to re-run with a
    // different prompt. They can Clear manually if they want a fresh
    // slate.
  }, []);

  // --- Derived ---------------------------------------------------------

  const bucketCount = useMemo(() => {
    if (phase.kind === "idle" || phase.kind === "planning") return 0;
    const plan = phase.plan;
    const firstScope =
      plan.steps.length > 0
        ? AGENT_TOOL_CATALOG[plan.steps[0]!.toolId]?.scope ?? "per-file"
        : "per-file";
    return firstScope === "per-file" ? plan.fileCount : 1;
  }, [phase]);

  const readyCount = readyFiles.length;
  const failedCount = queue.filter((q) => q.status === "failed").length;
  const uploadingCount = queue.filter((q) => q.status === "uploading").length;

  // --- Render ---------------------------------------------------------

  const disabledPlanning =
    phase.kind !== "idle" || uploadingCount > 0 || readyCount === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Queue ---------------------------------------------------------- */}
      <section>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, marginBottom: 8 }}>
          Files
        </h2>
        {queue.length < MAX_FILES_PER_RUN &&
          (phase.kind === "idle" || phase.kind === "terminal") && (
            // Dropzone is only mounted in idle/terminal phases, so it's
            // always enabled when visible — the planning/running/review
            // phases replace it with a locked queue + status grid below.
            <ToolDropzone
              onFiles={addFiles}
              multiple
              prompt={`Drop up to ${MAX_FILES_PER_RUN - queue.length} PDFs`}
              hint={`Smart mode plans across up to ${MAX_FILES_PER_RUN} files. Bytes stay on your device; only metadata is uploaded to register each file.`}
            />
          )}

        {queue.length > 0 && (
          <div
            className="card"
            style={{ padding: 0, overflow: "hidden", marginTop: 12 }}
          >
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {queue.length} file{queue.length === 1 ? "" : "s"}
              </span>
              <span className="subtle">
                {readyCount} ready
                {uploadingCount > 0 && <> · {uploadingCount} uploading</>}
                {failedCount > 0 && <> · {failedCount} failed</>}
              </span>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={clearQueue}
                disabled={
                  phase.kind === "planning" ||
                  phase.kind === "running" ||
                  phase.kind === "review"
                }
              >
                Clear
              </button>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {queue.map((q) => (
                <li
                  key={q.localId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderTop: "1px solid var(--border)",
                    fontSize: 13,
                  }}
                >
                  <QueueStatusDot status={q.status} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      title={q.file.name}
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {q.file.name}
                    </div>
                    <div className="subtle" style={{ fontSize: 11 }}>
                      {humanSize(q.file.size)}
                      {typeof q.pageCount === "number" && (
                        <> · {q.pageCount} pages</>
                      )}
                      {q.error && (
                        <span
                          style={{ color: "var(--danger)", marginLeft: 6 }}
                        >
                          · {q.error}
                        </span>
                      )}
                    </div>
                  </div>
                  {(phase.kind === "idle" ||
                    phase.kind === "terminal") && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      aria-label="Remove"
                      onClick={() => removeQueueItem(q.localId)}
                      style={{ color: "var(--fg-subtle)", padding: 6 }}
                    >
                      <I.X size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Prompt + submit ----------------------------------------------- */}
      {(phase.kind === "idle" || phase.kind === "planning") && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            <span style={{ display: "block", marginBottom: 6 }}>
              What do you want to do with these files?
            </span>
            <textarea
              className="input"
              placeholder="e.g. Summarize each PDF, then translate the summaries to Spanish."
              rows={3}
              maxLength={MAX_PROMPT_LEN}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={phase.kind === "planning"}
              style={{
                width: "100%",
                resize: "vertical",
                fontFamily: "inherit",
                fontSize: 14,
              }}
            />
            <span
              className="subtle mono"
              style={{ fontSize: 11, display: "block", marginTop: 4 }}
            >
              {prompt.length} / {MAX_PROMPT_LEN}
            </span>
          </label>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              <span style={{ display: "block", marginBottom: 6 }}>
                Planner model
              </span>
              <select
                className="input"
                value={providerChoice}
                onChange={(e) =>
                  setProviderChoice(
                    e.target.value as "auto" | "anthropic" | "openai",
                  )
                }
                disabled={phase.kind === "planning"}
                style={{ minWidth: 180 }}
              >
                <option value="auto">Auto</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
              </select>
            </label>

            <div style={{ flex: 1 }} />

            <button
              type="button"
              className="btn btn-primary"
              onClick={submitPlan}
              disabled={disabledPlanning || !canPlan}
            >
              {phase.kind === "planning" ? "Planning…" : "Plan it"}
            </button>
          </div>

          {pageError && (
            <div
              role="alert"
              style={{
                color: "var(--danger)",
                fontSize: 13,
                padding: "10px 14px",
                border: "1px solid var(--danger)",
                borderRadius: "var(--radius-sm)",
                background: "rgba(220, 38, 38, 0.06)",
              }}
            >
              {pageError}
            </div>
          )}
        </section>
      )}

      {/* Approval card ------------------------------------------------- */}
      {phase.kind === "review" && (
        <ApprovalCard
          plan={phase.plan}
          onApprove={approveAndRun}
          onDiscard={cancelRun}
        />
      )}

      {/* Live grid ----------------------------------------------------- */}
      {(phase.kind === "running" || phase.kind === "terminal") && (
        <StatusGrid
          plan={phase.plan}
          bucketCount={bucketCount}
          stepStates={stepStates}
          queueFilenames={readyFiles.map((q) => q.file.name)}
          spentCredits={spentCredits}
          isRunning={phase.kind === "running"}
          onCancel={cancelRun}
        />
      )}

      {/* Terminal banner ---------------------------------------------- */}
      {phase.kind === "terminal" && (
        <TerminalBanner outcome={phase.outcome} onStartOver={startOver} />
      )}
    </div>
  );
}

// --- Subcomponents ---------------------------------------------------

function QueueStatusDot({ status }: { status: QueueItemStatus }) {
  const map: Record<QueueItemStatus, { color: string; label: string }> = {
    uploading: { color: "var(--accent)", label: "Uploading" },
    ready: { color: "var(--success, #16a34a)", label: "Ready" },
    failed: { color: "var(--danger)", label: "Failed" },
  };
  const m = map[status];
  return (
    <span
      aria-label={m.label}
      title={m.label}
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: m.color,
        flexShrink: 0,
        boxShadow: status === "uploading" ? "0 0 0 3px var(--accent-soft)" : undefined,
      }}
    />
  );
}

function StepDot({ state }: { state: CellState | undefined }) {
  const kind = state?.status ?? "pending";
  const map: Record<
    AgentStepStatus | "running",
    { color: string; label: string; ring?: boolean }
  > = {
    pending: { color: "var(--fg-subtle)", label: "Pending" },
    running: { color: "var(--accent)", label: "Running", ring: true },
    succeeded: { color: "var(--success, #16a34a)", label: "Done" },
    failed: { color: "var(--danger)", label: "Failed" },
    cancelled: { color: "var(--fg-subtle)", label: "Cancelled" },
    skipped: { color: "var(--fg-subtle)", label: "Skipped" },
  };
  const m = map[kind];
  return (
    <span
      aria-label={m.label}
      title={m.label + (state?.errorMessage ? ` — ${state.errorMessage}` : "")}
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: m.color,
        flexShrink: 0,
        boxShadow: m.ring ? "0 0 0 3px var(--accent-soft)" : undefined,
      }}
    />
  );
}

/**
 * Summary of a step's params, kept short enough to fit in a grid column
 * header. Depth/target-lang/rotation are the common ones the user cares
 * about.
 */
function stepSummary(step: AgentPlanStep): string {
  const p = step.params as Record<string, unknown>;
  switch (step.toolId) {
    case "ai-summarize":
      return p.depth ? `${step.displayName} · ${String(p.depth)}` : step.displayName;
    case "ai-translate":
      return p.targetLang
        ? `${step.displayName} → ${String(p.targetLang)}`
        : step.displayName;
    case "rotate":
      return p.rotation
        ? `${step.displayName} · ${String(p.rotation)}°`
        : step.displayName;
    case "split":
      return p.ranges
        ? `${step.displayName} · ${String(p.ranges)}`
        : step.displayName;
    default:
      return step.displayName;
  }
}

function ApprovalCard({
  plan,
  onApprove,
  onDiscard,
}: {
  plan: AgentPlan;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        borderColor: "var(--accent)",
        background: "var(--accent-soft)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div className="eyebrow">PLAN</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{plan.summary}</div>
      </div>

      <ol
        style={{
          listStyle: "decimal",
          margin: 0,
          paddingLeft: 20,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 13,
        }}
      >
        {plan.steps.map((step) => {
          const spec = AGENT_TOOL_CATALOG[step.toolId];
          const scopeLabel =
            spec?.scope === "queue-level"
              ? "once"
              : spec?.scope === "sub-call"
                ? "once"
                : `× ${plan.fileCount} file${plan.fileCount === 1 ? "" : "s"}`;
          return (
            <li key={step.stepIndex}>
              <span style={{ fontWeight: 600 }}>{stepSummary(step)}</span>
              <span className="subtle mono" style={{ marginLeft: 8, fontSize: 11 }}>
                {scopeLabel} · up to {step.estimatedCostPerUnit} credit
                {step.estimatedCostPerUnit === 1 ? "" : "s"}/unit
              </span>
            </li>
          );
        })}
      </ol>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          paddingTop: 6,
          borderTop: "1px solid var(--border)",
        }}
      >
        <div style={{ fontSize: 13 }}>
          <span className="subtle">Maximum spend:</span>{" "}
          <span style={{ fontWeight: 600 }}>
            {plan.totalQuote} credit{plan.totalQuote === 1 ? "" : "s"}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" onClick={onDiscard}>
          Discard
        </button>
        <button type="button" className="btn btn-primary" onClick={onApprove}>
          Approve & run
        </button>
      </div>
    </div>
  );
}

function StatusGrid({
  plan,
  bucketCount,
  stepStates,
  queueFilenames,
  spentCredits,
  isRunning,
  onCancel,
}: {
  plan: AgentPlan;
  bucketCount: number;
  stepStates: StepStateMap;
  queueFilenames: string[];
  spentCredits: number;
  isRunning: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          fontSize: 13,
        }}
      >
        <div style={{ fontWeight: 600 }}>
          {isRunning ? "Running…" : "Run complete"}
        </div>
        <div className="subtle mono" style={{ fontSize: 12 }}>
          {spentCredits} / {plan.totalQuote} credits spent
        </div>
        <div style={{ flex: 1 }} />
        {isRunning && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-1)",
                  fontWeight: 600,
                  fontSize: 12,
                  position: "sticky",
                  left: 0,
                }}
              >
                {bucketCount > 1 ? "File" : "Run"}
              </th>
              {plan.steps.map((step) => (
                <th
                  key={step.stepIndex}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg-1)",
                    fontWeight: 600,
                    fontSize: 12,
                    minWidth: 140,
                  }}
                >
                  {stepSummary(step)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(1, bucketCount) }, (_, bucket) => (
              <tr key={bucket}>
                <td
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border)",
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    position: "sticky",
                    left: 0,
                    background: "var(--bg-0)",
                  }}
                  title={queueFilenames[bucket] ?? `Bucket ${bucket}`}
                >
                  {bucketCount > 1
                    ? queueFilenames[bucket] ?? `File ${bucket + 1}`
                    : "Queue"}
                </td>
                {plan.steps.map((step) => {
                  const spec = AGENT_TOOL_CATALOG[step.toolId];
                  // Queue-level / sub-call steps only have bucket 0.
                  const isActiveCell =
                    spec?.scope === "per-file" || bucket === 0;
                  const state = isActiveCell
                    ? stepStates[cellKey(bucket, step.stepIndex)]
                    : undefined;
                  return (
                    <td
                      key={step.stepIndex}
                      style={{
                        padding: "10px 14px",
                        borderBottom: "1px solid var(--border)",
                        verticalAlign: "top",
                      }}
                    >
                      {isActiveCell ? (
                        <CellView state={state} />
                      ) : (
                        <span className="subtle" style={{ fontSize: 11 }}>
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellView({ state }: { state: CellState | undefined }) {
  const status = state?.status ?? "pending";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <StepDot state={state} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, textTransform: "capitalize" }}>
          {status}
        </div>
        {typeof state?.creditsSpent === "number" && state.creditsSpent > 0 && (
          <div className="subtle mono" style={{ fontSize: 11 }}>
            {state.creditsSpent} credit{state.creditsSpent === 1 ? "" : "s"}
          </div>
        )}
        {state?.errorMessage && (
          <div
            className="subtle"
            style={{
              fontSize: 11,
              color:
                state.status === "failed" ? "var(--danger)" : "var(--fg-subtle)",
              whiteSpace: "normal",
              maxWidth: 200,
            }}
          >
            {state.errorMessage}
          </div>
        )}
        {state?.outputFileId && state.status === "succeeded" && (
          <Link
            href={`/app/files/${state.outputFileId}/preview`}
            className="subtle"
            style={{ fontSize: 11, textDecoration: "underline" }}
          >
            View output
          </Link>
        )}
      </div>
    </div>
  );
}

function TerminalBanner({
  outcome,
  onStartOver,
}: {
  outcome: Extract<Phase, { kind: "terminal" }>["outcome"];
  onStartOver: () => void;
}) {
  const copy = mapTerminalCopy(outcome);
  const toneColors: Record<typeof copy.tone, { border: string; bg: string; fg: string }> = {
    success: {
      border: "var(--success, #16a34a)",
      bg: "rgba(22, 163, 74, 0.06)",
      fg: "var(--success, #16a34a)",
    },
    danger: {
      border: "var(--danger)",
      bg: "rgba(220, 38, 38, 0.06)",
      fg: "var(--danger)",
    },
    warning: {
      border: "var(--warning, #d97706)",
      bg: "rgba(217, 119, 6, 0.08)",
      fg: "var(--warning, #d97706)",
    },
    neutral: {
      border: "var(--border-strong)",
      bg: "var(--bg-1)",
      fg: "var(--fg)",
    },
  };
  const c = toneColors[copy.tone];
  return (
    <div
      role="status"
      style={{
        padding: "14px 16px",
        border: `1px solid ${c.border}`,
        background: c.bg,
        borderRadius: "var(--radius-sm)",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: c.fg }}>
          {copy.title}
        </div>
        <div className="subtle" style={{ fontSize: 13, marginTop: 2 }}>
          {copy.body}
        </div>
        {outcome.status === "paused" &&
          outcome.reason === "insufficient_credits" && (
            <Link
              href="/app/billing"
              className="subtle"
              style={{
                fontSize: 12,
                textDecoration: "underline",
                display: "inline-block",
                marginTop: 6,
              }}
            >
              Top up credits →
            </Link>
          )}
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onStartOver}
      >
        Start a new run
      </button>
    </div>
  );
}

// Type-level guard: keep `AgentToolId` referenced so future changes to the
// union are caught by tsc. (Used inline in `stepSummary` via narrowed
// switch — this void-cast is purely for the unused-import lint rule in
// builds that don't see the switch directly.)
void (undefined as unknown as AgentToolId | undefined);
