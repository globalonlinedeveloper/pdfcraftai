// lib/agent/tool-registry.ts
//
// Single source of truth for tools the planner LLM can call. Each entry is:
//   - the tool's stable ID (matches lib/tools.ts for user-facing tools, or
//     "sys.<name>" for system primitives)
//   - a Zod schema for params (validated post-LLM-output, before executor
//     dispatches — refuses any plan with malformed tool calls)
//   - a human-readable description (fed to the LLM in tool_use schema)
//   - a handler key telling the executor which dispatch path to take:
//       * "ai-route"  → POST internally to /api/ai/<op>
//       * "wasm-node" → run pdf-lib / pdfjs-dist server-side
//       * "system"    → invoke an in-process system tool (fs.list, ask.user)
//   - the risk level (drives the executor's approval gate)
//   - cost estimator (function that returns estCredits given the plan
//     context — e.g. ai-ocr returns 2 × pageCount)
//
// Adding a new agent-callable tool:
//   1. Add a TOOLS[] entry in lib/tools.ts (if user-facing)
//   2. Add an entry here with params Zod + handler + cost
//   3. The executor will pick it up automatically via the dispatch table.
//
// Why a registry instead of just deriving from lib/tools.ts:
//   The user-facing tool catalog has cost as a display string ("3 credits
//   per doc") which is fine for chips but not callable. We need typed
//   params (which lib/tools.ts deliberately doesn't have — TOOLS[] is the
//   "what's on the menu" list, not the "how to invoke" recipe). The
//   registry is the recipe book.

import { z } from "zod";
import type { RiskLevel, ToolName } from "./types";

/**
 * Per-tool definition. The shape that gets serialised to the planner
 * LLM as a tool_use definition.
 */
export interface AgentToolDef<P extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Stable tool ID. Matches lib/tools.ts for user tools; "sys.X" for system. */
  name: ToolName;
  /**
   * Description fed verbatim to the planner LLM. Should explain WHAT
   * the tool produces (the deliverable), WHEN to use it (one-liner
   * heuristic), and any IMPORTANT input constraints.
   */
  description: string;
  /** Zod schema for params. The executor uses .parse() to validate. */
  params: P;
  /** Dispatch path. */
  handler: "ai-route" | "wasm-node" | "system";
  /**
   * For "ai-route": which AI op route to POST to. e.g. "summarize" →
   * /api/ai/summarize. Required iff handler === "ai-route".
   */
  aiOp?: string;
  /** Risk classification. See lib/agent/types.ts RiskLevel. */
  risk: RiskLevel;
  /**
   * Cost estimator. Receives the parsed params + context (prior step
   * outputs metadata like page count) and returns expected credits.
   * Free / WASM tools should return 0.
   *
   * The planner LLM uses these estimates to budget within the user's
   * stated cap (e.g. "no more than 50 credits") so plans don't explode.
   */
  estCredits: (params: z.infer<P>, ctx: PlanContext) => number;
}

/**
 * Context passed to cost estimators + the planner. Captures everything
 * the LLM might need to reason about size / cost.
 */
export interface PlanContext {
  /** Approximate page count if a PDF has been pre-uploaded. */
  inputPageCount?: number;
  /** Number of files the user mentioned uploading. */
  inputFileCount?: number;
}

// ---------------------------------------------------------------------------
// Registry entries — start narrow on purpose. H1 ships ~20 tools that cover
// the screenshot's example prompts. Subsequent commits expand to the full 95.
// Each entry has full type safety on params via z.infer<typeof params>.
// ---------------------------------------------------------------------------

/** Common shape: most tools take a file_id or list of file_ids. */
const fileIdSchema = z.object({
  file_id: z
    .string()
    .min(1)
    .describe("ID of an uploaded file or the output_ref of a previous step."),
});

const fileIdsSchema = z.object({
  file_ids: z
    .array(z.string().min(1))
    .min(1)
    .describe("IDs of uploaded files or output_refs of prior steps."),
});

/**
 * Curated subset of the 95 tools, exposed to the planner. We start narrow
 * to keep the LLM's tool-choice space tight (smaller catalog → better
 * plans, fewer hallucinated tool names). Future commits add the rest.
 */
