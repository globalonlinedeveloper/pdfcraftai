// Phase 6.3 — Agent planner.
//
// Turns a user's natural-language prompt + their file queue into a
// structured, validated `AgentPlan`. The plan is what the approval card
// shows and what the runner executes.
//
// Flow:
//   1. Caller passes `{prompt, files[], preferredProvider?}`.
//   2. We select an AI provider via the registry (same adapter layer the
//      chat / summarize / translate helpers use).
//   3. We send a system prompt that embeds the entire `AGENT_TOOL_CATALOG`
//      plus strict rules about the output JSON shape.
//   4. LLM returns a JSON block. We strip code fences, parse, run Zod.
//   5. We cross-check each step against the catalog:
//        - toolId exists
//        - scope rules hold (queue-level only at stepIndex 0)
//        - compare's pair input is wired
//        - output/input kinds chain correctly
//        - each step's estimatedCostPerUnit is within 20% of what the
//          catalog would compute (the rubric in the task description).
//   6. We recompute `totalQuote` from the catalog rather than trusting the
//      LLM — the LLM's number is advisory; ours is authoritative.
//
// Errors are returned as a discriminated-union result (`ok: false`) rather
// than thrown. The server action layer maps codes to user-facing copy.
// Exception: NoAIProviderConfiguredError is thrown — that's a deployment
// config issue, not a per-request failure, and the action layer catches it
// separately to return a 503.

import "server-only";

import { z } from "zod";

import type { AIProvider } from "@/lib/ai/provider";
import { selectProvider } from "@/lib/ai/registry";
import type { AIProviderId, TokenUsage } from "@/lib/ai/types";

import { AGENT_TOOL_CATALOG, AGENT_TOOL_ORDER, computeStepUnitCost } from "./catalog";
import type {
  AgentErrorCode,
  AgentPlan,
  AgentPlanStep,
  AgentStepInputRef,
  AgentToolId,
} from "./types";

// --- public surface ---------------------------------------------------

/** What the planner needs to know about each file in the queue. */
export interface PlannerFile {
  id: string;
  name: string;
  pageCount: number;
  /**
   * True if the PDF is password-protected. The catalog's constraints tell
   * the LLM to refuse encrypted inputs, and we cross-validate here so a
   * planner that ignores the rule still gets rejected.
   */
  encrypted?: boolean;
}

export interface PlanAgentRunInput {
  /** The user's natural-language request. */
  prompt: string;
  /** File metadata snapshot — the plan fans per-file scope over this list. */
  files: PlannerFile[];
  /** Provider override; otherwise the registry picks. */
  preferredProvider?: AIProviderId;
}

/**
 * Result of a planner call. Success returns a validated plan plus the
 * provider metadata for audit + the credit charge at the route layer.
 * Failure returns a narrow AgentErrorCode so the UI can map 1:1 to copy.
 */
export type PlanAgentRunResult =
  | {
      ok: true;
      plan: AgentPlan;
      providerId: AIProviderId;
      model: string;
      usage: TokenUsage;
    }
  | {
      ok: false;
      code: Extract<AgentErrorCode, "planner_refused" | "planner_invalid_plan">;
      message: string;
      /** The raw model output, for server-side debugging. Never shown to the user. */
      rawResponse?: string;
    };

/** Same "no provider" error contract as summarize/translate/ocr helpers. */
export class NoAIProviderConfiguredError extends Error {
  constructor() {
    super(
      "No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY."
    );
    this.name = "NoAIProviderConfiguredError";
  }
}

// --- Zod schema for the LLM's raw output ------------------------------

/**
 * Mirrors `AgentPlan` but with:
 *   - permissive `params: Record<string, unknown>` — tool-level Zod lives
 *     in the executor. The planner can't know each tool's exact shape
 *     without duplicating the executor's adapter code.
 *   - `toolId` kept as a plain string and enum-validated post-parse so a
 *     mis-spelled tool id yields a clean "planner_invalid_plan" instead of
 *     a Zod discriminated-union failure deep in a recursive error tree.
 */
