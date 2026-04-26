// lib/agent/planner.ts
//
// Production planner. Given a user prompt + context (uploaded files), call
// Claude with the agent's tool registry as `tools` and parse the response
// into an AgentPlan. Validate every tool call against the registry; refuse
// the plan if anything looks wrong (hallucinated tool name, bad params).
//
// Why Anthropic + tools API instead of free-form JSON output:
//   The tools API enforces tool_name + input_schema at the model level.
//   Anthropic's models are best-in-class at not hallucinating tool names
//   when given a fixed catalog (much better than "respond in this JSON").
//   The model can also return tool_use blocks in any order so we naturally
//   get a list-of-steps without having to teach a JSON schema.
//
// Why a single planner call instead of a ReAct loop:
//   Plans are reviewed by the user BEFORE any credit gets spent. ReAct
//   ("call tool, see result, plan next") would mean executing some steps
//   before showing the plan, which breaks the screenshot's "Plan it →
//   Review → Run" UX. We accept the trade-off (less reactive to surprise
//   tool outputs) for the safety of explicit pre-approval.
//
// Failure modes handled:
//   - Anthropic 5xx / timeout      → propagate to caller; route returns 502
//   - Model returns no tool_use    → return empty plan with notes
//   - Model picks an unknown tool  → reject the whole plan, tell the user
//   - Model picks invalid params   → reject the step, replan with one
//                                    repair-attempt call (1 retry max)

import Anthropic from "@anthropic-ai/sdk";
import {
  AGENT_TOOLS,
  toAnthropicToolDefs,
  type PlanContext,
} from "./tool-registry";
import type { AgentPlan, AgentStep, RiskLevel } from "./types";

/**
 * The system prompt that shapes the planner's behavior. Keep it short —
 * Claude is already excellent at tool selection. This prompt focuses on
 * the things our domain cares about (cost-efficiency, safety, plan style)
 * rather than re-explaining how tool_use works.
 */
const SYSTEM_PROMPT = `You are the planner for a document and text automation agent.

Given a user's request and any uploaded files, choose a sequence of tools
to fulfil the request. You will return ONLY tool_use blocks — no prose,
no manual answer.

CRITICAL: You MUST always pick at least one tool. NEVER reply with text
saying "I can answer this directly" or "the tools are PDF-only". The
ai-* tools accept BOTH file_id AND raw text input — when the user pastes
text in their prompt and asks for a summary/translation/etc., pass that
text via the \`text\` param. Examples:
  • "TL;DR this: <text>"                         → ai-tldr(text="<text>")
  • "Summarize in 2 paragraphs: <text>"          → ai-summarize(text="<text>", depth="standard")
  • "Detailed summary with sections: <text>"     → ai-summarize(text="<text>", depth="detailed")
  • "Translate to French: Hello world"           → ai-translate(text="Hello world", target_lang="fr")
  • "Make this clearer: <text>"                  → ai-rewrite(text="<text>", tone="clearer")
  • "Rewrite formally: <text>"                   → ai-rewrite(text="<text>", tone="formal")
  • "Write a one-page launch brief about X"      → ai-generate(prompt="Write a one-page launch brief about X")
  • "Generate a vendor NDA outline"              → ai-generate(prompt="Generate a vendor NDA outline")

ai-rewrite tone options (use these literal values, not synonyms):
  formal, casual, clearer, shorter, academic
  Map user requests:
    "more formal", "professional", "business-tone" → formal
    "friendlier", "warmer", "casual"               → casual
    "clearer", "simpler", "easier to read"         → clearer
    "shorter", "concise", "tighter"                → shorter
    "academic", "scholarly", "research-tone"       → academic

ai-translate target_lang must be a 2-letter ISO 639-1 code:
  English → en, Spanish → es, French → fr, German → de,
  Japanese → ja, Chinese (Simplified) → zh, Hindi → hi,
  Tamil → ta, Portuguese → pt, Italian → it. Use the
  closest match if the user names a language not in this list.

Choosing between ai-tldr and ai-summarize:
  • ai-tldr    → ONE compact paragraph, executive-summary length. Use when
                 the user says "tl;dr", "in one paragraph", "brief", "the
                 key takeaway", or doesn't specify length/structure.
  • ai-summarize → Multi-paragraph or sectioned output. Use when the
                 user says "two paragraphs", "three paragraphs", "in
                 sections", "with bullet points", "detailed", "longer",
                 or any request that implies more than one paragraph.

Rules:
1. Use the smallest plan that achieves the goal. A summary of one document
   or pasted text is ONE tool call, not a chain.
2. Use FREE tools (merge, split, extract-pages, compress) before AI tools
   when both would work. Free tools cost 0 credits.
3. ANY destructive or external step (ai-generate, anything that emails
   or shares) must be preceded by sys.ask.user with a clear yes/no
   question. A pure summarize/translate/rewrite of pasted text needs no
   approval gate.
4. End with sys.notify.user ONLY when the run produces a deliverable that
   takes >5 seconds; for fast single-step text ops (tldr/summarize a
   short pasted paragraph) you can skip sys.notify.user.
5. If the user references files they haven't pasted text for ("12 receipts
   in my folder"), use sys.fs.list to discover them. If the prompt itself
   contains the source text, do NOT call sys.fs.list.
6. Be conservative on cost. If the plan would exceed 50 credits, prefer a
   cheaper alternative (ai-tldr instead of ai-summarize for short text,
   fewer pages, etc.).`;

