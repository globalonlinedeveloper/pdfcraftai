// Phase 6.3 — Unified client-side tool executor.
//
// The runner (Phase 6.3 #126) walks the plan; for each step it:
//   1. Resolves the step's `inputRef` into a concrete value (a File, a
//      markdown string, or a File-pair).
//   2. Calls `executeAgentStep()` with the toolId, params, and that value.
//   3. Records the output into the run's per-step output map so later
//      steps can reference it.
//   4. Reports the step outcome via a server action (credit debit,
//      status flip, output id persistence).
//
// This file handles step 2 only. It's the one place that knows how each
// tool is invoked — AI tools hit `/api/ai/<tool>`, free tools call pdf-lib
// in the browser. Keeping that knowledge here means the runner loop is
// small and uniform, and swapping a client pdf-lib op for a server call
// (or vice versa) is a narrow diff.
//
// IMPORTANT: this module runs in the BROWSER (it imports pdf-lib, uses
// fetch). It must NOT import anything from `server-only` modules —
// `lib/agent/types.ts`, `lib/agent/catalog.ts` are both safe (pure types /
// data). `lib/agent/planner.ts` is NOT safe (server-only) — don't import it.
//
// Error model: returns a discriminated-union `ExecutorResult`. The runner
// distinguishes success from the various failure codes and decides whether
// to pause (for credit issues) or fail (for provider/validation errors).

"use client";

import { PDFDocument, degrees } from "pdf-lib";
import { z } from "zod";

import {
  deriveOutputName,
  parsePageRanges,
  PDF_MIME,
} from "@/lib/client/pdf-utils";

import type { AgentErrorCode, AgentToolId } from "./types";

// --- public types -----------------------------------------------------

/**
 * Resolved input for a single step. The runner produces one of these from
 * the step's `inputRef` before calling the executor.
 *
 *   none       — chat / sub-call tools
 *   pdf        — any per-file or queue-level PDF tool
 *   pdf-list   — merge (all files in the queue, in order)
 *   pdf-pair   — ai-compare (two files)
 *   markdown   — feeds a markdown-input tool (not wired in v1)
 */
export type ExecutorInput =
  | { kind: "none" }
  | { kind: "pdf"; file: File }
  | { kind: "pdf-list"; files: File[] }
  | { kind: "pdf-pair"; a: File; b: File }
  | { kind: "markdown"; text: string };

/**
 * What a successful step produced. Lines up with `AgentToolOutputKind` in
 * types.ts, plus the metadata the runner needs to persist the step row.
 */
export type ExecutorOutput =
  | {
      kind: "pdf";
      file: File;
      pageCount: number;
      sizeBytes: number;
      /**
       * Optional server-stored fileId. Populated when the output came from
       * an API route that persisted it (AI tools). For client-only pdf-lib
       * outputs it's undefined — the runner's wrap-up persists those.
       */
      fileId?: string;
    }
  | {
      kind: "pdf-multi";
      files: Array<{ file: File; pageCount: number; sizeBytes: number }>;
    }
  | {
      kind: "markdown";
      text: string;
      /** DB file row for the saved `.md` output. Set by the AI route. */
      fileId: string;
      /** AI-outputs row id, if the route returned one. */
      aiOutputId?: number;
      filename: string;
      creditCost: number;
      /** Whether the server route replayed a prior identical request. */
      replay?: boolean;
    }
  | {
      kind: "text";
      text: string;
      creditCost: number;
    };

/**
 * Step outcome. On failure, `code` maps to `AgentErrorCode` so the runner
 * can decide whether to pause, refund, or fail outright.
 */
export type ExecutorResult =
  | { ok: true; output: ExecutorOutput }
  | {
      ok: false;
      code: Extract<
        AgentErrorCode,
        | "provider_error"
        | "insufficient_credits"
        | "validation_error"
        | "tool_unavailable"
        | "file_deleted_mid_run"
      >;
      message: string;
      /** HTTP status if the failure came from an API route. */
      httpStatus?: number;
      /**
       * For insufficient_credits we surface what the route told us so the
       * runner can show "needed X, had Y" in the pause banner.
       */
      required?: number;
      balance?: number;
    };

export interface ExecuteAgentStepArgs {
  toolId: AgentToolId;
  params: Record<string, unknown>;
  input: ExecutorInput;
  /** Stable per-step UUID. Reused on retries to trigger the Phase 5.5 replay. */
  idempotencyKey: string;
  /**
   * Source filename the step is operating on, used for naming pdf-lib
   * outputs. For merge/compare it's the first file; for per-file tools
   * it's the queue file being processed this iteration.
   */
  sourceFilename?: string;
}