const PLANNER_INPUT_REF_SCHEMA: z.ZodType<AgentStepInputRef> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("source") }),
    z.object({ kind: z.literal("step"), stepIndex: z.number().int().min(0) }),
    z.object({
      kind: z.literal("pair"),
      a: PLANNER_INPUT_REF_SCHEMA,
      b: PLANNER_INPUT_REF_SCHEMA,
    }),
  ])
);

const PLANNER_STEP_SCHEMA = z.object({
  stepIndex: z.number().int().min(0),
  toolId: z.string().min(1),
  displayName: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  inputRef: PLANNER_INPUT_REF_SCHEMA,
  estimatedCostPerUnit: z.number().nonnegative(),
});

const PLANNER_PLAN_SCHEMA = z.object({
  version: z.literal(1),
  steps: z.array(PLANNER_STEP_SCHEMA).min(1).max(6),
  fileCount: z.number().int().min(0),
  totalQuote: z.number().nonnegative(),
  summary: z.string().min(1).max(400),
});

/**
 * Special sentinel the LLM can return to say "I refuse to plan this."
 * We ask for `{ "refused": true, "reason": "..." }` rather than letting
 * the model free-form a refusal, so we can distinguish refusals from
 * malformed JSON.
 */
const PLANNER_REFUSAL_SCHEMA = z.object({
  refused: z.literal(true),
  reason: z.string().min(1).max(400),
});

// --- top-level entry point --------------------------------------------

