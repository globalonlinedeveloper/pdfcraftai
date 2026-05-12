// lib/client/format-bytes.ts
//
// 2026-05-12 — T2-4 first real extraction. `formatSize(bytes)` was
// duplicated VERBATIM across 7 tool components (PdfHighlightTool,
// PdfAddLinksTool, PdfSignTool, PdfRedactTool, PdfAddTextBoxTool,
// PdfFreeDrawTool, PdfCropTool). Identical bodies, identical
// signatures, identical edge cases — pure copy-paste. Consolidating
// here cuts ~5 LOC × 7 files = ~35 LOC of redundancy and lowers the
// per-file LOC ceilings.
//
// Pure-logic helper — no side effects, no state, no DOM access. Safe
// to call from both server and client components. Lives under
// lib/client/ alongside the other shared client-side utilities
// (handoff.ts, csv.ts, download.ts) so the import path is short.

/**
 * Human-readable byte size. Renders bytes / KB / MB with one decimal
 * past the KB threshold. No suffix beyond MB — files larger than
 * ~1 GB would render as "1024.0 MB" which is intentionally ugly: the
 * site's per-tool size caps are well under 1 GB, so a 4-digit MB
 * value indicates a bug to investigate, not a number to format.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