// --- top-level dispatcher --------------------------------------------

export async function executeAgentStep(
  args: ExecuteAgentStepArgs
): Promise<ExecutorResult> {
  try {
    switch (args.toolId) {
      case "ai-summarize":
        return await runSummarize(args);
      case "ai-translate":
        return await runTranslate(args);
      case "ai-compare":
        return await runCompare(args);
      case "ai-ocr":
        return await runOcr(args);
      case "merge":
        return await runMerge(args);
      case "split":
        return await runSplit(args);
      case "rotate":
        return await runRotate(args);
      case "compress":
        return await runCompress(args);
      case "chat":
        // Not wired in v1. The planner is told to prefer concrete tools;
        // if it still emits a chat step we fail loud rather than silently
        // skipping and breaking downstream references.
        return {
          ok: false,
          code: "tool_unavailable",
          message:
            "The chat sub-tool is not wired in the agent v1. Ask the agent to use concrete tools.",
        };
      default: {
        // Exhaustiveness check — if AgentToolId grows and this switch
        // doesn't, TS will flag this line.
        const _never: never = args.toolId;
        return {
          ok: false,
          code: "tool_unavailable",
          message: `Unknown toolId: ${String(_never)}`,
        };
      }
    }
  } catch (err) {
    // Catches bugs in this module (bad casts, pdf-lib failures, etc.).
    // A real provider error never lands here — routes return 4xx/5xx JSON
    // which the per-tool handlers catch and shape into ExecutorResult.
    return {
      ok: false,
      code: "provider_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// --- AI tool dispatchers ---------------------------------------------

async function runSummarize(args: ExecuteAgentStepArgs): Promise<ExecutorResult> {
  if (args.input.kind !== "pdf") {
    return badInput("ai-summarize", "pdf", args.input.kind);
  }

  const depthSchema = z.object({
    depth: z.enum(["tldr", "standard", "detailed"]).default("standard"),
  });
  const parsed = depthSchema.safeParse(args.params);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: `ai-summarize params invalid: ${parsed.error.message}`,
    };
  }

  const form = new FormData();
  form.set("pdf", args.input.file);
  form.set("depth", parsed.data.depth);
  form.set("idempotencyKey", args.idempotencyKey);

  const res = await fetch("/api/ai/summarize", { method: "POST", body: form });
  const json = (await safeJson(res)) as Record<string, unknown>;
  if (!res.ok) return mapApiError(res.status, json, "ai-summarize");

  const out = expectMarkdownResponse(json);
  if (!out.ok) return out;
  return { ok: true, output: out.output };
}

async function runTranslate(args: ExecuteAgentStepArgs): Promise<ExecutorResult> {
  if (args.input.kind !== "pdf") {
    return badInput("ai-translate", "pdf", args.input.kind);
  }

  const paramsSchema = z.object({
    // Permissive — planner is told to use ISO codes but we don't enforce a
    // closed enum here because the catalog of supported languages lives in
    // `lib/ai/translate-langs.ts` and can grow independently.
    targetLang: z.string().trim().min(2).max(16),
  });
  const parsed = paramsSchema.safeParse(args.params);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: `ai-translate params invalid: ${parsed.error.message}`,
    };
  }

  const form = new FormData();
  form.set("pdf", args.input.file);
  form.set("targetLang", parsed.data.targetLang);
  form.set("idempotencyKey", args.idempotencyKey);

  const res = await fetch("/api/ai/translate", { method: "POST", body: form });
  const json = (await safeJson(res)) as Record<string, unknown>;
  if (!res.ok) return mapApiError(res.status, json, "ai-translate");

  const out = expectMarkdownResponse(json);
  if (!out.ok) return out;
  return { ok: true, output: out.output };
}

async function runCompare(args: ExecuteAgentStepArgs): Promise<ExecutorResult> {
  if (args.input.kind !== "pdf-pair") {
    return badInput("ai-compare", "pdf-pair", args.input.kind);
  }

  const form = new FormData();
  form.set("pdfA", args.input.a);
  form.set("pdfB", args.input.b);
  form.set("idempotencyKey", args.idempotencyKey);

  const res = await fetch("/api/ai/compare", { method: "POST", body: form });
  const json = (await safeJson(res)) as Record<string, unknown>;
  if (!res.ok) return mapApiError(res.status, json, "ai-compare");

  const out = expectMarkdownResponse(json);
  if (!out.ok) return out;
  return { ok: true, output: out.output };
}

