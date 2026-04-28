// lib/pdf/ops/redact.ts
//
// Tier 6 (2026-04-28): visual redaction — draw opaque rectangles
// over sensitive areas on a specific page.
//
// HONEST SCOPE NOTE
// -----------------
// This is VISUAL redaction. We draw an opaque rectangle on top of the
// page content via pdf-lib drawRectangle. The original content
// (text, images, vector paths) still exists in the underlying content
// stream — a motivated attacker with PDF tooling (pdftotext, qpdf,
// Adobe Acrobat) can extract what&rsquo;s under the black box.
//
// For TRUE redaction (where the underlying objects are destroyed),
// the practical options are:
//   1. Rasterize the page first (PDF → JPG → PDF). The page becomes
//      a flat image; nothing recoverable. We ship Rasterize as a
//      separate tool.
//   2. Server-side qpdf or pdfcpu with a destructive redact op.
//   3. Adobe Acrobat&rsquo;s redaction feature (not a free option).
//
// For low-stakes use cases (covering a name on a printout, hiding a
// price in a screenshot), this visual redaction is fine. For
// high-stakes use cases (court filings, FOIA releases, healthcare
// records), use one of the above paths instead.

import { PDFDocument, rgb } from "pdf-lib";

export interface RedactRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RedactOptions {
  rects: RedactRect[];
  /** Hex color. Default "#000000" (black). White also useful for "erase" effect. */
  color?: string;
  /** 0-based page index. Default 0 (page 1). */
  pageIndex?: number;
}

export interface RedactResult {
  bytes: Uint8Array;
  pageCount: number;
  redactedRectCount: number;
}

export async function redactPdf(
  bytes: Uint8Array,
  opts: RedactOptions,
): Promise<RedactResult> {
  if (opts.rects.length === 0) {
    throw new Error("Draw at least one redaction box first.");
  }
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error("This PDF has no pages.");
  const idx = opts.pageIndex ?? 0;
  if (idx < 0 || idx >= pages.length) {
    throw new Error(`Page ${idx + 1} is outside 1-${pages.length}.`);
  }
  const page = pages[idx];
  const color = parseHex(opts.color ?? "#000000");

  let drawn = 0;
  for (const r of opts.rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    page.drawRectangle({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      color,
      opacity: 1, // opaque — visual cover
      borderWidth: 0,
    });
    drawn++;
  }

  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, pageCount: pages.length, redactedRectCount: drawn };
}

function parseHex(hex: string): ReturnType<typeof rgb> {
  const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return rgb(0, 0, 0);
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}