export const AGENT_TOOLS: Record<ToolName, AgentToolDef> = {
  // ─── System primitives ───────────────────────────────────────────────
  "sys.fs.list": {
    name: "sys.fs.list",
    description:
      "List files at a path the user owns (uploads, /Downloads, watched folder). Returns array of {file_id, name, size, type}. Free.",
    params: z.object({
      path: z.string().describe("e.g. '/uploads' or '/Downloads/receipts'"),
      pattern: z.string().optional().describe("optional glob, e.g. '*.pdf'"),
    }),
    handler: "system",
    risk: "safe",
    estCredits: () => 0,
  },
  "sys.ask.user": {
    name: "sys.ask.user",
    description:
      "Pause the run and ask the user a question. The plan halts at this step until the user picks an option. Use BEFORE any irreversible step (sending email, deleting files, posting to Slack). Free.",
    params: z.object({
      question: z.string().describe("Plain-English question, max ~120 chars."),
      options: z
        .array(z.string())
        .min(2)
        .max(5)
        .describe("2-5 button labels. Always include a 'No' / 'Cancel' option."),
    }),
    handler: "system",
    risk: "safe",
    estCredits: () => 0,
  },
  "sys.notify.user": {
    name: "sys.notify.user",
    description:
      "Send the user an in-app notification that the run finished. Always include as the LAST step of a plan. Free.",
    params: z.object({
      title: z.string().describe("Short notification title."),
      body: z.string().optional().describe("Optional one-line summary."),
    }),
    handler: "system",
    risk: "safe",
    estCredits: () => 0,
  },

  // ─── Free WASM tools (most-used for chains) ─────────────────────────
  merge: {
    name: "merge",
    description:
      "Combine multiple PDFs into one. Reorders if a sort order is given. Free.",
    params: fileIdsSchema.extend({
      output_name: z
        .string()
        .optional()
        .describe("Filename without extension. Default 'merged'."),
    }),
    handler: "wasm-node",
    risk: "safe",
    estCredits: () => 0,
  },
  split: {
    name: "split",
    description:
      "Split a PDF into per-page or per-range files. Returns a zip of outputs. Free.",
    params: fileIdSchema.extend({
      mode: z
        .enum(["per_page", "ranges"])
        .default("per_page")
        .describe("'per_page' splits each page; 'ranges' uses `ranges` arg."),
      ranges: z
        .string()
        .optional()
        .describe("e.g. '1-3,5,7-9' (only used when mode='ranges')"),
    }),
    handler: "wasm-node",
    risk: "safe",
    estCredits: () => 0,
  },
  compress: {
    name: "compress",
    description:
      "Shrink a PDF's file size. Best for image-heavy PDFs. Free.",
    params: fileIdSchema.extend({
      level: z.enum(["light", "balanced", "strong"]).default("balanced"),
    }),
    handler: "wasm-node",
    risk: "safe",
    estCredits: () => 0,
  },
  "extract-pages": {
    name: "extract-pages",
    description: "Pick specific pages from a PDF into a new PDF. Free.",
    params: fileIdSchema.extend({
      ranges: z.string().describe("e.g. '1-3,5,7-9'"),
    }),
    handler: "wasm-node",
    risk: "safe",
    estCredits: () => 0,
  },
  "delete-pages": {
    name: "delete-pages",
    description: "Remove pages from a PDF. Free.",
    params: fileIdSchema.extend({
      ranges: z.string().describe("Pages to delete, e.g. '2,5-7'"),
    }),
    handler: "wasm-node",
    risk: "safe",
    estCredits: () => 0,
  },

  // ─── AI tools (server-side, debit credits) ──────────────────────────
  "ai-summarize": {
    name: "ai-summarize",
    description:
      "Generate executive summary + per-section bullets cited by page. Best for reports/papers/memos. Provide EITHER file_id (an uploaded PDF) OR text (raw text from a prior step like ai-ocr). 3 credits per doc.",
    // H6: accept either file_id OR text. Bundle G5's ai-route dispatch
    // works on text directly today; file_id support lands once
    // file-storage infra ships (the existing /api/ai/* routes still
    // work for PDF uploads via the tool runner pages).
    params: z
      .object({
        file_id: z.string().optional(),
        text: z.string().optional().describe("Raw text input — alternative to file_id."),
        depth: z.enum(["tldr", "standard", "detailed"]).default("standard"),
      })
      .refine((d) => Boolean(d.file_id || d.text), {
        message: "Must provide either file_id or text.",
      }),
    handler: "ai-route",
    aiOp: "summarize",
    risk: "review",
    estCredits: () => 3,
  },
  "ai-tldr": {
    name: "ai-tldr",
    description:
      "One-paragraph executive summary. Cheapest summary tool. Provide EITHER file_id OR text. 3 credits per doc.",
    params: z
      .object({
        file_id: z.string().optional(),
        text: z.string().optional(),
      })
      .refine((d) => Boolean(d.file_id || d.text), {
        message: "Must provide either file_id or text.",
      }),
    handler: "ai-route",
    aiOp: "summarize",
    risk: "review",
    estCredits: () => 3,
  },
  "ai-ocr": {
    name: "ai-ocr",
    description:
      "Run OCR on a scanned PDF, producing both a text layer and structured tables/headings. ~2 credits per page.",
    params: fileIdSchema,
    handler: "ai-route",
    aiOp: "ocr",
    risk: "review",
    estCredits: (_p, ctx) => 2 * (ctx.inputPageCount ?? 5),
  },
  "ai-translate": {
    name: "ai-translate",
    description:
      "Translate a PDF or pasted text to a target language. Provide EITHER file_id OR text. 5 credits per doc.",
    // H7.3: accept text input the same way ai-summarize does, so the
    // agent can chain pasted-text → translate without file-storage
    // infra. fileIdSchema's required file_id was blocking text-input
    // dispatch.
    params: z
      .object({
        file_id: z.string().optional(),
        text: z.string().optional(),
        target_lang: z
          .string()
          .min(2)
          .max(5)
          .describe("ISO 639-1 code, e.g. 'es', 'fr', 'ja'"),
      })
      .refine((d) => Boolean(d.file_id || d.text), {
        message: "Must provide either file_id or text.",
      }),
    handler: "ai-route",
    aiOp: "translate",
    risk: "review",
    estCredits: () => 5,
  },
  "ai-redact": {
    name: "ai-redact",
    description:
      "Auto-detect and black-out PII (names, emails, phones, IDs, addresses). ~2 credits per page.",
    params: fileIdSchema.extend({
      categories: z
        .array(z.enum(["name", "email", "phone", "address", "ssn", "custom"]))
        .optional(),
      custom_patterns: z.array(z.string()).optional(),
    }),
    handler: "ai-route",
    aiOp: "redact",
    risk: "review",
    estCredits: (_p, ctx) => 2 * (ctx.inputPageCount ?? 5),
  },
  "ai-table": {
    name: "ai-table",
    description:
      "Extract every table in a PDF as structured CSV/Excel. ~3 credits per table.",
    params: fileIdSchema,
    handler: "ai-route",
    aiOp: "table",
    risk: "review",
    estCredits: () => 6,
  },
  "ai-entities": {
    name: "ai-entities",
    description:
      "Extract People / Organisations / Places / Dates from a PDF as four tables with page citations. 3 credits per doc.",
    params: fileIdSchema,
    handler: "ai-route",
    aiOp: "summarize",
    risk: "review",
    estCredits: () => 3,
  },
  "ai-action-items": {
    name: "ai-action-items",
    description:
      "Extract actionable TODOs as a markdown table — Task / Owner / Due / Priority / Page. 3 credits per doc.",
    params: fileIdSchema,
    handler: "ai-route",
    aiOp: "summarize",
    risk: "review",
    estCredits: () => 3,
  },
  "ai-generate": {
    name: "ai-generate",
    description:
      "Generate a brand-new PDF from a prompt — pitch decks, contracts, reports, briefs. Optionally cite source files for grounding. ~20 credits per doc.",
    params: z.object({
      prompt: z.string().min(20).describe("What kind of PDF to generate."),
      source_file_ids: z
        .array(z.string())
        .optional()
        .describe("Optional source files to ground the output in."),
      output_name: z.string().optional(),
    }),
    handler: "ai-route",
    aiOp: "generate",
    risk: "dangerous",
    estCredits: () => 20,
  },
  "ai-rewrite": {
    name: "ai-rewrite",
    description:
      "Rewrite a PDF or pasted text in a target tone (formal/casual/clearer/shorter/academic). Provide EITHER file_id OR text. 3 credits per doc (text) or per page (file).",
    // H7.3: accept text input. Map the agent's friendly tone names
    // ("clearer", "shorter") onto the lib/ai/rewrite RewriteMode enum
    // ("simplify", "concise") inside dispatch-ai.ts.
    params: z
      .object({
        file_id: z.string().optional(),
        text: z.string().optional(),
        tone: z.enum([
          "formal",
          "casual",
          "clearer",
          "shorter",
          "academic",
        ]),
      })
      .refine((d) => Boolean(d.file_id || d.text), {
        message: "Must provide either file_id or text.",
      }),
    handler: "ai-route",
    aiOp: "rewrite",
    risk: "review",
    // Text-input runs are flat 3cr (no pages); file-input scales by
    // page count (still 3/page). The estimator picks the cheaper path
    // when text is present.
    estCredits: (params, ctx) => {
      const hasText = typeof (params as { text?: string }).text === "string";
      return hasText ? 3 : 3 * (ctx.inputPageCount ?? 5);
    },
  },
  "ai-compare": {
    name: "ai-compare",
    description:
      "Diff two PDFs and produce a redline with severity classification (cosmetic/material/critical). Use for contract version comparison. 15 credits per pair.",
    params: z.object({
      file_id_a: z.string(),
      file_id_b: z.string(),
    }),
    handler: "ai-route",
    aiOp: "compare",
    risk: "review",
    estCredits: () => 15,
  },
};