async function runOcr(args: ExecuteAgentStepArgs): Promise<ExecutorResult> {
  if (args.input.kind !== "pdf") {
    return badInput("ai-ocr", "pdf", args.input.kind);
  }

  // OCR takes no params in v1 — the route uses a fixed prompt.
  const form = new FormData();
  form.set("pdf", args.input.file);
  form.set("idempotencyKey", args.idempotencyKey);

  const res = await fetch("/api/ai/ocr", { method: "POST", body: form });
  const json = (await safeJson(res)) as Record<string, unknown>;
  if (!res.ok) return mapApiError(res.status, json, "ai-ocr");

  const out = expectMarkdownResponse(json);
  if (!out.ok) return out;
  return { ok: true, output: out.output };
}

// --- client PDF tool dispatchers -------------------------------------

async function runMerge(args: ExecuteAgentStepArgs): Promise<ExecutorResult> {
  if (args.input.kind !== "pdf-list") {
    return badInput("merge", "pdf-list", args.input.kind);
  }
  if (args.input.files.length < 2) {
    return {
      ok: false,
      code: "validation_error",
      message: "merge requires at least 2 files",
    };
  }

  const out = await PDFDocument.create();
  for (const file of args.input.files) {
    const src = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
    });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  const bytes = await out.save({ useObjectStreams: true });
  const name = deriveMergedName(args.input.files.map((f) => f.name));
  const file = new File([bytesToArrayBuffer(bytes)], name, { type: PDF_MIME });

  return {
    ok: true,
    output: {
      kind: "pdf",
      file,
      pageCount: out.getPageCount(),
      sizeBytes: bytes.length,
    },
  };
}

async function runSplit(args: ExecuteAgentStepArgs): Promise<ExecutorResult> {
  if (args.input.kind !== "pdf") {
    return badInput("split", "pdf", args.input.kind);
  }

  const paramsSchema = z.object({
    ranges: z.string().trim().min(1).max(200),
  });
  const parsed = paramsSchema.safeParse(args.params);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: `split params invalid: ${parsed.error.message}`,
    };
  }

  const src = await PDFDocument.load(await args.input.file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const totalPages = src.getPageCount();

  let ranges: number[][];
  try {
    ranges = parsePageRanges(parsed.data.ranges, totalPages);
  } catch (err) {
    return {
      ok: false,
      code: "validation_error",
      message: err instanceof Error ? err.message : "invalid ranges",
    };
  }

  const sourceName = args.sourceFilename ?? args.input.file.name;
  const parts: Array<{ file: File; pageCount: number; sizeBytes: number }> = [];

  for (const [idx, range] of ranges.entries()) {
    const dest = await PDFDocument.create();
    const zeroBased = range.map((p) => p - 1);
    const copied = await dest.copyPages(src, zeroBased);
    for (const p of copied) dest.addPage(p);
    const bytes = await dest.save({ useObjectStreams: true });
    const suffix = rangeSuffix(range);
    const name = deriveOutputName(sourceName, `-part${idx + 1}${suffix}`);
    const file = new File([bytesToArrayBuffer(bytes)], name, { type: PDF_MIME });
    parts.push({
      file,
      pageCount: dest.getPageCount(),
      sizeBytes: bytes.length,
    });
  }

  return { ok: true, output: { kind: "pdf-multi", files: parts } };
}

async function runRotate(args: ExecuteAgentStepArgs): Promise<ExecutorResult> {
  if (args.input.kind !== "pdf") {
    return badInput("rotate", "pdf", args.input.kind);
  }

  const paramsSchema = z.object({
    rotation: z.union([z.literal(90), z.literal(180), z.literal(270)]),
  });
  const parsed = paramsSchema.safeParse(args.params);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation_error",
      message: `rotate params invalid: ${parsed.error.message}`,
    };
  }

  const doc = await PDFDocument.load(await args.input.file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  for (const page of doc.getPages()) {
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + parsed.data.rotation) % 360));
  }
  const bytes = await doc.save({ useObjectStreams: true });
  const sourceName = args.sourceFilename ?? args.input.file.name;
  const name = deriveOutputName(sourceName, `-rotated${parsed.data.rotation}`);
  const file = new File([bytesToArrayBuffer(bytes)], name, { type: PDF_MIME });

  return {
    ok: true,
    output: {
      kind: "pdf",
      file,
      pageCount: doc.getPageCount(),
      sizeBytes: bytes.length,
    },
  };
}

