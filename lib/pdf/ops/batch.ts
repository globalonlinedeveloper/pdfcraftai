// lib/pdf/ops/batch.ts
//
// 2026-05-01 Tier 3: orchestrator that runs a chosen single-config op
// across many input PDFs. Pure composition — every supported op
// already exists; this just iterates with per-file error isolation
// (one bad file doesn't fail the whole batch).
//
// Curated op set: only operations that take a single config knob and
// produce predictable per-file output. Multi-config ops (resize,
// crop, watermark with multiple knobs) are out of scope — those have
// their own dedicated tools where the per-file UX makes sense. Bulk
// versions of those would need a different UX shape (per-file config
// vs. shared config across the batch).

import { rotatePdf } from "./rotate";
import { addPageNumbers } from "./page-numbers";
import { stampPdf } from "./stamp";
import { removePdfMetadata } from "./remove-metadata";
import { flattenPdf } from "./flatten";
import { stripLinks } from "./strip-links";

export type BatchOpId =
  | "rotate-90"
  | "rotate-180"
  | "rotate-270"
  | "page-numbers"
  | "watermark"
  | "remove-metadata"
  | "flatten-forms"
  | "strip-links";

export interface BatchInput {
  /** Original filename for output naming + error attribution. */
  name: string;
  bytes: Uint8Array;
}

export interface BatchOptions {
  op: BatchOpId;
  /** Watermark text. Required when op === "watermark". */
  watermarkText?: string;
}

export interface BatchOutputItem {
  /** Original input filename. */
  inputName: string;
  /** Suggested output filename (op-specific suffix). */
  outputName: string;
  /** Output bytes. Undefined when this item failed. */
  bytes?: Uint8Array;
  /** Error message when bytes is undefined. */
  error?: string;
}

export interface BatchResult {
  items: BatchOutputItem[];
  /** Number of inputs that produced output bytes. */
  successCount: number;
  /** Number of inputs that failed. */
  failureCount: number;
}

function deriveOutputName(inputName: string, op: BatchOpId): string {
  const base = inputName.replace(/\.pdf$/i, "");
  switch (op) {
    case "rotate-90":
    case "rotate-180":
    case "rotate-270":
      return `${base}-rotated.pdf`;
    case "page-numbers":
      return `${base}-numbered.pdf`;
    case "watermark":
      return `${base}-watermarked.pdf`;
    case "remove-metadata":
      return `${base}-clean.pdf`;
    case "flatten-forms":
      return `${base}-flattened.pdf`;
    case "strip-links":
      return `${base}-no-links.pdf`;
  }
}

async function applyOp(
  bytes: Uint8Array,
  options: BatchOptions,
): Promise<Uint8Array> {
  switch (options.op) {
    case "rotate-90":
      return (await rotatePdf(bytes, { angle: 90 })).bytes;
    case "rotate-180":
      return (await rotatePdf(bytes, { angle: 180 })).bytes;
    case "rotate-270":
      return (await rotatePdf(bytes, { angle: 270 })).bytes;
    case "page-numbers":
      return (
        await addPageNumbers(bytes, {
          position: "bottom-right",
          format: "Page 1 of N",
          fontSize: 11,
        })
      ).bytes;
    case "watermark":
      if (!options.watermarkText) {
        throw new Error("Watermark text is required.");
      }
      return (
        await stampPdf(bytes, {
          text: options.watermarkText,
          position: "diagonal",
          opacity: 0.3,
        })
      ).bytes;
    case "remove-metadata":
      return (await removePdfMetadata(bytes)).bytes;
    case "flatten-forms":
      return (await flattenPdf(bytes)).bytes;
    case "strip-links":
      return (await stripLinks(bytes)).bytes;
  }
}

/**
 * Run the chosen op against every input. Per-file error isolation —
 * one bad file doesn't fail the batch.
 */
export async function batchProcess(
  inputs: BatchInput[],
  options: BatchOptions,
): Promise<BatchResult> {
  if (inputs.length === 0) throw new Error("No input files.");
  const items: BatchOutputItem[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const input of inputs) {
    const outputName = deriveOutputName(input.name, options.op);
    try {
      const outBytes = await applyOp(input.bytes, options);
      items.push({
        inputName: input.name,
        outputName,
        bytes: outBytes,
      });
      successCount += 1;
    } catch (err) {
      items.push({
        inputName: input.name,
        outputName,
        error: err instanceof Error ? err.message : String(err),
      });
      failureCount += 1;
    }
  }

  return { items, successCount, failureCount };
}
