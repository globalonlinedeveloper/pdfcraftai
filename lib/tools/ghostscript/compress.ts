// lib/tools/ghostscript/compress.ts — server-side Ghostscript wrapper
// for PDF compression (PENDING §5a foundation, 2026-05-05).
//
// One-paragraph summary
// ---------------------
// Ghostscript 9.54.0 is on the Hostinger box (verified via SSH on
// 2026-05-05). qpdf is NOT, so this module is Ghostscript-only — no
// fallback path. Three quality levels map to the standard `-dPDFSETTINGS`
// presets (`/printer`, `/ebook`, `/screen`). Wrapper writes the input
// to a temp file, invokes `gs` with timeout, reads the output bytes,
// always cleans up — even on timeout / kill / throw.
//
// Why a separate module
// ---------------------
// Ghostscript is the only realistic tool for PDF compression on managed
// Linux. PDF/A conversion (PENDING §5b) will share this module by
// adding `-dPDFA=2 -sProcessColorModel=DeviceRGB ...` flags. Keeping
// the spawn / temp-file / timeout / cleanup machinery here means §5b
// is a 1-function diff to add — same `runGhostscript()` core, just a
// different argv builder.
//
// What this module does NOT do
// ----------------------------
// - Auth / rate-limit / abuse-prevention. The route handler does that.
// - Credit pricing. MVP ships free (free-tier bounded by 50MB +
//   200-page caps; if abuse surfaces, add credit gating in the route).
// - File persistence. Bytes round-trip: client → multipart → temp
//   file → gs → temp file → response. The route handler decides
//   whether to also persist via the existing files-storage infra.
// - Linearization (Fast Web View). `-dFastWebView=true` is included
//   in argv so all three presets produce web-optimized output.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Compression level → Ghostscript `-dPDFSETTINGS` mapping. The names
 * match Adobe's preset terminology; the user-facing copy translates
 * to "Light / Balanced / Strong".
 *
 * Sizes here are typical observations (Ghostscript docs + practical
 * experience), NOT guarantees:
 *   light    /printer  → ~10-30% reduction; minimal visible loss
 *   balanced /ebook    → ~30-50% reduction; good for most use cases
 *   strong   /screen   → ~50-80% reduction; visible image-quality drop
 *
 * /default and /prepress also exist as Ghostscript presets but are
 * intentionally not exposed: /default produces almost no compression
 * (defeats the purpose), /prepress targets professional print
 * workflows where the user knows enough to invoke Ghostscript directly.
 */
export type CompressLevel = "light" | "balanced" | "strong";

const PDF_SETTINGS_MAP: Record<CompressLevel, string> = {
  light: "/printer",
  balanced: "/ebook",
  strong: "/screen",
};

/**
 * Per-call timeout. Ghostscript on a 50MB PDF with /screen typically
 * runs ~5s; on a worst-case mostly-image 50MB PDF /printer can take
 * ~30s. 60s gives generous headroom while bounding the worst-case
 * cost. Past 60s we kill -9 and surface a timeout error rather than
 * letting Passenger's keep-alive pull the rug.
 */
export const COMPRESS_TIMEOUT_MS = 60_000;

/**
 * Hard size cap for the input. Mirrors `MAX_FILE_SIZE_BYTES` in
 * `lib/client/pdf-utils.ts` (50MB) so client + server agree before
 * the upload starts. Larger files reject pre-spawn — Ghostscript
 * can technically handle them, but the time budget gets out of hand.
 */
export const COMPRESS_MAX_INPUT_BYTES = 50 * 1024 * 1024;

/**
 * Minimum savings threshold below which we return the ORIGINAL bytes
 * rather than the compressed output. If Ghostscript can only shave
 * 2% off the file, the user is better served by the original (which
 * is bit-identical to what they uploaded — preserves exact metadata,
 * font subsetting, etc.) plus an honest "we couldn't make it smaller"
 * message in the UI. 5% chosen empirically: anything below that is
 * within the noise of font-subset-vs-non-subset; users don't perceive
 * the difference.
 */
export const COMPRESS_MIN_SAVINGS_RATIO = 0.05;

export interface CompressResult {
  /** The bytes the user should download. Either compressed or original. */
  outputBytes: Buffer;
  /** True if `outputBytes` is the original (compression didn't help). */
  bypassed: boolean;
  /** Original file size (bytes). */
  inputBytes: number;
  /** Size of Ghostscript output (bytes). Same as outputBytes.length when not bypassed. */
  compressedBytes: number;
  /** Decimal in [0,1]. Negative if Ghostscript made it bigger (bypass triggered). */
  savingsRatio: number;
  /** Wall-clock ms the gs invocation took. */
  durationMs: number;
}

export interface CompressOptions {
  /** Quality preset. Defaults to "balanced". */
  level?: CompressLevel;
  /**
   * Override the Ghostscript binary path. Defaults to "gs" (resolves
   * via PATH). Set this in tests or when running in environments where
   * gs is at a non-standard path.
   */
  gsBinary?: string;
}

export class GhostscriptError extends Error {
  constructor(
    message: string,
    public readonly code: "TIMEOUT" | "EXIT_NONZERO" | "SPAWN_FAILED" | "INPUT_TOO_LARGE",
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "GhostscriptError";
  }
}