async function runCompress(args: ExecuteAgentStepArgs): Promise<ExecutorResult> {
  if (args.input.kind !== "pdf") {
    return badInput("compress", "pdf", args.input.kind);
  }

  const doc = await PDFDocument.load(await args.input.file.arrayBuffer(), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  // Match CompressPdfTool's default: strip common metadata fields so the
  // save produces the smallest output possible.
  try {
    doc.setTitle("");
    doc.setAuthor("");
    doc.setSubject("");
    doc.setKeywords([]);
    doc.setProducer("");
    doc.setCreator("");
  } catch {
    // Non-fatal — some PDFs have locked metadata trees.
  }
  const bytes = await doc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 50,
  });
  const sourceName = args.sourceFilename ?? args.input.file.name;
  const name = deriveOutputName(sourceName, "-compressed");
  const file = new File([bytesToArrayBuffer(bytes)], name, { type: PDF_MIME });

  return {
    ok: true,
    output: {
      kind: "pdf",
      file,
      pageCount: doc.getPageCount(),
      sizeBytes: bytes.length,
    },
  };
}

// --- helpers ---------------------------------------------------------

function badInput(
  toolId: string,
  expected: string,
  actual: string
): ExecutorResult {
  return {
    ok: false,
    code: "validation_error",
    message: `${toolId} expected input kind="${expected}", got "${actual}"`,
  };
}

/**
 * Map an API error response to an ExecutorResult. The routes use a
 * consistent `{ error: string, ...fields }` JSON shape, so this reads the
 * `error` key and picks the right AgentErrorCode.
 *
 * Known 4xx errors:
 *   402 insufficient_credits     → code=insufficient_credits, surfaces required/balance
 *   400 bad_request / pdf_extract_failed / no_extractable_text → validation_error
 *   409 duplicate_submission     → provider_error (with retry copy)
 *   413 pdf_too_large            → validation_error
 *
 * 5xx:
 *   503 no_ai_provider_configured → tool_unavailable
 *   5xx otherwise                → provider_error
 */
function mapApiError(
  status: number,
  body: Record<string, unknown>,
  toolId: string
): ExecutorResult {
  const errorKey = typeof body.error === "string" ? body.error : "unknown";
  const detail = typeof body.detail === "string" ? body.detail : "";

  if (status === 402 || errorKey === "insufficient_credits") {
    return {
      ok: false,
      code: "insufficient_credits",
      message: detail || `${toolId}: insufficient credits`,
      httpStatus: status,
      required: typeof body.required === "number" ? body.required : undefined,
      balance: typeof body.balance === "number" ? body.balance : undefined,
    };
  }
  if (status === 503 || errorKey === "no_ai_provider_configured") {
    return {
      ok: false,
      code: "tool_unavailable",
      message: "No AI provider is configured on the server.",
      httpStatus: status,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      ok: false,
      code: "validation_error",
      message: detail || `${toolId}: ${errorKey}`,
      httpStatus: status,
    };
  }
  return {
    ok: false,
    code: "provider_error",
    message: detail || `${toolId}: ${errorKey}`,
    httpStatus: status,
  };
}

/**
 * The three AI routes (summarize / translate / compare / ocr) all return
 * the same shape on success: { fileId, filename, markdown, creditCost,
 * replay?: boolean, ...usage }. This validates the response has the
 * fields the executor needs.
 */
function expectMarkdownResponse(
  body: Record<string, unknown>
):
  | { ok: true; output: Extract<ExecutorOutput, { kind: "markdown" }> }
  | ExecutorResult {
  const fileId = body.fileId;
  const filename = body.filename;
  const markdown = body.markdown;
  const creditCostRaw = body.creditCost;

  if (typeof fileId !== "string" || typeof markdown !== "string") {
    return {
      ok: false,
      code: "provider_error",
      message:
        "AI route response missing fileId or markdown. The backend may have changed.",
    };
  }

  const creditCost =
    typeof creditCostRaw === "number" && Number.isFinite(creditCostRaw)
      ? creditCostRaw
      : 0;

  return {
    ok: true,
    output: {
      kind: "markdown",
      text: markdown,
      fileId,
      aiOutputId:
        typeof body.aiOutputId === "number" ? body.aiOutputId : undefined,
      filename: typeof filename === "string" ? filename : "output.md",
      creditCost,
      replay: body.replay === true ? true : undefined,
    },
  };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * Turn a pdf-lib Uint8Array into a clean ArrayBuffer for new File() — the
 * constructor is picky about SharedArrayBuffer views and a fresh copy
 * avoids subtle issues with detached buffers.
 */
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function deriveMergedName(names: string[]): string {
  if (names.length === 0) return "merged.pdf";
  const first = names[0]!.replace(/\.pdf$/i, "");
  return `${first}-merged-${names.length}.pdf`;
}

function rangeSuffix(range: number[]): string {
  if (range.length === 0) return "";
  const start = range[0]!;
  const end = range[range.length - 1]!;
  return start === end ? `-p${start}` : `-p${start}-${end}`;
}