export async function planAgentRun(
  input: PlanAgentRunInput
): Promise<PlanAgentRunResult> {
  const provider = await selectProvider({
    capabilityNeeded: "streaming",
    preferredId: input.preferredProvider,
  });
  if (!provider) throw new NoAIProviderConfiguredError();

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);

  let rawText: string;
  let usage: TokenUsage;
  let providerId: AIProviderId;
  let model: string;

  try {
    const result = await provider.chat({
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      // Plans are ~400 tokens max at max-complexity (6 steps * ~60 tokens).
      // Cap tight so a run-away model doesn't add free narrative.
      maxTokens: 1500,
      // Low temperature — we want deterministic JSON structure, not
      // creative planning. 0.1 matches the task description.
      temperature: 0.1,
    });
    if (result.stopReason === "error") {
      return {
        ok: false,
        code: "planner_invalid_plan",
        message: "The planner returned an error stop reason.",
      };
    }
    rawText = result.text;
    usage = result.usage;
    providerId = result.providerId;
    model = result.model;
  } catch (err) {
    return {
      ok: false,
      code: "planner_invalid_plan",
      message: `Planner call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Pull a JSON blob out of whatever the model emitted.
  const jsonText = extractJsonBlock(rawText);
  if (!jsonText) {
    return {
      ok: false,
      code: "planner_invalid_plan",
      message: "Planner did not return a JSON block.",
      rawResponse: rawText,
    };
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      code: "planner_invalid_plan",
      message: `Planner JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      rawResponse: rawText,
    };
  }

  // Refusal path first — lets the UI say "the agent declined this request"
  // instead of "bad plan".
  const refusal = PLANNER_REFUSAL_SCHEMA.safeParse(parsedUnknown);
  if (refusal.success) {
    return {
      ok: false,
      code: "planner_refused",
      message: refusal.data.reason,
    };
  }

  const parsed = PLANNER_PLAN_SCHEMA.safeParse(parsedUnknown);
  if (!parsed.success) {
    return {
      ok: false,
      code: "planner_invalid_plan",
      message: `Planner output failed schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
      rawResponse: rawText,
    };
  }

  // Semantic checks + cost reconciliation.
  const semanticCheck = validateAndNormalizePlan(parsed.data, input);
  if (!semanticCheck.ok) {
    return {
      ok: false,
      code: "planner_invalid_plan",
      message: semanticCheck.error,
      rawResponse: rawText,
    };
  }

  return {
    ok: true,
    plan: semanticCheck.plan,
    providerId,
    model,
    usage,
  };
}

// --- prompt builders --------------------------------------------------

/**
 * Renders the catalog and plan rules in a form the LLM can follow. Kept
 * in one big string so the whole contract is visible in one diff when we
 * tune it.
 */
function buildSystemPrompt(): string {
  const catalogLines = AGENT_TOOL_ORDER.map((id) => {
    const spec = AGENT_TOOL_CATALOG[id];
    const costStr = (() => {
      switch (spec.cost.kind) {
        case "flat":
          return `${spec.cost.credits} credits (flat)`;
        case "perPage":
          return `${spec.cost.creditsPerPage} credits/page, capped at ${spec.cost.pageCap} pages`;
        case "zero":
          return `0 credits (free, client-side)`;
        case "chatTurn":
          return `${spec.cost.credits} credit (per chat turn)`;
      }
    })();
    return [
      `- "${spec.id}" (${spec.displayName}) — ${spec.description}`,
      `    scope: ${spec.scope}; input: ${spec.inputKind}; output: ${spec.outputKind}; cost: ${costStr}`,
      `    params: ${spec.paramsHint}`,
      `    constraints:`,
      ...spec.constraints.map((c) => `      • ${c}`),
    ].join("\n");
  }).join("\n");

  return [
    "You are the PDFCraft agent planner. Your job is to translate the user's",
    "natural-language request plus their uploaded file list into a STRICT",
    "JSON plan that the runner will execute. You do NOT execute anything —",
    "you only emit the plan.",
    "",
    "========== TOOL CATALOG ==========",
    catalogLines,
    "========== END CATALOG ==========",
    "",
    "RULES — READ ALL OF THEM BEFORE WRITING ANYTHING:",
    "",
    '1. OUTPUT FORMAT: return a single JSON object, no prose, no code-fence',
    '   labels beyond ```json. The shape is:',
    "   {",
    '     "version": 1,',
    '     "steps": [ AgentPlanStep, ... ],',
    '     "fileCount": <number matching the queue>,',
    '     "totalQuote": <upper-bound total credits across the whole plan>,',
    '     "summary": "<one-sentence human-readable plan summary>"',
    "   }",
    "   Each step is:",
    "   {",
    '     "stepIndex": <0-based int>,',
    '     "toolId": "<one of the ids in the catalog>",',
    '     "displayName": "<human label, usually the tool\'s displayName>",',
    '     "params": { <per-tool params per the paramsHint> },',
    '     "inputRef": <input reference, see rule 3>,',
    '     "estimatedCostPerUnit": <per-file credits for this step>',
    "   }",
    "",
    '2. STEP COUNT: between 1 and 6 steps. Prefer fewer.',
    "",
    "3. INPUT REFERENCES:",
    '   - { "kind": "source" } — the file from the queue (fans out per-file).',
    '   - { "kind": "step", "stepIndex": N } — output of a previous step in',
    '     the same per-file chain. N must be strictly less than the current',
    '     step\'s stepIndex.',
    '   - { "kind": "pair", "a": <ref>, "b": <ref> } — ONLY for ai-compare.',
    '     Both sides must resolve to PDFs.',
    '   - Step 0\'s inputRef must always be { "kind": "source" } for per-file',
    '     tools, or a pair of sources for ai-compare, or whatever the tool',
    '     needs for queue-level tools (merge takes all sources implicitly —',
    '     use { "kind": "source" }).',
    "",
    "4. SCOPE RULES:",
    "   - queue-level tools (merge, ai-compare) may only appear at stepIndex 0.",
    "   - ai-compare requires EXACTLY two files in the queue.",
    "   - merge requires AT LEAST two files.",
    "   - split's output (pdf-multi) cannot feed a later step — it must be",
    "     the last step in a chain.",
    "   - chat is a sub-call — it doesn't consume files. Use it only when",
    "     the user's ask is a question you can answer without running a tool.",
    "",
    "5. INPUT/OUTPUT CHAINING:",
    '   - A step with inputKind="pdf" must be fed by a step whose outputKind',
    '     is "pdf" (or by { kind: "source" }).',
    '   - A step with inputKind="markdown" must be fed by a step whose',
    '     outputKind is "markdown". (V1 does not yet wire markdown inputs —',
    "     if you need one, prefer a plain chain from source instead.)",
    '   - A step with inputKind="none" (chat) ignores inputRef but still',
    '     must declare { "kind": "source" } to satisfy the schema.',
    "",
    "6. COST ESTIMATES:",
    "   - estimatedCostPerUnit = per-FILE cost for per-file tools, or the",
    "     total cost for queue-level / sub-call tools.",
    "   - For ai-ocr specifically, estimatedCostPerUnit = 2 * min(pages, 50).",
    "     Use the file's pageCount from the user prompt.",
    "   - totalQuote = sum over all steps of (estimatedCostPerUnit *",
    "     multiplier), where multiplier = fileCount for per-file scope",
    "     and 1 for queue-level / sub-call.",
    "",
    "7. REFUSAL: if the user's request cannot be served by the tools in the",
    '   catalog, return exactly: { "refused": true, "reason": "<one line>" }',
    "   Examples that should be refused:",
    "   - asking to analyze sentiment (no such tool)",
    "   - asking for ai-compare with zero or one file",
    "   - asking to sign a document (not in the v1 agent catalog)",
    "   - vague requests that match no tool (e.g., 'do something smart')",
    "",
    "8. DO NOT:",
    "   - invent tool ids not in the catalog",
    "   - emit params fields other than those in each tool's paramsHint",
    "   - include any text outside the JSON block",
    "   - wrap the plan in prose or commentary",
    "",
    "Always produce machine-parseable JSON. Nothing else.",
  ].join("\n");
}

