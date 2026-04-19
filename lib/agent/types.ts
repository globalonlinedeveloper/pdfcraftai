// Phase 6.3 — Agent shared types.
//
// Lives outside `lib/agent/catalog.ts` / `lib/agent/planner.ts` so server
// routes, server actions, client runner, and the DB schema JSDoc can all
// import the same shape without pulling the (heavier) planner LLM calls
// or the (client-only) pdf-lib tool helpers.
//
// The DB stores `plan_json` and `input_json` as raw JSON blobs; these
// types are the canonical contract the reader/writer code casts to.
// Zod validators in `lib/agent-actions.ts` and `lib/agent/planner.ts`
// guard the boundaries at runtime.

/**
 * Tools the agent is allowed to invoke. A strict subset of what's listed
 * in `lib/tools.ts` — only the tools that have real, working implementations
 * today (Phases 3, 5, 5.1, 5.2, 5.3, 5.4). Adding a new tool to the agent
 * means extending this union AND adding a matching row to `AGENT_TOOL_CATALOG`.
 */
export type AgentToolId =
  | "ai-summarize"
  | "ai-translate"
  | "ai-compare"
  | "ai-ocr"
  | "merge"
  | "split"
  | "rotate"
  | "compress"
  | "chat";

/**
 * How a tool maps onto the user's file queue.
 *
 *   per-file     — Plan step runs once per file in the queue. Most
 *                  tools are here (summarize, translate, ocr, rotate,
 *                  compress, split). Output feeds into a per-file
 *                  downstream step.
 *   queue-level  — Plan step runs ONCE across the queue. Merge takes all
 *                  files and produces one; compare takes exactly two and
 *                  produces one. These steps can only appear at positions
 *                  where the "per-file" flow has already collapsed
 *                  (typically position 0, before any per-file fan-out).
 *   sub-call     — Zero-file (or single-file) reasoning step. `chat` is
 *                  the only one today. Doesn't branch or fan out.
 */
export type AgentToolScope = "per-file" | "queue-level" | "sub-call";

/**
 * What a tool produces. Tells the planner what can chain off it.
 *
 *   pdf          — A new `files` row with a PDF. rotate / compress / merge
 *                  output this, and it's a valid input for every other tool.
 *   pdf-multi    — Multiple new `files` rows (split). Not yet a valid
 *                  chain input for v1 — the planner must terminate a chain
 *                  at a split step.
 *   markdown     — An `ai_outputs` row with rendered markdown. summarize,
 *                  translate, ocr all emit this. Can feed into ai-translate
 *                  (translate a summary) but not back into a PDF-input tool.
 *   text         — Free-form text with no file/ai_outputs row. `chat`
 *                  produces this. Terminal — can't chain into anything
 *                  that needs a PDF or a stored artifact.
 */
export type AgentToolOutputKind = "pdf" | "pdf-multi" | "markdown" | "text";

/**
 * What kind of input a downstream step needs. The executor uses this to
 * wire up `inputRef` resolution: step N says "I need a PDF from step M"
 * → executor resolves step M's `outputFileId`. If the kind doesn't match
 * (e.g. step M produced markdown but step N wants a PDF), the planner
 * rejected an invalid plan upstream.
 */
export type AgentToolInputKind = "pdf" | "pdf-pair" | "markdown" | "none";

/**
 * Cost contribution of a single step, per-file.
 *   flat       — Exact credit spend (summarize=3, translate=5, compare=15).
 *   perPage    — Page-count-dependent (ocr=2/page). Multiplier captured at
 *                execute time from the server's real page peek.
 *   zero       — Client-side free tools (merge/split/rotate/compress).
 *   chatTurn   — Single chat turn (AI_OPERATION_COSTS.chat_turn = 1).
 */
export type AgentStepCostShape =
  | { kind: "flat"; credits: number }
  | { kind: "perPage"; creditsPerPage: number; pageCap: number }
  | { kind: "zero" }
  | { kind: "chatTurn"; credits: number };

/**
 * Per-tool spec the planner reads via the system prompt and the executor
 * reads via `AGENT_TOOL_CATALOG[toolId]` at dispatch time.
 *
 * `paramsHint` is a plain-English description of what parameters the tool
 * accepts (e.g. `{depth: 'tldr' | 'standard' | 'detailed'}` for summarize).
 * The planner is instructed to emit params in the exact shape; the
 * executor's per-tool adapter validates with Zod before POSTing.
 */
