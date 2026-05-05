// /api/tools/compress — server-side PDF compression via Ghostscript.
//
// PENDING_WORK_ANALYSIS.md §5a foundation. NOT an AI op (no LLM
// involvement, no per-token billing, no `route(op,…)` ladder). It IS a
// server-side compute call that costs CPU + disk, so it sits beside the
// AI routes for symmetric infra (auth → flag check → handler) without
// joining the `/api/ai/*` family.
//
// Behavior contract
// -----------------
// POST /api/tools/compress
//   multipart body:
//     pdf       — required, application/pdf, ≤ 50MB
//     level     — optional, "light" | "balanced" | "strong" (default "balanced")
//
// Responses:
//   200 — JSON:
//     {
//       outputBase64: <string>,     // download bytes (compressed OR original)
//       bypassed: <boolean>,        // true = compression didn't help, output is original
//       inputBytes: <number>,
//       compressedBytes: <number>,  // size of gs output (regardless of bypass)
//       savingsRatio: <number>,     // [-Infinity, 1] — negative = gs grew the file
//       durationMs: <number>,
//       outputFilename: <string>    // suggested filename for download
//     }
//   401 — not_authenticated
//   404 — feature_disabled (when PDF_COMPRESS flag is off — same shape
//         as a missing route so anonymous probing can't tell the route
//         exists)
//   400 — bad_request (missing pdf, wrong mime, level invalid)
//   413 — payload_too_large (input > 50MB)
//   500 — compress_failed (gs spawn failure or timeout)
//
// What's NOT here today (Phase B follow-on)
// -----------------------------------------
// - Credit spend / refund. MVP ships free; if abuse appears we'll add
//   `spendCredits` before `compressPdf` and `refundCredits` on error.
//   The route shape doesn't need to change — just an inserted block
//   between auth and the handler.
// - `recordAiUsage` instrumentation. This route isn't an AI op so it
//   doesn't belong in the AI margin/feedback dashboards. If we want a
//   `tool_usage` analog later, that's a parallel table.
// - File persistence. The compressed bytes round-trip in the response
//   body — caller decides whether to save them. Persisting via the
//   existing `files` table requires a multipart-aware handler change
//   that's not in scope for the foundation.
// - `idempotencyKey` support. Compression is naturally idempotent on
//   identical input bytes, but we don't return a stable cache yet.
//   Acceptable for MVP — a user retrying a failed upload pays the CPU
//   cost twice. Add a content-hash cache when load justifies it.

import "server-only";

import { auth } from "@/auth";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/flags";
import {
  compressPdf,
  COMPRESS_MAX_INPUT_BYTES,
  GhostscriptError,
  type CompressLevel,
} from "@/lib/tools/ghostscript/compress";

// Node runtime — Ghostscript spawn + Node fs APIs don't run on Edge.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_LEVELS: ReadonlySet<CompressLevel> = new Set([
  "light",
  "balanced",
  "strong",
]);

