"use client";

// components/tools/PdfExtractPagesTool.tsx
//
// Tier 2 (2026-04-27): Extract Pages.
//
// Pure thin wrapper over PageGridTool. Selection style = accent;
// apply calls extractPages from page-selection.ts. Output is a new
// PDF with only the selected pages, in ascending page order.

import { PageGridTool } from "./PageGridTool";

export function PdfExtractPagesTool() {
  return (
    <PageGridTool
      toolId="extract-pages"
      toolGroup="Organize"
      dropPrompt="Drop a PDF to extract pages from"
      helperWhenEmpty="Click thumbnails to mark pages for the new PDF."
      helperWhenSelected={(count, total) =>
        `${count} of ${total} pages selected for extraction`
      }
      selectedBadgeLabel="Keep"
      actionLabel={(count) =>
        `Extract ${count} page${count === 1 ? "" : "s"} into new PDF`
      }
      emptyActionLabel="Pick pages to extract"
      busyLabel="Extracting pages…"
      successCta="Extract from another PDF"
      successDescription={(r) =>
        `Extracted ${r.selectedCount} page${r.selectedCount === 1 ? "" : "s"} from ${r.sourcePageCount}-page PDF`
      }
      selectionStyle="accent"
      errorCode="extract_failed"
      apply={async (bytes, indices, file) => {
        const { extractPages } = await import("@/lib/pdf/ops/page-selection");
        const r = await extractPages(bytes, indices);
        const baseName = file.name.replace(/\.pdf$/i, "");
        return {
          outputBytes: r.bytes,
          outputFileName: `${baseName || "document"}-extracted.pdf`,
          resultPageCount: r.pageCount,
          selectedCount: indices.length,
        };
      }}
    />
  );
}