export type AgentToolSpec = {
  id: AgentToolId;
  displayName: string;
  /** Planner-facing short description — what the tool does, in one line. */
  description: string;
  /** client = pdf-lib in the browser; server = POST /api/ai/<tool>. */
  side: "client" | "server";
  scope: AgentToolScope;
  inputKind: AgentToolInputKind;
  outputKind: AgentToolOutputKind;
  cost: AgentStepCostShape;
  /** Plain-English params shape the planner should emit. */
  paramsHint: string;
  /** Plan-time constraints (file count, encrypted PDFs, etc.). */
  constraints: string[];
};

/**
 * Reference to another step's output, used as an input to a later step.
 * Resolved at execute time by the runner.
 *
 *   source           — The user's original queue entry for this file
 *                      bucket. Always valid for step 0.
 *   step             — Output of another step in the same plan. `stepIndex`
 *                      must be < the referring step's index.
 *   pair             — Two-file input (for ai-compare only). `aStepIndex`
 *                      and `bStepIndex` each reference either source or a
 *                      previous step. For the per-file flow, step 0 always
 *                      takes { kind: "source" }.
 */
export type AgentStepInputRef =
  | { kind: "source" }
  | { kind: "step"; stepIndex: number }
  | { kind: "pair"; a: AgentStepInputRef; b: AgentStepInputRef };

/**
 * A single step in an agent plan. The planner emits a list of these.
 *
 * `params` is an opaque per-tool JSON object — the executor's tool adapter
 * validates it. Common shapes:
 *   ai-summarize → {depth: "tldr" | "standard" | "detailed"}
 *   ai-translate → {targetLang: string}
 *   ai-compare   → {}   (pair input carries the two sides)
 *   ai-ocr       → {}
 *   rotate       → {rotation: 90 | 180 | 270}
 *   split        → {ranges: string}  (e.g. "1-5,10-")
 *   compress     → {}
 *   merge        → {}
 *   chat         → {prompt: string}
 */
export type AgentPlanStep = {
  stepIndex: number;
  toolId: AgentToolId;
  displayName: string;
  params: Record<string, unknown>;
  inputRef: AgentStepInputRef;
  /**
   * Upper-bound cost for one run of this step on one file. For per-file
   * tools, total contribution = this × fileCount. For queue-level tools,
   * total contribution = this × 1. Must match what the catalog's cost
   * shape would compute given the step's known inputs (validated by the
   * planner post-processing).
   */
  estimatedCostPerUnit: number;
};

/**
 * The structured plan the planner returns and the user approves. Stored
 * verbatim in `agent_runs.plan_json`.
 */
export type AgentPlan = {
  version: 1;
  steps: AgentPlanStep[];
  /**
   * File count captured at plan time. The per-file scope multiplies by
   * this; the queue-level scope ignores it (runs once). Must match
   * `agent_runs.file_ids_json.length` at approval time — a race where the
   * user deletes a file between plan and approve flips the run to failed.
   */
  fileCount: number;
  /**
   * Upper-bound total credit spend across the entire plan. The approval
   * card surfaces this as "You'll be charged up to N credits." The runner
   * enforces `spentCredits <= totalQuote`.
   */
  totalQuote: number;
  /**
   * Human-readable summary line the agent writes about the plan (e.g.
   * "OCR each file, then summarize, then translate to Spanish"). Not
   * structurally important — just displayed in the approval card.
   */
  summary: string;
};

/**
 * Mirrors `agent_runs.status` enum. Declared in TS so switch statements
 * are exhaustive.
 */
export type AgentRunStatus =
  | "pending_approval"
  | "approved"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * Mirrors `agent_run_steps.status` enum.
 */
export type AgentStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

/**
 * Error codes bubbled to the UI from the runner / planner. Kept narrow so
 * copy can map 1:1 without fuzzy string matching.
 */
export type AgentErrorCode =
  | "planner_refused"            // LLM declined to plan (e.g. unsafe request)
  | "planner_invalid_plan"        // LLM returned malformed JSON or bad tools
  | "quote_exceeded"              // Next step would push spend > quote
  | "file_deleted_mid_run"        // A queued file was deleted before its turn
  | "provider_error"              // Per-step AI provider failure
  | "insufficient_credits"        // Credit balance < next step's estimate
  | "validation_error"            // Params failed Zod validation
  | "tool_unavailable";           // e.g. OCR needs pdfInput-capable provider
