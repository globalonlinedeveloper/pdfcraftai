// lib/pdf/ops/flatten.ts
//
// Tier 3 (2026-04-28): flatten interactive form fields into static
// page content. After flattening, the form values are baked into the
// page&rsquo;s content stream — recipients see filled values but can no
// longer edit them.
//
// pdf-lib's PDFForm.flatten() handles AcroForm flattening. XFA forms
// (rare in modern PDFs) are not supported by pdf-lib and will surface
// a warning. Annotation flattening is more involved and not included
// here — see future Tier 3.

import { PDFDocument } from "pdf-lib";

export interface FlattenResult {
  bytes: Uint8Array;
  pageCount: number;
  /** True if the input had any AcroForm fields. */
  hadFormFields: boolean;
  /** Number of fields flattened. */
  flattenedFieldCount: number;
}

export async function flattenPdf(bytes: Uint8Array): Promise<FlattenResult> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const pageCount = doc.getPageCount();
  if (pageCount === 0) throw new Error("This PDF has no pages.");

  // getForm() returns the AcroForm dict, creating an empty one if
  // none exists. So we check field count rather than form existence.
  const form = doc.getForm();
  const fields = form.getFields();
  const fieldCount = fields.length;

  if (fieldCount > 0) {
    try {
      form.flatten();
    } catch (err) {
      // pdf-lib occasionally throws on unusual field types (XFA,
      // signature fields with embedded PKCS7 data). Surface a clear
      // error instead of failing silently.
      const msg = err instanceof Error ? err.message : "Flatten failed.";
      throw new Error(
        `Flatten failed: ${msg}. Some forms (XFA, signature fields) need Adobe Acrobat to flatten correctly.`,
      );
    }
  }

  const out = await doc.save({ useObjectStreams: true });
  return {
    bytes: out,
    pageCount,
    hadFormFields: fieldCount > 0,
    flattenedFieldCount: fieldCount,
  };
}