/**
 * Compress a PDF using Ghostscript. Returns the smaller of {compressed,
 * original} — caller never has to second-guess whether to use the
 * output bytes.
 *
 * Implementation notes
 * --------------------
 * - Temp dir per call (mkdtemp). Deleted in finally{} regardless of
 *   path. We don't reuse dirs across calls because concurrent
 *   compressions on a single user (or burst from the same IP) would
 *   step on each other's input.pdf / output.pdf.
 * - We pass paths via `-sOutputFile=` and a positional input, NOT via
 *   stdin, because Ghostscript's stdin handling has known issues with
 *   binary data on some Linux distros. Files-on-disk is the safer path.
 * - `-dNOPAUSE -dQUIET -dBATCH` is the standard "non-interactive"
 *   triplet. Without -dQUIET, gs writes percentage progress to stderr
 *   which we don't need.
 * - `-dFastWebView=true` enables linearization (objects rearranged so
 *   the first page renders before the rest of the file downloads).
 *   Free win.
 * - We DON'T use `-dPDFA=2` here — that's the §5b PDF/A converter's
 *   territory. Compression and PDF/A conversion are orthogonal user
 *   intents that share the wrapper but not the argv.
 */
export async function compressPdf(
  inputBytes: Buffer,
  options: CompressOptions = {},
): Promise<CompressResult> {
  if (inputBytes.length > COMPRESS_MAX_INPUT_BYTES) {
    throw new GhostscriptError(
      `Input exceeds ${COMPRESS_MAX_INPUT_BYTES} bytes (got ${inputBytes.length})`,
      "INPUT_TOO_LARGE",
    );
  }

  const level: CompressLevel = options.level ?? "balanced";
  const pdfSettings = PDF_SETTINGS_MAP[level];
  const gsBinary = options.gsBinary ?? "gs";

  const tmp = await mkdtemp(path.join(tmpdir(), "pdfcompress-"));
  const inputPath = path.join(tmp, "in.pdf");
  const outputPath = path.join(tmp, "out.pdf");

  try {
    await writeFile(inputPath, inputBytes);

    const startedAt = Date.now();
    await runGhostscript(gsBinary, [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      `-dPDFSETTINGS=${pdfSettings}`,
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      "-dFastWebView=true",
      `-sOutputFile=${outputPath}`,
      inputPath,
    ]);
    const durationMs = Date.now() - startedAt;

    const compressedBytes = await readFile(outputPath);
    const savingsRatio =
      inputBytes.length > 0
        ? (inputBytes.length - compressedBytes.length) / inputBytes.length
        : 0;

    // Bypass guard: if Ghostscript made the file LARGER (negative
    // savings) or the savings are below the noise floor, return the
    // original. The user still gets a successful response with
    // bypassed=true so the UI can render an honest "we couldn't make
    // it smaller" message rather than silently delivering an inflated
    // file or a bogus 0-byte saving.
    if (savingsRatio < COMPRESS_MIN_SAVINGS_RATIO) {
      return {
        outputBytes: inputBytes,
        bypassed: true,
        inputBytes: inputBytes.length,
        compressedBytes: compressedBytes.length,
        savingsRatio,
        durationMs,
      };
    }

    return {
      outputBytes: compressedBytes,
      bypassed: false,
      inputBytes: inputBytes.length,
      compressedBytes: compressedBytes.length,
      savingsRatio,
      durationMs,
    };
  } finally {
    // Always clean up — even on timeout / kill / throw. rm with
    // recursive+force matches the mkdtemp pattern exactly.
    await rm(tmp, { recursive: true, force: true }).catch(() => {
      // Cleanup failure is non-fatal for the request — log but don't
      // throw. (We deliberately don't pull in a logger here to keep
      // this module dependency-free; the route handler logs the
      // outer error if there is one.)
    });
  }
}

/**
 * Spawn `gs` with the given argv. Resolves on clean exit (code 0),
 * rejects with GhostscriptError on timeout / non-zero exit / spawn
 * failure. Captures stderr for the error message.
 *
 * Why not `execFile` from `node:child_process`?
 *   - `execFile` buffers stdout/stderr in memory. Ghostscript's stderr
 *     is small but its stdout is empty (we use -sOutputFile). Either
 *     works, but `spawn` gives us cleaner timeout-then-kill semantics
 *     because we own the child reference end-to-end.
 *   - We need to be able to issue SIGKILL specifically — execFile only
 *     does SIGTERM by default and Ghostscript can ignore SIGTERM mid-
 *     compression, leaving zombies behind. Mass-kill cleanup is what
 *     the 2026-04-30 cascade taught us; better not to create more
 *     ghost processes here.
 */
function runGhostscript(gsBinary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let timedOut = false;

    const child = spawn(gsBinary, args, { stdio: ["ignore", "ignore", "pipe"] });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, COMPRESS_TIMEOUT_MS);

    child.stderr?.on("data", (chunk: Buffer) => {
      // Cap stderr capture so a runaway gs writing megabytes of
      // warnings can't blow up server memory. 64KB is plenty for
      // diagnostic context.
      if (stderr.length < 64 * 1024) {
        stderr += chunk.toString("utf8");
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new GhostscriptError(
          `Failed to spawn ${gsBinary}: ${err.message}`,
          "SPAWN_FAILED",
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new GhostscriptError(
            `Ghostscript timed out after ${COMPRESS_TIMEOUT_MS}ms`,
            "TIMEOUT",
            stderr,
          ),
        );
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new GhostscriptError(
          `Ghostscript exited with code ${code}`,
          "EXIT_NONZERO",
          stderr,
        ),
      );
    });
  });
}
