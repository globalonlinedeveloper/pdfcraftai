// lib/pdf/ops/page-numbers.ts
//
// Tier 3 (2026-04-28): add page numbers to a PDF via pdf-lib's
// drawText. Numbers are drawn on top of existing content (we don't
// modify the content stream's other elements) so this is a safe
// non-destructive overlay.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type Position =
  | "bottom-center"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "top-right"
  | "top-left";

export type NumberFormat =
  | "1"           // 1, 2, 3, ...
  | "1 of N"      // 1 of 10, 2 of 10, ...
  | "Page 1"      // Page 1, Page 2, ...
  | "Page 1 of N";// Page 1 of 10, ...

export interface PageNumberOptions {
  position: Position;
  format: NumberFormat;
  /** Font size in points. Default 11. */
  fontSize?: number;
  /** Page index (0-based) at which to start numbering. Default 0. */
  startPage?: number;
  /** Number printed for the first numbered page. Default 1. */
  startNumber?: number;
  /** Margin from page edge in points. Default 28 (~0.4 inch). */
  margin?: number;
}

export interface PageNumberResult {
  bytes: Uint8Array;
  pageCount: number;
  numberedCount: number;
}

export async function addPageNumbers(
  bytes: Uint8Array,
  opts: PageNumberOptions,
): Promise<PageNumberResult> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const pageCount = doc.getPageCount();
  if (pageCount === 0) throw new Error("This PDF has no pages.");

  const fontSize = opts.fontSize ?? 11;
  const margin = opts.margin ?? 28;
  const startPage = Math.max(0, opts.startPage ?? 0);
  const startNumber = opts.startNumber ?? 1;

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);

  const pages = doc.getPages();
  let numbered = 0;
  for (let i = startPage; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    const num = startNumber + (i - startPage);
    const text = formatNumber(opts.format, num, pageCount);
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    let x = 0;
    let y = 0;
    const isBottom = opts.position.startsWith("bottom-");
    y = isBottom ? margin : height - margin - fontSize;
    if (opts.position.endsWith("-center")) {
      x = (width - textWidth) / 2;
    } else if (opts.position.endsWith("-right")) {
      x = width - margin - textWidth;
    } else {
      x = margin;
    }

    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: black,
    });
    numbered++;
  }

  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, pageCount, numberedCount: numbered };
}

function formatNumber(format: NumberFormat, n: number, total: number): string {
  switch (format) {
    case "1":
      return String(n);
    case "1 of N":
      return `${n} of ${total}`;
    case "Page 1":
      return `Page ${n}`;
    case "Page 1 of N":
      return `Page ${n} of ${total}`;
  }
}
