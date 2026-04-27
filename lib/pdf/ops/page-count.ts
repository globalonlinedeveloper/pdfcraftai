// lib/pdf/ops/page-count.ts
//
// Read the page count of a PDF using PDFium. Trivially simple — pdf-lib
// can do this too — but it lives here to be the canonical reference
// implementation of the lib/pdf/ops pattern: import the library helper,
// open the doc, ask one question, return.

"use client";

import { withPdfDocument } from "../library";

export async function getPageCount(bytes: Uint8Array): Promise<number> {
  return withPdfDocument(bytes, async (doc) => doc.getPageCount());
}
