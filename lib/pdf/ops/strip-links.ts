// lib/pdf/ops/strip-links.ts
//
// Tier 3 (2026-04-28): remove every hyperlink annotation from a PDF.
// Useful for print prep (links are decorative ink stains on paper),
// for compliance (some workflows ban active hyperlinks in archived
// docs), and for reading on devices where stray clicks open
// distracting URLs.
//
// We touch ONLY the link annotations — every other annotation type
// (highlights, comments, sticky notes, form widgets) is preserved.

import { PDFDocument, PDFArray, PDFDict, PDFName, PDFRef } from "pdf-lib";

export interface StripLinksResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Number of /Link annotations removed across all pages. */
  removedCount: number;
}

export async function stripLinks(bytes: Uint8Array): Promise<StripLinksResult> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const pageCount = doc.getPageCount();
  if (pageCount === 0) throw new Error("This PDF has no pages.");

  let removed = 0;
  const linkName = PDFName.of("Link");
  const subtypeName = PDFName.of("Subtype");
  const annotsName = PDFName.of("Annots");

  for (const page of doc.getPages()) {
    const node = page.node;
    const annotsRaw = node.lookup(annotsName);
    if (!(annotsRaw instanceof PDFArray)) continue;
    const kept: Array<PDFRef | PDFDict> = [];
    for (let i = 0; i < annotsRaw.size(); i++) {
      const item = annotsRaw.get(i);
      // Resolve PDFRef → PDFDict so we can inspect /Subtype.
      let dict: PDFDict | undefined;
      if (item instanceof PDFRef) {
        const looked = doc.context.lookup(item);
        if (looked instanceof PDFDict) dict = looked;
      } else if (item instanceof PDFDict) {
        dict = item;
      }
      if (!dict) {
        // Unknown shape — keep it rather than risk losing data.
        if (item instanceof PDFRef || item instanceof PDFDict) kept.push(item);
        continue;
      }
      const subtype = dict.get(subtypeName);
      if (subtype instanceof PDFName && subtype.toString() === linkName.toString()) {
        removed++;
        continue;
      }
      // Not a link — keep.
      if (item instanceof PDFRef || item instanceof PDFDict) kept.push(item);
    }
    // Replace /Annots with the filtered array (or remove the entry
    // entirely if no annotations remain on this page).
    if (kept.length === 0) {
      node.delete(annotsName);
    } else {
      const newArr = doc.context.obj(kept);
      node.set(annotsName, newArr);
    }
  }

  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, pageCount, removedCount: removed };
}