export async function POST(req: Request): Promise<Response> {
  // -- 1. Auth ---------------------------------------------------------
  // Compression is gated to logged-in users so we have a userId for
  // future credit accounting + abuse attribution. Anonymous "free"
  // version could be wired later behind a separate route or via
  // explicit anonymous quota; not in scope for foundation.
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (!userId) {
    return json(401, { error: "not_authenticated" });
  }

  // -- 1b. Feature flag gate -------------------------------------------
  // Foundation ships with the route registered but flag-gated to OFF.
  // That way:
  //   - Operators can flip it on for individual users via
  //     FEATURE_PDF_COMPRESS_USERS=<userId>,... while the UI catches up.
  //   - Public probing returns 404 (same shape as a missing route),
  //     so the route's existence isn't an information leak.
  //   - Once the UI + tool registry entry land in a follow-up commit,
  //     the same env var flip enables it for everyone.
  if (!isFeatureEnabled(FEATURE_FLAGS.PDF_COMPRESS, { userId })) {
    return json(404, { error: "feature_disabled" });
  }

  // -- 2. Parse multipart body -----------------------------------------
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, {
      error: "bad_request",
      detail: "expected multipart/form-data",
    });
  }

  const pdfFile = form.get("pdf");
  if (!(pdfFile instanceof Blob)) {
    return json(400, {
      error: "bad_request",
      detail: "missing pdf file in 'pdf' field",
    });
  }

  // Cheap pre-spawn size check. Buffers built via arrayBuffer() below
  // will exceed COMPRESS_MAX_INPUT_BYTES anyway — checking here lets
  // us return 413 instead of letting the gs wrapper throw a generic
  // INPUT_TOO_LARGE.
  if (pdfFile.size > COMPRESS_MAX_INPUT_BYTES) {
    return json(413, {
      error: "payload_too_large",
      detail: `file is ${pdfFile.size} bytes; max is ${COMPRESS_MAX_INPUT_BYTES}`,
    });
  }

  // Mime-sniff guard — Blob.type comes from the browser's filename
  // mapping or the multipart content-type header. We accept either
  // application/pdf or empty (some browsers omit it on form-encoded
  // uploads). Anything else is rejected to avoid feeding gs a non-
  // PDF file (which it'll process anyway, often producing garbage).
  if (
    pdfFile.type &&
    pdfFile.type !== "application/pdf" &&
    pdfFile.type !== "application/octet-stream"
  ) {
    return json(400, {
      error: "bad_request",
      detail: `expected application/pdf, got ${pdfFile.type}`,
    });
  }

  // Level parameter
  const levelRaw = form.get("level");
  const level: CompressLevel =
    typeof levelRaw === "string" && VALID_LEVELS.has(levelRaw as CompressLevel)
      ? (levelRaw as CompressLevel)
      : "balanced";

  const inputBytes = Buffer.from(await pdfFile.arrayBuffer());

  // PDF magic header check. Ghostscript will technically process
  // files that don't start with %PDF (it tries to repair), but we
  // surface this as a 400 here for cleaner error messaging.
  if (
    inputBytes.length < 4 ||
    inputBytes[0] !== 0x25 || // '%'
    inputBytes[1] !== 0x50 || // 'P'
    inputBytes[2] !== 0x44 || // 'D'
    inputBytes[3] !== 0x46 //   'F'
  ) {
    return json(400, {
      error: "bad_request",
      detail: "file does not start with %PDF magic header",
    });
  }

  // -- 3. Run compression ----------------------------------------------
  let result;
  try {
    result = await compressPdf(inputBytes, { level });
  } catch (err) {
    if (err instanceof GhostscriptError) {
      // Categorize for the client. Timeout vs spawn-failure vs gs-
      // exit-nonzero all mean "we couldn't compress this file" but
      // 500 is the right surface — none are user-actionable beyond
      // retry, and we don't want to leak gs stderr.
      console.error(
        `[compress] Ghostscript ${err.code}: ${err.message}`,
        err.stderr ?? "",
      );
      return json(500, {
        error: "compress_failed",
        detail: err.code,
      });
    }
    console.error("[compress] unexpected error:", err);
    return json(500, { error: "compress_failed", detail: "internal_error" });
  }

  // -- 4. Build response -----------------------------------------------
  // Suggested output filename: <basename>-compressed.pdf, or just
  // "compressed.pdf" if the upload didn't carry a name. Browsers use
  // this via Content-Disposition on the eventual download; we surface
  // it in JSON so the client can wire it into `downloadBytes` directly.
  const inputName =
    pdfFile instanceof File && pdfFile.name ? pdfFile.name : "input.pdf";
  const baseName = inputName.replace(/\.pdf$/i, "");
  const outputFilename = `${baseName}-compressed.pdf`;

  return json(200, {
    outputBase64: result.outputBytes.toString("base64"),
    bypassed: result.bypassed,
    inputBytes: result.inputBytes,
    compressedBytes: result.compressedBytes,
    savingsRatio: result.savingsRatio,
    durationMs: result.durationMs,
    outputFilename,
    level,
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
