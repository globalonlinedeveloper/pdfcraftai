// lib/pdf/ops/images-to-pdf.ts
//
// 2026-04-30: convert one or more JPEG / PNG images into a single PDF.
// Each image becomes one page; the page is sized to the target paper
// size and the image is scaled to fit while preserving aspect ratio.
//
// Powers two tools:
//   - /tool/jpg-to-pdf (accepts image/jpeg)
//   - /tool/png-to-pdf (accepts image/png)
// Both share this op via the `format` param.
//
// Quality model:
//   - Image bytes are embedded at native resolution (pdf-lib's
//     embedJpg / embedPng don't recompress — original quality
//     preserved).
//   - Page size matches user choice (Letter / A4 / "fit-to-image").
//   - Aspect ratio always preserved; margins fill the unused area.
//   - Default margin: 36pt (0.5") on all sides for printable output.
//
// Why per-page-per-image instead of multiple-images-per-page:
//   Most users want "convert these screenshots to a printable PDF" —
//   one image per page is the assumed shape. N-up packing is a
//   separate use case (we have /tool/n-up-pdf for that).

import { PDFDocument } from "pdf-lib";

export type ImageToPdfFormat = "jpeg" | "png";

export type PaperSize = "letter" | "a4" | "a3" | "a5" | "legal" | "fit";

interface PaperDims {
  width: number;
  height: number;
}

const PAPER_DIMS: Record<Exclude<PaperSize, "fit">, PaperDims> = {
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  a3: { width: 842, height: 1191 },
  a4: { width: 595, height: 842 },
  a5: { width: 420, height: 595 },
};

export interface ImageInput {
  bytes: Uint8Array;
  /** Original filename (used for error messages only). */
  name: string;
}

export interface ImagesToPdfOptions {
  format: ImageToPdfFormat;
  /** Target page size. "fit" sizes each page to the image (no margins). */
  pageSize: PaperSize;
  /** Landscape orientation. Ignored when pageSize is "fit". */
  landscape?: boolean;
  /** Margin in points. Default 36 (0.5 inch). Ignored when pageSize is "fit". */
  marginPt?: number;
}

export interface ImagesToPdfResult {
  bytes: Uint8Array;
  pageCount: number;
}

/**
 * Build a PDF from one or more image files.
 *
 * @throws Error if any image is malformed (caller should map via
 *         mapPdfOpError for the user-facing message).
 */
export async function imagesToPdf(
  images: readonly ImageInput[],
  options: ImagesToPdfOptions,
): Promise<ImagesToPdfResult> {
  if (images.length === 0) {
    throw new Error("No images provided.");
  }

  const doc = await PDFDocument.create();
  const margin = options.marginPt ?? 36;

  for (const image of images) {
    let embedded;
    try {
      embedded =
        options.format === "jpeg"
          ? await doc.embedJpg(image.bytes)
          : await doc.embedPng(image.bytes);
    } catch (err) {
      throw new Error(
        `Couldn't read "${image.name}" as ${options.format.toUpperCase()}. ${
          err instanceof Error ? err.message : ""
        }`,
      );
    }

    const imgW = embedded.width;
    const imgH = embedded.height;

    let pageW: number;
    let pageH: number;
    if (options.pageSize === "fit") {
      // Page sized to image — no margins, no scaling.
      pageW = imgW;
      pageH = imgH;
    } else {
      const dims = PAPER_DIMS[options.pageSize];
      pageW = options.landscape ? dims.height : dims.width;
      pageH = options.landscape ? dims.width : dims.height;
    }

    const page = doc.addPage([pageW, pageH]);

    if (options.pageSize === "fit") {
      page.drawImage(embedded, { x: 0, y: 0, width: pageW, height: pageH });
    } else {
      // Scale image to fit within margins while preserving aspect ratio.
      const availW = pageW - margin * 2;
      const availH = pageH - margin * 2;
      const scale = Math.min(availW / imgW, availH / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      // Center within the printable area.
      const x = (pageW - drawW) / 2;
      const y = (pageH - drawH) / 2;
      page.drawImage(embedded, { x, y, width: drawW, height: drawH });
    }
  }

  // useObjectStreams: false so byte-parser inspectors (links / forms /
  // attachments / outline) can read the output. Matches the merge op
  // and the test-fixtures generator's posture.
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, pageCount: doc.getPageCount() };
}