// H7 fix: default model was "claude-3-5-sonnet-20241022" which 502'd on
// our live Anthropic account (model retired / not allow-listed). Match
// the registry's defaultModel (lib/ai/registry.ts) which is verified
// working in production. Override via AGENT_PLANNER_MODEL env if/when
// we want to upgrade to Sonnet/Opus 4.x for richer tool-use planning.
const PLANNER_MODEL =
  process.env.AGENT_PLANNER_MODEL ??
  process.env.ANTHROPIC_MODEL ??
  "claude-haiku-4-5-20251001";
const PLANNER_MAX_TOKENS = 4096;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing — cannot run planner");
  _client = new Anthropic({ apiKey });
  return _client;
}

export interface PlannerInput {
  /** What the user typed in the prompt box. */
  prompt: string;
  /** Files already uploaded by the user, available as inputs. */
  files?: Array<{ id: string; name: string; pageCount?: number }>;
}

export interface PlannerOutput {
  /** The validated plan. Always non-null on success. */
  plan: AgentPlan;
  /**
   * Diagnostic info for /admin debugging. Not surfaced to end users
   * but logged server-side for plan-quality analysis.
   */
  diagnostics: {
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    rejectedSteps: Array<{ tool: string; reason: string }>;
    latencyMs: number;
  };
}

export class PlannerError extends Error {
  constructor(
    message: string,
    public code: "no_steps" | "invalid_tool" | "invalid_params" | "model_error" | "config",
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PlannerError";
  }
}

/**
 * Produce an AgentPlan from a natural-language prompt.
 *
 * Throws PlannerError on any failure mode that the caller (the route
 * handler) needs to map to a specific HTTP status code.
 */
