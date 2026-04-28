// lib/pdf/ops/sign.ts
//
// Tier 6 (2026-04-28): place a signature image at a specific position
// on a chosen page via pdf-lib embedPng/embedJpg + drawImage. v1
// applies to one page only — typically the signature page is a single
// page so this matches the common case.
//
// HONEST SCOPE: this is VISUAL signing, not cryptographic signing.
// The PDF doesn&rsquo;t carry a digital signature — there&rsquo;s no signing
// certificate, no integrity binding, no signer identity. Anyone can
// add or remove signatures after the fact. For binding e-sign with
// audit trail, use DocuSign, Adobe Sign, or HelloSign.

import { PDFDocument } from "pdf-lib";

export interface SignOptions {
  imageBytes: Uint8Array;
  imageMime: "image/png" | "image/jpeg";
  /** X position in PDF user-space points (origin bottom-left). */
  x: number;
  /** Y position in PDF user-space points (origin bottom-left). */
  y: number;
  /** Width of the placed signature in PDF points. Height scales proportionally. */
  width: number;
  /** 0-based page index to sign. Default 0 (page 1). */
  pageIndex?: number;
}

export interface SignResult {
  bytes: Uint8Array;
  pageCount: number;
  signedPageIndex: number;
}

export async function signPdf(
  bytes: Uint8Array,
  opts: SignOptions,
): Promise<SignResult> {
  if (!opts.imageBytes || opts.imageBytes.length === 0) {
    throw new Error("Pick a signature image first.");
  }
  if (opts.width <= 0) {
    throw new Error("Signature width must be positive.");
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

  const img =
    opts.imageMime === "image/jpeg"
      ? await doc.embedJpg(opts.imageBytes)
      : await doc.embedPng(opts.imageBytes);

  const page = pages[idx];
  const drawH = opts.width * (img.height / img.width);
  page.drawImage(img, {
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: drawH,
  });

  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out, pageCount: pages.length, signedPageIndex: idx };
}