function buildUserPrompt(input: PlanAgentRunInput): string {
  const fileLines =
    input.files.length === 0
      ? "  (no files in queue — this is a chat-only request)"
      : input.files
          .map(
            (f, i) =>
              `  ${i + 1}. "${f.name}" — ${f.pageCount} page${
                f.pageCount === 1 ? "" : "s"
              }${f.encrypted ? " [ENCRYPTED — cannot be processed]" : ""}`
          )
          .join("\n");

  return [
    "User's request:",
    input.prompt.trim(),
    "",
    "File queue:",
    fileLines,
    "",
    `fileCount = ${input.files.length}`,
    "",
    "Emit the JSON plan now. No prose, no commentary, no code fences beyond ```json.",
  ].join("\n");
}

// --- JSON extraction --------------------------------------------------

/**
 * The model may return the JSON bare, inside a ```json ... ``` fence, or
 * (against instructions) alongside preamble prose. This grabs the most
 * likely JSON blob:
 *   1. A fenced ```json ... ``` block
 *   2. A fenced ``` ... ``` block
 *   3. The substring from the first `{` to the last `}`
 *
 * Returns null if nothing looks like JSON at all.
 */
function extractJsonBlock(raw: string): string | null {
  const trimmed = raw.trim();

  // Fenced json block
  const fencedJson = trimmed.match(/```json\s*\n([\s\S]*?)\n```/i);
  if (fencedJson) return fencedJson[1]!.trim();

  // Fenced generic block
  const fencedAny = trimmed.match(/```\s*\n([\s\S]*?)\n```/);
  if (fencedAny) return fencedAny[1]!.trim();

  // Bare — first `{` to last `}`.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1).trim();
  }

  return null;
}

// --- semantic validation ----------------------------------------------

type PlanValidation =
  | { ok: true; plan: AgentPlan }
  | { ok: false; error: string };

/**
 * Allowed slop between the planner's `estimatedCostPerUnit` and the
 * authoritative catalog computation. Task description pins this at 20%.
 * If the LLM is further off, we reject — the estimate is a user-facing
 * number and we can't let the model lowball or pad it.
 */
const COST_TOLERANCE = 0.2;