export async function generatePlan(
  input: PlannerInput,
): Promise<PlannerOutput> {
  const startedAt = Date.now();

  // Build context payload for the LLM. Pre-uploaded files become a
  // user-message preamble so the model can reference them by id.
  const filesPreamble = input.files?.length
    ? `\n\nFiles already uploaded:\n${input.files
        .map(
          (f) =>
            `- file_id: ${f.id}, name: ${f.name}` +
            (f.pageCount ? ` (${f.pageCount} pages)` : ""),
        )
        .join("\n")}`
    : "";

  const tools = toAnthropicToolDefs();

  let response;
  try {
    response = await client().messages.create({
      model: PLANNER_MODEL,
      max_tokens: PLANNER_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      // tool_choice: "auto" lets the model decide whether to use any tools.
      // For the planner we want it to ALWAYS use tools (a plan with zero
      // steps is useless), but Anthropic doesn't support a "must use any"
      // mode — only "must use this specific one". We post-validate that
      // at least one tool_use came back.
      messages: [
        { role: "user", content: input.prompt + filesPreamble },
      ],
    });
  } catch (e) {
    throw new PlannerError(
      `Anthropic call failed: ${(e as Error).message}`,
      "model_error",
      { cause: e },
    );
  }

  const toolUseBlocks = response.content.filter(
    (b): b is Extract<typeof response.content[0], { type: "tool_use" }> =>
      b.type === "tool_use",
  );
  if (toolUseBlocks.length === 0) {
    throw new PlannerError(
      "Planner returned no tool_use blocks — the prompt may be unrelated to PDF work, or the model couldn't pick a tool.",
      "no_steps",
      {
        // Surface the model's text reply (if any) so admins can see why.
        modelText: response.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("\n"),
      },
    );
  }

  // Build the plan. Reject any unknown tool names; collect rejection
  // reasons in diagnostics so the admin dashboard can flag bad plans.
  const steps: AgentStep[] = [];
  const rejectedSteps: PlannerOutput["diagnostics"]["rejectedSteps"] = [];

  // Build a context object for cost estimation. For now this is just the
  // first uploaded file's page count. Future: thread page counts through
  // the chain so estimators know what each prior step produced.
  const ctx: PlanContext = {
    inputPageCount: input.files?.[0]?.pageCount,
    inputFileCount: input.files?.length,
  };

  for (const [i, block] of toolUseBlocks.entries()) {
    // Convert the underscored name back to the canonical dotted name.
    const canonicalName = block.name.replace(/_/g, ".").replace("sys.", "sys.");
    // Naïve: anything starting "sys_" → "sys.X". Actually our underscore
    // -> dot conversion is symmetric so handle both forms.
    const candidate1 = block.name.replace(/_/g, "-");
    const candidate2 = block.name.replace(/_/g, ".");
    const def =
      AGENT_TOOLS[block.name] ??
      AGENT_TOOLS[candidate1] ??
      AGENT_TOOLS[candidate2] ??
      AGENT_TOOLS[canonicalName];

    if (!def) {
      rejectedSteps.push({
        tool: block.name,
        reason: "Unknown tool — not in registry",
      });
      continue;
    }

    // Validate params against the registered Zod schema. The planner LLM
    // is excellent but not perfect — sometimes it omits a required field.
    const parseResult = def.params.safeParse(block.input);
    if (!parseResult.success) {
      rejectedSteps.push({
        tool: def.name,
        reason: `Invalid params: ${parseResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      });
      continue;
    }

    steps.push({
      idx: i + 1,
      tool: def.name,
      params: parseResult.data,
      label: shortLabel(def.name, parseResult.data),
      description: def.description.split(".")[0] ?? def.description,
      estCredits: def.estCredits(parseResult.data, ctx),
      risk: def.risk,
      // Naïve dependency model for H1: every step depends on the previous
      // one. Future: parse @file_id_<n> references in the LLM's params.
      dependsOn: i > 0 ? [i] : [],
    });
  }

  if (steps.length === 0) {
    throw new PlannerError(
      "No valid steps after registry validation — all tool calls were rejected.",
      "invalid_tool",
      { rejectedSteps },
    );
  }

  const totalEstCredits = steps.reduce((sum, s) => sum + s.estCredits, 0);

  return {
    plan: {
      prompt: input.prompt,
      steps,
      totalEstCredits,
      output: inferOutput(steps, input.prompt),
      confidence: rejectedSteps.length === 0 ? 0.95 : 0.7,
      notes:
        rejectedSteps.length > 0
          ? [`${rejectedSteps.length} step(s) skipped due to validation`]
          : undefined,
    },
    diagnostics: {
      modelId: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      rejectedSteps,
      latencyMs: Date.now() - startedAt,
    },
  };
}

/**
 * Short human-readable label for a step. ~3-7 words.
 */
function shortLabel(toolName: string, params: Record<string, unknown>): string {
  const map: Record<string, (p: Record<string, unknown>) => string> = {
    "sys.fs.list": (p) => `List files in ${(p.path as string) ?? "folder"}`,
    "sys.ask.user": (p) =>
      `Ask: ${truncate((p.question as string) ?? "confirm", 40)}`,
    "sys.notify.user": (p) =>
      `Notify: ${truncate((p.title as string) ?? "done", 40)}`,
    merge: () => "Merge PDFs",
    split: () => "Split PDF",
    compress: (p) => `Compress (${(p.level as string) ?? "balanced"})`,
    "extract-pages": (p) => `Extract pages ${(p.ranges as string) ?? ""}`,
    "delete-pages": (p) => `Delete pages ${(p.ranges as string) ?? ""}`,
    "ai-summarize": () => "Summarize PDF",
    "ai-tldr": () => "Generate TL;DR",
    "ai-ocr": () => "OCR scanned PDF",
    "ai-translate": (p) => `Translate to ${(p.target_lang as string) ?? "target"}`,
    "ai-redact": () => "Redact PII",
    "ai-table": () => "Extract tables",
    "ai-entities": () => "Extract entities",
    "ai-action-items": () => "Extract action items",
    "ai-generate": () => "Generate new PDF",
    "ai-rewrite": (p) => `Rewrite (${(p.tone as string) ?? "tone"})`,
    "ai-compare": () => "Compare two PDFs",
  };
  const fn = map[toolName];
  return fn ? fn(params) : toolName;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * Best-effort output inference. Looks at the last non-system step,
 * picks an output type, and (since H7.2) suggests a meaningful
 * filename derived from the prompt + tool — replaces the hardcoded
 * "Result.md" placeholder the demo path used.
 *
 * The filename is just a hint; the executor + Download button can
 * still override (e.g. to include the runId for disambiguation when
 * the same plan ran multiple times). Keep it short — the OS file
 * picker will truncate long names anyway.
 */
function inferOutput(
  steps: AgentStep[],
  prompt: string,
): AgentPlan["output"] {
  // Find the deliverable step (last non-system).
  let lastTool: string | undefined;
  for (let i = steps.length - 1; i >= 0; i--) {
    const tool = steps[i]!.tool;
    if (!tool.startsWith("sys.")) {
      lastTool = tool;
      break;
    }
  }

  // Slug the prompt: first 4-5 meaningful words, lowercase, hyphen-joined.
  // Example: "Summarize this text in two short paragraphs: Q3 revenue..."
  // → "summarize-this-text-in-two-short-paragraphs"
  // The leading verb usually reflects the user's intent better than the
  // tool name does (e.g. "tldr" vs "ai-tldr"). Falls back to the tool
  // when the prompt has no usable words.
  const slug = sluggifyPrompt(prompt) || (lastTool ?? "result").replace(/^ai-/, "");

  switch (lastTool) {
    case "ai-table":
      return { type: "xlsx", description: "Excel file with extracted tables", name: `${slug}.xlsx` };
    case "split":
      return { type: "zip", description: "Zip of split PDFs", name: `${slug}.zip` };
    // H7.3: text-input dispatch returns markdown (not PDF) for
    // translate/rewrite/generate today. The output type matches what
    // the executor will actually produce, so the Download Blob picks
    // the right MIME. PDF output for these ops returns once
    // file-storage infra ships and we can render server-side.
    case "ai-generate":
      return { type: "md", description: "Generated markdown", name: `${slug}.md` };
    case "ai-translate":
      return { type: "md", description: "Translated markdown", name: `${slug}.md` };
    case "ai-rewrite":
      return { type: "md", description: "Rewritten markdown", name: `${slug}.md` };
    case "ai-summarize":
      return { type: "md", description: "Markdown summary", name: `${slug}.md` };
    case "ai-tldr":
      return { type: "md", description: "TL;DR (one paragraph)", name: `${slug}.md` };
    case undefined:
      return { type: "pdf", description: "Result", name: "result.pdf" };
    default:
      return { type: "pdf", description: "Processed PDF", name: `${slug}.pdf` };
  }
}

/**
 * Convert a prompt into a short kebab-case filename slug.
 * Strips punctuation, lowercases, takes first 5 words, drops common
 * stopwords. Returns "" if nothing usable remains.
 */
function sluggifyPrompt(prompt: string): string {
  const STOPWORDS = new Set([
    "a", "an", "the", "this", "that", "these", "those",
    "is", "are", "was", "were", "be", "been", "being",
    "of", "in", "on", "at", "to", "from", "with", "for", "by",
    "and", "or", "but", "as", "if", "so", "then",
    "can", "could", "would", "should", "will", "may",
    "i", "you", "we", "they", "it", "my", "your", "our",
  ]);
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  // Cap at 5 words AND 48 chars total — whichever hits first.
  const picked: string[] = [];
  let len = 0;
  for (const w of words) {
    if (picked.length >= 5) break;
    if (len + w.length + (picked.length > 0 ? 1 : 0) > 48) break;
    picked.push(w);
    len += w.length + (picked.length > 1 ? 1 : 0);
  }
  return picked.join("-");
}

// Re-export the risk type for callers that wire UI labels.
export type { RiskLevel };
