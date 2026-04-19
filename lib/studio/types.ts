// Phase 6.2 — Studio (batch runner) shared types.
//
// Studio is a client-driven batch orchestrator: one page, one user-picked
// tool, many files. Each file is fanned out serially to the existing
// /api/ai/<tool> endpoint. There is no batch_runs table — the client
// owns the queue in component state and each per-file idempotencyKey
// inherits Phase 5.5's replay-on-dup behaviour (retrying a failed
// network blip hits the same output row instead of double-charging).
//
// Why these types live in /lib/studio/ and not inside StudioRunner:
//   - The cost estimator (./costs.ts) consumes BatchItem to produce the
//     pre-flight "needs N credits" warning.
//   - Future additions (exports, reporting, analytics) can import the
//     same shapes without pulling React.
//   - Keeps the client component lean and testable in isolation.

/**
 * AI tools supported by Studio. Compare is intentionally excluded for
 * MVP because it is pair-based (two inputs per run), which would require
 * a second dropzone + different UX from the one-file-per-row model.
 *
 * Extending this union is deliberately cheap: add the tool id here and
 * the cost estimator + runner will surface a type error wherever the
 * new case isn't handled, forcing a conscious decision at each site.
 */
export type StudioToolId = "ai-summarize" | "ai-translate" | "ai-ocr";

/**
 * Lifecycle of a single file in the queue.
 *
 *   pending    — enqueued, waiting its turn (serial runner)
 *   running    — the active fetch is in-flight
 *   succeeded  — 2xx, fileId + markdown captured
 *   failed     — non-2xx or thrown; `error` carries a user-readable hint
 *   cancelled  — user clicked Cancel before this item started running
 *
 * `cancelled` is a separate terminal state (rather than a subtype of
 * failed) so the UI can show a neutral "–" vs. a red error marker, and
 * so the retry-failed button can scope to actual failures and skip
 * user-initiated cancellations.
 */
export type BatchItemStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * One row in the Studio queue. Everything needed to render the table
 * and drive the serial runner lives here — no parallel data structures
 * keyed by id.
 *
 * Notes on specific fields:
 *   - `id`            — client-side UUID; NOT the server's fileId. Used
 *                       only to key React rows and target retries.
 *   - `idempotencyKey`— stable across retries of the SAME item so Phase
 *                       5.5 replay-on-dup kicks in (no double spend on
 *                       a retried network blip).
 *   - `pageCount`     — only set for OCR pre-flights where we parsed
 *                       the PDF client-side. Summarize + Translate skip
 *                       this because their cost is flat per file.
 *   - `creditsSpent`  — populated from the route response. Stored so we
 *                       can show the actual spend (vs. the estimate) in
 *                       the status table's "credits" column.
 *   - `fileId`/`markdown` — surfaced on success so the table row can
 *                       deep-link to /app/files/[id]/preview and the
 *                       user never has to leave Studio to verify output.
 */
export type BatchItem = {
  id: string;
  file: File;
  idempotencyKey: string;
  status: BatchItemStatus;
  /** OCR only — page count from client-side pdf-lib parse. */
  pageCount?: number;
  /** Server-reported spend, filled in on success. */
  creditsSpent?: number;
  /** User-readable failure reason, filled in on failure. */
  error?: string;
  /** `files.id` on success — enables the "View output" row link. */
  fileId?: string;
  /** Raw markdown output on success — used by the export-all action. */
  markdown?: string;
};

/**
 * Shape of a successful per-tool API response, narrowed so the runner's
 * success branch is type-safe. Each existing /api/ai/<tool> route
 * returns at least { ok: true, fileId, creditsSpent, markdown } — the
 * fields vary in extra detail but this minimal surface is enough for
 * Studio to render a row and offer a deep link.
 */
export type StudioSuccessPayload = {
  ok: true;
  fileId: string;
  creditsSpent: number;
  markdown: string;
};

/**
 * Per-tool parameter envelope passed from the picker + MacroBar down
 * into the runner. Mirrors the single-file tool forms so a macro saved
 * in SummarizePdfTool applies identically here.
 */
export type StudioToolParams =
  | { toolId: "ai-summarize"; depth: "tldr" | "standard" | "detailed" }
  | { toolId: "ai-translate"; targetLang: string }
  | { toolId: "ai-ocr" };
