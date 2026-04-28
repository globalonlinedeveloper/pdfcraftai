// lib/pdf/ops/add-text-box.ts
//
// Tier 6 (2026-04-28): add a text box at a specific position on every
// page. User clicks on page 1 to define the position; the same text +
// position + style is stamped on all pages (header / footer / fixed
// label use case).
//
// Different from Page Numbers (which stamps a sequence) and Watermark
// (which stamps DRAFT-style overlays at standard positions). This is
// for arbitrary text at an arbitrary user-chosen position.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface AddTextBoxOptions {
  text: string;
  /** X position in PDF user-space points (origin bottom-left). */
  x: number;
  /** Y position in PDF user-space points (origin bottom-left). */
  y: number;
  /** Font size in points. Default 14. */
  fontSize?: number;
  /** Hex color. Default "#000000". */
  color?: string;
}

export interface AddTextBoxResult {
  bytes: Uint8Array;
  pageCount: number;
}

export async function addTextBoxPdf(
  bytes: Uint8Array,
  opts: AddTextBoxOptions,
): Promise<AddTextBoxResult> {
  const text = opts.text.trim();
  if (!text) throw new Error("Type the text first.");
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const pageCount = doc.getPageCount();
  if (pageCount === 0) throw new Error("This PDF has no pages.");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = opts.fontSize ?? 14;
  const color = parseHex(opts.color ?? "#000000");

  for (const page of doc.getPages()) {
    page.drawText(text, {
      x: opts.x,
      y: opts.y,
      size: fontSize,
      font,
      color,
    });
  }

  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, pageCount };
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
