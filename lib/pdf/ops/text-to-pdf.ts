// lib/pdf/ops/text-to-pdf.ts
//
// 2026-04-30: convert plain text into a single PDF with word-wrapping
// and automatic page breaks. Powers /tool/text-to-pdf.
//
// Quality model:
//   - Uses pdf-lib's StandardFonts (no font embedding — works
//     identically in every PDF viewer).
//   - Honors single-newlines as line breaks AND blank lines as
//     paragraph spacing (matches user expectation when pasting from
//     a code editor / email).
//   - Word-wrap respects the printable-area width (page minus
//     margins).
//   - Adds a new page when the cursor would overflow the bottom
//     margin.
//   - Default monospace font for code-friendly preservation; user
//     can switch to serif (Times) or sans (Helvetica) for prose.
//
// Why pure pdf-lib:
//   No PDFium / no rasterization. Output is text-selectable +
//   searchable. Lightweight (~80KB import vs PDFium's 3.8MB).

import { PDFDocument, StandardFonts, type PDFFont, rgb } from "pdf-lib";

export type TextFontFamily = "monospace" | "sans" | "serif";
export type PaperSize = "letter" | "a4";

interface PaperDims {
  width: number;
  height: number;
}

const PAPER_DIMS: Record<PaperSize, PaperDims> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595, height: 842 },
};

const FONT_NAMES: Record<TextFontFamily, StandardFonts> = {
  monospace: StandardFonts.Courier,
  sans: StandardFonts.Helvetica,
  serif: StandardFonts.TimesRoman,
};

export interface TextToPdfOptions {
  /** Font family. Default: monospace (preserves indentation reliably). */
  fontFamily?: TextFontFamily;
  /** Font size in points. Default: 11. */
  fontSize?: number;
  /** Page size. Default: letter. */
  pageSize?: PaperSize;
  /** Margin in points. Default 54 (0.75"). */
  marginPt?: number;
  /** Line height multiplier. Default 1.4. */
  lineHeightMultiplier?: number;
}

export interface TextToPdfResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Number of source lines that were wrapped to a longer rendered line. */
  wrappedLineCount: number;
}

/**
 * Convert text to a paginated PDF.
 *
 * Word-wrap algorithm: greedy. For each input line, push words one
 * by one onto the current rendered line; flush when adding the next
 * word would overflow the printable width. Empty input lines emit a
 * blank rendered line (preserves paragraph spacing).
 *
 * Page-break: when the cursor's next y-position would dip below the
 * bottom margin, finalize the current page and start a new one.
 */
export async function textToPdf(
  text: string,
  options: TextToPdfOptions = {},
): Promise<TextToPdfResult> {
  const fontFamily = options.fontFamily ?? "monospace";
  const fontSize = options.fontSize ?? 11;
  const pageSize = options.pageSize ?? "letter";
  const margin = options.marginPt ?? 54;
  const lineHeight = fontSize * (options.lineHeightMultiplier ?? 1.4);

  const dims = PAPER_DIMS[pageSize];
  const printW = dims.width - margin * 2;
  const printH = dims.height - margin * 2;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(FONT_NAMES[fontFamily]);

  // Normalize CRLF, then split into source lines.
  const sourceLines = text.replace(/\r\n/g, "\n").split("\n");
  let wrappedLineCount = 0;

  // Word-wrap each source line into one or more rendered lines.
  const renderedLines: string[] = [];
  for (const sourceLine of sourceLines) {
    if (sourceLine.length === 0) {
      // Preserve blank lines as paragraph spacing.
      renderedLines.push("");
      continue;
    }
    const wrapped = wrapLine(sourceLine, font, fontSize, printW);
    if (wrapped.length > 1) wrappedLineCount += 1;
    renderedLines.push(...wrapped);
  }

  // Lay out on pages.
  let page = doc.addPage([dims.width, dims.height]);
  let y = dims.height - margin - fontSize;

  for (const line of renderedLines) {
    if (y < margin) {
      // Page break.
      page = doc.addPage([dims.width, dims.height]);
      y = dims.height - margin - fontSize;
    }
    if (line.length > 0) {
      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
    y -= lineHeight;
  }

  void printH; // referenced for clarity though only printW is used in math
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, pageCount: doc.getPageCount(), wrappedLineCount };
}

/**
 * Greedy word-wrap. Returns one or more rendered lines that fit
 * within `maxWidth` at the given font + size. Falls back to
 * character-level break for any single word that exceeds the
 * width by itself (rare — long URLs, base64 strings).
 */
function wrapLine(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  // Preserve leading whitespace (matters for code indentation).
  const leadMatch = text.match(/^(\s*)/);
  const lead = leadMatch ? leadMatch[1] : "";
  const body = text.slice(lead.length);

  if (body.length === 0) return [text];

  const words = body.split(/(\s+)/); // keep the separators
  const lines: string[] = [];
  let current = lead;

  for (const word of words) {
    if (word.length === 0) continue;
    const candidate = current + word;
    const w = font.widthOfTextAtSize(candidate, size);
    if (w <= maxWidth) {
      current = candidate;
      continue;
    }
    // Doesn't fit. Push current if non-empty + char-break the word
    // if it exceeds maxWidth on its own.
    if (current.trim().length > 0) {
      lines.push(current.trimEnd());
    }
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      // Char-break very long tokens.
      let chunk = "";
      for (const ch of word) {
        const trial = chunk + ch;
        if (font.widthOfTextAtSize(trial, size) > maxWidth) {
          if (chunk.length > 0) lines.push(chunk);
          chunk = ch;
        } else {
          chunk = trial;
        }
      }
      current = chunk;
    } else {
      current = word.startsWith(" ") ? word.trimStart() : word;
    }
  }

  if (current.trim().length > 0) {
    lines.push(current.trimEnd());
  }
  return lines.length > 0 ? lines : [text];
}
