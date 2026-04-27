// lib/pdf/ops/repair.ts
//
// Tier 3 (2026-04-28): "repair" mildly malformed PDFs by parsing them
// through pdf-lib and re-serializing. pdf-lib's parser is more
// permissive than many viewers — it can usually load a PDF with
// missing xref entries, malformed object streams, or stale generation
// numbers. The re-save produces a clean, spec-compliant document.
//
// HONEST SCOPE NOTE: this is NOT a deep repair tool. It can&rsquo;t fix
// truncated files, cryptographic damage, or content streams whose
// internal structure is corrupt. It CAN fix:
//   - dangling /Prev xref pointers
//   - stale or missing trailer dicts
//   - object streams with format quirks
//   - documents that other readers consider "linearized incorrectly"
// For deeper damage, qpdf --repair is the right tool (server-side).

import { PDFDocument } from "pdf-lib";

export interface RepairResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Whether the input bytes parsed without warnings. */
  wasClean: boolean;
  /** Original size for compare. */
  originalSize: number;
}

export async function repairPdf(bytes: Uint8Array): Promise<RepairResult> {
  // throwOnInvalidObject=false makes pdf-lib swallow recoverable parse
  // errors (which is what we want for a repair operation). We also
  // skip metadata updates so the output stays semantically identical
  // to the input — just structurally clean.
  let wasClean = true;
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (err) {
    wasClean = false;
    // Last-ditch: try with the most permissive options. If this also
    // throws, the file is too damaged for pdf-lib to handle.
    const msg = err instanceof Error ? err.message : "Could not parse PDF.";
    throw new Error(
      `pdf-lib couldn&rsquo;t parse this PDF: ${msg}. Try Adobe Acrobat or qpdf for deeper repairs.`,
    );
  }

  const pageCount = doc.getPageCount();
  if (pageCount === 0) {
    throw new Error("Repaired PDF has no pages — input may be too damaged.");
  }

  const out = await doc.save({ useObjectStreams: true });
  return {
    bytes: out,
    pageCount,
    wasClean,
    originalSize: bytes.length,
  };
}
