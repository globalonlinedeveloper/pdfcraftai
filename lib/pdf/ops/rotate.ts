// lib/pdf/ops/rotate.ts
//
// Build 2 Wave 9 (2026-04-27): rotate pages of a PDF by 90°/180°/270°.
// 2026-04-27 (visual rotate UX): added rotatePdfPerPage for the new
// thumbnail-based UI where each page can have its own rotation.
//
// pdf-lib's setRotation works by adjusting the /Rotate entry on each
// page — the underlying content stream is untouched, so this is a
// lossless operation that runs in milliseconds even on huge files.

import { PDFDocument, degrees } from "pdf-lib";
import { parsePageRange } from "./pdf-lib-helpers";

export type RotateAngle = 90 | 180 | 270;

export interface RotateOptions {
  /** Clockwise degrees to add. Negative angles are supported via 360-N. */
  angle: RotateAngle;
  /**
   * Which pages to rotate, 1-based, comma-separated. Empty / "all"
   * rotates every page.
   */
  pages?: string;
}

export interface RotateResult {
  bytes: Uint8Array;
  /** Number of pages actually rotated. */
  rotatedCount: number;
  /** Total pages in the doc. */
  pageCount: number;
}

export async function rotatePdf(
  bytes: Uint8Array,
  opts: RotateOptions,
): Promise<RotateResult> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const pageCount = doc.getPageCount();
  if (pageCount === 0) {
    throw new Error("This PDF has no pages.");
  }
  const expr = (opts.pages ?? "").trim();
  const parsed = parsePageRange(expr || "all", pageCount);
  const indices = parsed.indices;
  if (indices.length === 0) {
    throw new Error("No pages selected.");
  }

  const pages = doc.getPages();
  for (const i of indices) {
    const page = pages[i];
    // Add to existing rotation rather than overwriting — preserves
    // the original orientation when users double-rotate.
    const current = page.getRotation().angle || 0;
    const next = (((current + opts.angle) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  }

  const out = await doc.save({ useObjectStreams: true });
  return {
    bytes: out,
    rotatedCount: indices.length,
    pageCount,
  };
}

/**
 * Per-page rotation map. Used by the thumbnail-grid UI where each
 * page tracks its own rotation independently.
 *
 * @param perPage 0-based page index → degrees to ADD (90 / 180 / 270).
 *                Pages absent from the map stay as-is. A value of 0 is
 *                also treated as "no change".
 */
export async function rotatePdfPerPage(
  bytes: Uint8Array,
  perPage: Record<number, number>,
): Promise<RotateResult> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const pageCount = doc.getPageCount();
  if (pageCount === 0) {
    throw new Error("This PDF has no pages.");
  }

  const pages = doc.getPages();
  let rotatedCount = 0;
  for (const [k, addRaw] of Object.entries(perPage)) {
    const idx = Number.parseInt(k, 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= pageCount) continue;
    const add = (((addRaw % 360) + 360) % 360) as number;
    if (add === 0) continue;
    const page = pages[idx];
    const current = page.getRotation().angle || 0;
    const next = (((current + add) % 360) + 360) % 360;
    page.setRotation(degrees(next));
    rotatedCount += 1;
  }

  if (rotatedCount === 0) {
    throw new Error("No pages selected to rotate.");
  }

  const out = await doc.save({ useObjectStreams: true });
  return {
    bytes: out,
    rotatedCount,
    pageCount,
  };
}