/**
 * Registered tool count — used by the planner to know its catalog size
 * without iterating, and by tests to detect accidental drops.
 */
export const AGENT_TOOL_COUNT = Object.keys(AGENT_TOOLS).length;

/**
 * Look up a tool definition by name. Returns null for unknown — the
 * executor uses this to detect hallucinated tool calls from the planner
 * and refuse the plan rather than crash.
 */
export function getAgentTool(name: ToolName): AgentToolDef | null {
  return AGENT_TOOLS[name] ?? null;
}

/**
 * All tool names — used by the planner to validate that the LLM only
 * picks tools that exist.
 */
export function listAgentToolNames(): ToolName[] {
  return Object.keys(AGENT_TOOLS);
}

/**
 * Convert the registry into the Anthropic `tools` API shape. Called once
 * per planner invocation. Cheap — the Zod schemas convert to JSON Schema
 * via zod-to-json-schema (or, for now, a manual best-effort conversion
 * since we want zero new deps in H1).
 */
/**
 * Anthropic's `Tool` interface requires `input_schema.type: "object"` and
 * `properties` keyed string→JSON-Schema. We satisfy that shape exactly.
 */
export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export function toAnthropicToolDefs(): AnthropicToolDef[] {
  return Object.values(AGENT_TOOLS).map((def) => ({
    // Anthropic tool names must match /^[a-zA-Z0-9_-]{1,64}$/. Our IDs
    // use hyphens + dots ("sys.ask.user") — convert dots to underscores.
    name: def.name.replace(/\./g, "_"),
    description: def.description,
    input_schema: zodToJsonSchemaShallow(def.params),
  }));
}

