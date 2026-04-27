// lib/pdf/ops/page-selection.ts
//
// Tier 2 (2026-04-27): the page-selection ops behind the Extract Pages
// and Delete Pages tools. Both pivot on the same primitive — copy a
// subset of pages into a fresh PDF — and live in the same file because
// they are conceptually inverse (extract = keep selected; delete =
// keep everything except selected).
//
// Shared infrastructure: copyPagesIntoNewDoc from pdf-lib-helpers.

import { copyPagesIntoNewDoc, loadPdf } from "./pdf-lib-helpers";

export interface PageSelectionResult {
  bytes: Uint8Array;
  /** Number of pages in the OUTPUT PDF. */
  pageCount: number;
}

/**
 * Extract a subset of pages into a new PDF. Pages appear in the output
 * in the order specified by the input array — this matters for the
 * "build a 3-page summary from pages 7, 2, 14" workflow where the
 * selection order is meaningful.
 *
 * Defensively dedupes (the runner shouldn't pass dups, but the op is
 * defensive). Throws on empty selection or out-of-range indices.
 */
export async function extractPages(
  bytes: Uint8Array,
  indices: number[],
): Promise<PageSelectionResult> {
  if (indices.length === 0) {
    throw new Error("Pick at least one page to extract.");
  }
  const src = await loadPdf(bytes);
  const total = src.getPageCount();
  if (total === 0) {
    throw new Error("This PDF has no pages.");
  }
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const i of indices) {
    if (i < 0 || i >= total) {
      throw new Error(
        `Page ${i + 1} is outside the document (1-${total}).`,
      );
    }
    if (seen.has(i)) continue;
    seen.add(i);
    ordered.push(i);
  }
  const out = await copyPagesIntoNewDoc(src, ordered);
  const bytesOut = await out.save({ useObjectStreams: true });
  return { bytes: bytesOut, pageCount: out.getPageCount() };
}

/**
 * Delete (drop) a set of pages from a PDF, keeping everything else
 * in original order. Inverse of extractPages.
 *
 * Refuses to delete every page (the result would be invalid). Caller
 * should also enforce this in the UI for a friendlier error.
 */
export async function deletePages(
  bytes: Uint8Array,
  indicesToDelete: number[],
): Promise<PageSelectionResult> {
  const src = await loadPdf(bytes);
  const total = src.getPageCount();
  if (total === 0) {
    throw new Error("This PDF has no pages.");
  }
  const deleteSet = new Set<number>();
  for (const i of indicesToDelete) {
    if (i < 0 || i >= total) continue;
    deleteSet.add(i);
  }
  if (deleteSet.size === 0) {
    throw new Error("Pick at least one page to delete.");
  }
  if (deleteSet.size === total) {
    throw new Error(
      "Can&rsquo;t delete every page — the output would be empty.",
    );
  }
  const keep: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!deleteSet.has(i)) keep.push(i);
  }
  const out = await copyPagesIntoNewDoc(src, keep);
  const bytesOut = await out.save({ useObjectStreams: true });
  return { bytes: bytesOut, pageCount: out.getPageCount() };
}
