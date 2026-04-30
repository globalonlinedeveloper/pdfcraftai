"use client";

// components/tools/PdfResizeTool.tsx
// Tier 5 (2026-04-28): resize every page to a target paper size,
// scaling content to fit while preserving aspect ratio.
//
// 2026-04-30 (audit cluster C): migrated to PdfSimpleOpsTool with
// the new `configPanel` slot. Was 187 LOC of bespoke
// drop+config+busy+error+result+download boilerplate; collapsed to
// ~95 LOC of slot-fills + a paper-size selector. Picks up
// inspect/handoff-suggestions/error-mapping/scroll-error-into-view
// for free.

import { useState } from "react";
import type { PaperSize } from "@/lib/pdf/ops/resize";
import { PdfSimpleOpsTool } from "./PdfSimpleOpsTool";

const SIZES: Array<{ v: PaperSize; label: string; pt: string }> = [
  { v: "letter", label: "Letter", pt: "612 × 792" },
  { v: "legal", label: "Legal", pt: "612 × 1008" },
  { v: "a4", label: "A4", pt: "595 × 842" },
  { v: "a3", label: "A3", pt: "842 × 1191" },
  { v: "a5", label: "A5", pt: "420 × 595" },
];

export function PdfResizeTool() {
  const [size, setSize] = useState<PaperSize>("letter");
  const [landscape, setLandscape] = useState(false);

  const sizeLabel = SIZES.find((s) => s.v === size)?.label ?? size;

  return (
    <PdfSimpleOpsTool
      toolId="resize-pdf"
      toolGroup="Edit"
      dropPrompt="Drop a PDF to resize"
      busyLabel="Resizing pages…"
      // Function form so the label stays in sync with the size /
      // landscape selectors.
      actionLabel={() =>
        `Resize to ${sizeLabel}${landscape ? " (landscape)" : ""}`
      }
      successCta="Resize another PDF"
      errorCode="resize_failed"
      configPanel={
        <div
          className="card"
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500 }}>Target size</div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {SIZES.map((opt) => (
              <button
                key={opt.v}
                type="button"
                className={`btn btn-sm ${size === opt.v ? "btn-primary" : "btn-outline"}`}
                onClick={() => setSize(opt.v)}
                title={`${opt.pt} pt`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
          >
            <input
              type="checkbox"
              checked={landscape}
              onChange={(e) => setLandscape(e.target.checked)}
            />
            Landscape orientation
          </label>
          <div className="subtle" style={{ fontSize: 12 }}>
            Content scales to fit while preserving aspect ratio. Margins fill
            the rest.
          </div>
        </div>
      }
      apply={async (bytes, file) => {
        const { resizePdf } = await import("@/lib/pdf/ops/resize");
        const r = await resizePdf(bytes, { size, landscape });
        const baseName = file.name.replace(/\.pdf$/i, "");
        return {
          outputBytes: r.bytes,
          outputFileName: `${baseName || "document"}-${size}.pdf`,
          headline: `Resized ${r.pageCount} page${r.pageCount === 1 ? "" : "s"} to ${sizeLabel}`,
          detail: `${Math.round(r.width)}×${Math.round(r.height)} pt`,
        };
      }}
    />
  );
}
