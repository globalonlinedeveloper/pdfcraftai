// Server-side PDF text extraction.
//
// Used by /api/ai/chat to turn an uploaded PDF into plain text before
// sending it to the AI provider. Keeps our `AIProvider` interface
// narrow (text in, text out) — native PDF input will come later for
// adapters whose `capabilities.pdfInput` flips true.
//
// Rules:
//   - `"server-only"` — this path pulls in pdfjs-dist's legacy build,
//     which must never ship to the browser bundle.
//   - Text only, page by page. We emit a `\f` (form feed) between
//     pages so the model can reason about page structure ("see page
//     3" prompts work).
//   - OCR is not performed here. We flag pages with near-zero text as
//     candidates for OCR upstream; the route handler can surface a
//     "this PDF looks scanned" warning instead of silently returning
//     an empty document.
//   - No image rendering / no canvas. That's why we can skip the
//     optional @napi-rs/canvas + @emnapi + @tybys transitive deps on
//     the deploy target.

import "server-only";

// pdfjs-dist's "legacy" build is the ES2019-compatible one that runs
// under Node's vm. The modern build uses ESM features not yet stable
// across every Node version we support (>=18.17).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/** One extracted page's worth of text + bookkeeping. */
export interface ExtractedPage {
  pageNumber: number;
  /** Joined text runs. Spaces inserted between adjacent items. */
  text: string;
  /** True when the page has <20 chars of extractable text — likely scanned. */
  likelyNeedsOcr: boolean;
}

export interface ExtractedPdf {
  pageCount: number;
  pages: ExtractedPage[];
  /** All pages concatenated with `\f` separators. Safe to send to an LLM. */
  fullText: string;
  /**
   * Pages flagged as `likelyNeedsOcr`. Callers should surface this to
   * the user ("we couldn't read N pages — did you mean to run OCR
   * first?") rather than silently truncating.
   */
  ocrCandidatePages: number[];
}

/** Char threshold below which we assume a page is image-only. */
const OCR_CANDIDATE_CHAR_THRESHOLD = 20;

/**
 * Extract text from a PDF byte buffer. `source` must be the raw PDF
 * bytes (e.g. what you'd get from `File.arrayBuffer()`).
 *
 * Throws on malformed PDFs — the route handler should 400 and not
 * charge the user for a broken upload.
 */
export async function extractPdfText(source: Uint8Array | ArrayBuffer): Promise<ExtractedPdf> {
  const data = source instanceof Uint8Array ? source : new Uint8Array(source);
  // Loading options tuned for server-side extraction:
  //   - `useSystemFonts: false` — we don't render, so system fonts
  //     are irrelevant and scanning them on a server is wasteful.
  //   - `disableFontFace: true` — same reasoning; no canvas, no font
  //     faces.
  //   - `isEvalSupported: false` — defense-in-depth against crafted
  //     PDFs trying to execute code.
  //   - No `workerSrc` — pdfjs falls back to inline execution, which
  //     is what we want under Next.js serverless / hPanel.
  const loadingTask = (pdfjs as typeof pdfjs & { getDocument: (opts: unknown) => { promise: Promise<PdfDocumentLike> } }).getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  const pageCount = doc.numPages;
  const pages: ExtractedPage[] = [];
  const ocrCandidatePages: number[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    try {
      const content = await page.getTextContent();
      const text = joinTextItems(content.items);
      const likelyNeedsOcr = text.trim().length < OCR_CANDIDATE_CHAR_THRESHOLD;
      if (likelyNeedsOcr) ocrCandidatePages.push(i);
      pages.push({ pageNumber: i, text, likelyNeedsOcr });
    } finally {
      // Free the page's internal caches. On large PDFs this matters.
      page.cleanup();
    }
  }

  // Release the document too — pdfjs holds a memory pool across pages.
  await doc.cleanup();
  await doc.destroy();

  const fullText = pages.map((p) => p.text).join("\f");

  return { pageCount, pages, fullText, ocrCandidatePages };
}

// -- internals --------------------------------------------------------

/** Shape of `page.getTextContent().items[]` we care about. */
type TextItemLike =
  | { str: string; hasEOL?: boolean }
  | { type: string } // marked-content items; skip
  ;

/**
 * pdfjs returns a flat array of text runs in reading order, plus
 * marker items. We concatenate the `str` fields with spaces, inserting
 * newlines where the run signaled an end-of-line. Good enough for LLM
 * context; loses exact layout, which the model doesn't need.
 */
function joinTextItems(items: unknown[]): string {
  let out = "";
  for (const raw of items) {
    const item = raw as TextItemLike;
    if (!("str" in item)) continue;
    if (item.str) {
      out += item.str;
      if (item.hasEOL) out += "\n";
      else out += " ";
    }
  }
  // Collapse the trailing trailing-space pile and normalize whitespace
  // within lines (keep newlines, squash other runs).
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

/**
 * Minimal structural type we need from pdfjs's PDFDocumentProxy /
 * PDFPageProxy. Saves us from pulling deep type imports that fight with
 * the legacy build's .d.mts surface.
 */
interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  cleanup(): Promise<void>;
  destroy(): Promise<void>;
}
interface PdfPageLike {
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup(): void;
}