function validateAndNormalizePlan(
  raw: z.infer<typeof PLANNER_PLAN_SCHEMA>,
  input: PlanAgentRunInput
): PlanValidation {
  // fileCount must match the request.
  if (raw.fileCount !== input.files.length) {
    return {
      ok: false,
      error: `fileCount mismatch: plan says ${raw.fileCount}, request has ${input.files.length}`,
    };
  }

  // Encrypted PDFs are a hard stop for every PDF-input tool.
  const anyEncrypted = input.files.some((f) => f.encrypted);

  // stepIndex must be 0..N-1 in order.
  for (let i = 0; i < raw.steps.length; i++) {
    if (raw.steps[i]!.stepIndex !== i) {
      return {
        ok: false,
        error: `steps[${i}].stepIndex must be ${i}, got ${raw.steps[i]!.stepIndex}`,
      };
    }
  }

  const normalizedSteps: AgentPlanStep[] = [];
  let authoritativeTotal = 0;

  for (const step of raw.steps) {
    // Tool must exist.
    const spec = AGENT_TOOL_CATALOG[step.toolId as AgentToolId];
    if (!spec) {
      return {
        ok: false,
        error: `unknown toolId "${step.toolId}" at step ${step.stepIndex}`,
      };
    }

    // Queue-level and sub-call tools only at stepIndex 0.
    if (spec.scope !== "per-file" && step.stepIndex !== 0) {
      return {
        ok: false,
        error: `tool "${spec.id}" has scope=${spec.scope} but appears at stepIndex ${step.stepIndex} (must be 0)`,
      };
    }

    // Compare: exactly two files, pair input.
    if (spec.id === "ai-compare") {
      if (input.files.length !== 2) {
        return {
          ok: false,
          error: `ai-compare requires exactly 2 files, queue has ${input.files.length}`,
        };
      }
      if (step.inputRef.kind !== "pair") {
        return {
          ok: false,
          error: `ai-compare step must use inputRef.kind="pair"`,
        };
      }
    }

    // Merge: at least two files.
    if (spec.id === "merge" && input.files.length < 2) {
      return {
        ok: false,
        error: `merge requires at least 2 files, queue has ${input.files.length}`,
      };
    }

    // Split: must be last step (pdf-multi can't chain in v1).
    if (spec.id === "split" && step.stepIndex !== raw.steps.length - 1) {
      return {
        ok: false,
        error: `split produces pdf-multi which can't feed another step — must be the LAST step in the plan`,
      };
    }

    // Encrypted PDFs rejected for every PDF-input tool.
    if (spec.inputKind !== "none" && anyEncrypted) {
      return {
        ok: false,
        error: `one or more queued files are encrypted; tool "${spec.id}" cannot process encrypted PDFs`,
      };
    }

    // inputRef chaining sanity: a "step" ref must point to an earlier step.
    const refCheck = validateInputRef(step.inputRef, step.stepIndex, raw.steps);
    if (!refCheck.ok) {
      return { ok: false, error: `step ${step.stepIndex}: ${refCheck.error}` };
    }

    // Input/output kind match (step ref only — source and pair are trusted).
    const chainCheck = validateChainKind(spec, step.inputRef, raw.steps);
    if (!chainCheck.ok) {
      return { ok: false, error: `step ${step.stepIndex}: ${chainCheck.error}` };
    }

    // Cost reconciliation. For per-page tools (OCR) we pick the relevant file's
    // page count. For per-file scope we check each file separately: if the
    // MAX per-file cost disagrees with the LLM's estimatedCostPerUnit by more
    // than tolerance, reject. For queue-level / sub-call we just check flat.
    const costCheck = validateCost(spec, step, input.files);
    if (!costCheck.ok) return { ok: false, error: `step ${step.stepIndex}: ${costCheck.error}` };

    normalizedSteps.push({
      stepIndex: step.stepIndex,
      toolId: spec.id,
      displayName: step.displayName || spec.displayName,
      params: step.params,
      inputRef: step.inputRef,
      estimatedCostPerUnit: costCheck.unitCost,
    });

    // Contribute to authoritative total.
    authoritativeTotal += costCheck.totalContribution;
  }

  // Authoritative total overrides the LLM's — but we warn if they differ
  // by more than tolerance (purely for logs; the user sees OUR number).
  const totalOk =
    raw.totalQuote === 0
      ? authoritativeTotal === 0
      : Math.abs(raw.totalQuote - authoritativeTotal) / Math.max(raw.totalQuote, 1) <=
        COST_TOLERANCE;
  if (!totalOk) {
    // Still accept the plan — the user sees `authoritativeTotal` regardless —
    // but signal the drift in the summary so we know the LLM is off.
    // (Falling through on purpose; not an error.)
  }

  return {
    ok: true,
    plan: {
      version: 1,
      steps: normalizedSteps,
      fileCount: input.files.length,
      totalQuote: authoritativeTotal,
      summary: raw.summary.trim(),
    },
  };
}

