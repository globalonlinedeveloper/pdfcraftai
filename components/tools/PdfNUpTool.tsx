"use client";

// components/tools/PdfNUpTool.tsx
// Tier 5 (2026-04-28): N-up — pack 2 or 4 source pages onto each
// output sheet via pdf-lib embedPdf + drawPage.
//
// 2026-04-30 (audit cluster C): migrated to PdfSimpleOpsTool with
// the new `configPanel` slot. Was 169 LOC of bespoke
// drop+config+busy+error+result+download boilerplate; collapsed to
// ~85 LOC of slot-fills + a small layout selector. Picks up
// inspect/handoff-suggestions/error-mapping/scroll-error-into-view
// for free. Same deal as PdfResizeTool — both unlocked by the
// configPanel slot in PdfSimpleOpsTool.

import { useState } from "react";
import type { NUpLayout } from "@/lib/pdf/ops/n-up";
import { PdfSimpleOpsTool } from "./PdfSimpleOpsTool";

export function PdfNUpTool() {
  const [layout, setLayout] = useState<NUpLayout>("2");

  return (
    <PdfSimpleOpsTool
      toolId="n-up-pdf"
      toolGroup="Edit"
      dropPrompt="Drop a PDF to lay out N-up"
      busyLabel={`Building ${layout}-up layout…`}
      // Function form — re-evaluates on every render so the label
      // tracks the layout selector live.
      actionLabel={() => `Build ${layout}-up PDF`}
      successCta="N-up another PDF"
      errorCode="n_up_failed"
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
          <div style={{ fontSize: 13, fontWeight: 500 }}>Pages per sheet</div>
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className={`btn btn-sm ${layout === "2" ? "btn-primary" : "btn-outline"}`}
              onClick={() => setLayout("2")}
            >
              2-up (vertical stack)
            </button>
            <button
              type="button"
              className={`btn btn-sm ${layout === "4" ? "btn-primary" : "btn-outline"}`}
              onClick={() => setLayout("4")}
            >
              4-up (2×2 grid)
            </button>
          </div>
          <div className="subtle" style={{ fontSize: 12 }}>
            Output sheet size matches your source.{" "}
            {layout === "2"
              ? "2 source pages per output sheet."
              : "4 source pages per output sheet."}
          </div>
        </div>
      }
      apply={async (bytes, file) => {
        const { nUpPdf } = await import("@/lib/pdf/ops/n-up");
        const r = await nUpPdf(bytes, { layout });
        const baseName = file.name.replace(/\.pdf$/i, "");
        return {
          outputBytes: r.bytes,
          outputFileName: `${baseName || "document"}-${layout}up.pdf`,
          headline: `${r.sourcePageCount} pages → ${r.pageCount} sheets (${layout}-up)`,
          detail: `${r.pageCount} output page${r.pageCount === 1 ? "" : "s"}`,
        };
      }}
    />
  );
}