/**
 * Best-effort zod → JSON Schema conversion. Handles the shapes we actually
 * use in the registry (z.object with primitive / enum / array fields).
 * Pulling in zod-to-json-schema as a runtime dep would be cleaner but
 * adds 30KB; we can swap it in if the registry grows beyond what this
 * shallow converter handles.
 */
function zodToJsonSchemaShallow(
  schema: z.ZodTypeAny,
): AnthropicToolDef["input_schema"] {
  // Defensive: handle the wrapper case (z.object(...).extend(...) etc.)
  const def = (schema as unknown as { _def: { typeName: string; shape?: () => Record<string, z.ZodTypeAny> } })._def;
  if (def.typeName !== "ZodObject" || typeof def.shape !== "function") {
    return { type: "object", properties: {} };
  }
  const shape = def.shape();
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, val] of Object.entries(shape)) {
    properties[key] = zodFieldToJson(val);
    const innerDef = (val as unknown as { _def: { typeName: string } })._def;
    if (innerDef.typeName !== "ZodOptional" && innerDef.typeName !== "ZodDefault") {
      required.push(key);
    }
  }
  return required.length > 0
    ? { type: "object", properties, required }
    : { type: "object", properties };
}

function zodFieldToJson(field: z.ZodTypeAny): Record<string, unknown> {
  const def = (field as unknown as { _def: { typeName: string; description?: string; values?: string[]; type?: z.ZodTypeAny; innerType?: z.ZodTypeAny } })._def;
  const description = def.description;
  switch (def.typeName) {
    case "ZodString":
      return { type: "string", ...(description && { description }) };
    case "ZodNumber":
      return { type: "number", ...(description && { description }) };
    case "ZodBoolean":
      return { type: "boolean", ...(description && { description }) };
    case "ZodEnum":
      return { type: "string", enum: def.values, ...(description && { description }) };
    case "ZodArray":
      return {
        type: "array",
        items: def.type ? zodFieldToJson(def.type) : { type: "string" },
        ...(description && { description }),
      };
    case "ZodOptional":
    case "ZodDefault":
      return def.innerType ? zodFieldToJson(def.innerType) : { type: "string" };
    default:
      return { type: "string", ...(description && { description }) };
  }
}