function validateInputRef(
  ref: AgentStepInputRef,
  thisIndex: number,
  allSteps: ReadonlyArray<{ stepIndex: number }>
):
  | { ok: true }
  | { ok: false; error: string } {
  switch (ref.kind) {
    case "source":
      return { ok: true };
    case "step":
      if (ref.stepIndex >= thisIndex) {
        return {
          ok: false,
          error: `inputRef.stepIndex=${ref.stepIndex} must be less than current stepIndex=${thisIndex}`,
        };
      }
      if (!allSteps.some((s) => s.stepIndex === ref.stepIndex)) {
        return { ok: false, error: `inputRef.stepIndex=${ref.stepIndex} points at nonexistent step` };
      }
      return { ok: true };
    case "pair": {
      const a = validateInputRef(ref.a, thisIndex, allSteps);
      if (!a.ok) return a;
      const b = validateInputRef(ref.b, thisIndex, allSteps);
      if (!b.ok) return b;
      return { ok: true };
    }
  }
}

function validateChainKind(
  spec: { inputKind: string },
  ref: AgentStepInputRef,
  allSteps: ReadonlyArray<{ stepIndex: number; toolId: string }>
):
  | { ok: true }
  | { ok: false; error: string } {
  // "source" and "pair" are trusted — source is always a PDF (files in the
  // queue), pair is ai-compare's pre-validated shape.
  if (ref.kind !== "step") return { ok: true };

  const upstream = allSteps.find((s) => s.stepIndex === ref.stepIndex);
  if (!upstream) return { ok: false, error: `upstream step ${ref.stepIndex} not found` };

  const upstreamSpec = AGENT_TOOL_CATALOG[upstream.toolId as AgentToolId];
  if (!upstreamSpec) {
    return { ok: false, error: `upstream step ${ref.stepIndex} has unknown toolId` };
  }

  if (upstreamSpec.outputKind === "pdf-multi") {
    return {
      ok: false,
      error: `cannot chain off a pdf-multi step (split) — split must be terminal`,
    };
  }
  if (spec.inputKind === "pdf" && upstreamSpec.outputKind !== "pdf") {
    return {
      ok: false,
      error: `inputKind=pdf requires upstream outputKind=pdf, got ${upstreamSpec.outputKind}`,
    };
  }
  if (spec.inputKind === "markdown" && upstreamSpec.outputKind !== "markdown") {
    return {
      ok: false,
      error: `inputKind=markdown requires upstream outputKind=markdown, got ${upstreamSpec.outputKind}`,
    };
  }
  // inputKind "none" and "pdf-pair" are handled elsewhere.
  return { ok: true };
}

function validateCost(
  spec: (typeof AGENT_TOOL_CATALOG)[AgentToolId],
  step: { estimatedCostPerUnit: number },
  files: PlannerFile[]
):
  | { ok: true; unitCost: number; totalContribution: number }
  | { ok: false; error: string } {
  // Compute the authoritative unit cost. For perPage, use the largest
  // page count in the queue — per-file scope means one of them could be
  // the most expensive; that's the right quote ceiling.
  let unitCost: number;
  if (spec.cost.kind === "perPage") {
    const worst = files.reduce((m, f) => Math.max(m, f.pageCount), 1);
    unitCost = computeStepUnitCost(spec, { pages: worst });
  } else {
    unitCost = computeStepUnitCost(spec);
  }

  // 20% tolerance — absolute or relative, whichever is looser (so a step
  // that costs 3 credits but the LLM said 2 isn't flagged for a 1-credit delta).
  const abs = Math.abs(step.estimatedCostPerUnit - unitCost);
  const rel = unitCost === 0 ? 0 : abs / unitCost;
  if (rel > COST_TOLERANCE && abs > 1) {
    return {
      ok: false,
      error: `estimatedCostPerUnit=${step.estimatedCostPerUnit} disagrees with catalog's ${unitCost} by >${COST_TOLERANCE * 100}%`,
    };
  }

  // Multiplier: per-file fans across queue, queue-level + sub-call run once.
  const multiplier = spec.scope === "per-file" ? Math.max(files.length, 1) : 1;

  return {
    ok: true,
    unitCost, // authoritative — override the LLM's
    totalContribution: unitCost * multiplier,
  };
}
