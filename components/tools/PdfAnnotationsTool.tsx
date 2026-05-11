"use client";

// components/tools/PdfAnnotationsTool.tsx — Build 2 Wave 8
//
// M21 (#193, 2026-04-29): migrated to PdfReadOpsTool. ~340 LOC of
// boilerplate collapsed to a slot-fill. The unique rendering — the
// per-page grouped annotation list with color swatch + author +
// creation date — stays here as renderBody.

import type { ReactNode } from "react";
import type { PdfAnnotation } from "@/lib/pdf/ops/annotations";
import { PdfReadOpsTool } from "./PdfReadOpsTool";
import { ToolHowItWorks } from "./ToolHowItWorks";

interface ParseResult {
  annotations: PdfAnnotation[];
  unsupported: boolean;
}

export function PdfAnnotationsTool() {
  return (
    <PdfReadOpsTool<ParseResult>
      toolId="pdf-annotations"
      toolGroup="Organize"
      prompt="Drop a PDF to export its annotations"
      hint="Up to 100 MB · runs privately in your browser"
      busyLabel="Reading annotations…"
      howItWorks={
        <ToolHowItWorks
          steps={[
            {
              title: "Drop in your reviewed PDF",
              body: "Up to 100 MB. We parse the annotation dictionary locally — no upload, no server-side OCR.",
            },
            {
              title: "We pull every comment + markup",
              body: "Highlights, sticky notes, free-text, stamps, ink — each with author, creation date, page number, and color preserved.",
            },
            {
              title: "Copy as JSON or download CSV",
              body: "Hand the structured data straight to your reviewer-tracking spreadsheet, contract redline workflow, or compliance log.",
            },
          ]}
          privacyNote="Your PDF never leaves your browser. The annotation parser reads structural bytes only — nothing is uploaded or persisted."
        />
      }
      parser={async (bytes) => {
        const { extractAnnotations } = await import(
          "@/lib/pdf/ops/annotations"
        );
        return extractAnnotations(bytes);
      }}
      pageCountForTracker={(r) => r.annotations.length}
      headline={(r) => {
        if (r.annotations.length === 0) {
          return {
            primary: r.unsupported
              ? "Couldn't parse annotations"
              : "No annotations found",
          };
        }
        return {
          primary: `${r.annotations.length} annotation${r.annotations.length === 1 ? "" : "s"}`,
        };
      }}
      jsonExport={(r) => r.annotations}
      csvExport={(r, fileName) => {
        if (r.annotations.length === 0) return null;
        const base = fileName.replace(/\.pdf$/i, "");
        return {
          filename: `${base}.annotations.csv`,
          header: ["page", "type", "author", "date", "content", "color"],
          rows: r.annotations.map((a) => [
            a.pageNumber,
            a.subtype,
            a.author,
            a.creationDate || a.modDate || "",
            a.contents,
            a.colorHex || "",
          ]),
        };
      }}
      renderBody={(r) => renderAnnotationsList(r.annotations)}
    />
  );
}

function renderAnnotationsList(annotations: PdfAnnotation[]): ReactNode {
  if (annotations.length === 0) return null;
  // Group by page for display.
  const byPage = annotations.reduce<Record<number, PdfAnnotation[]>>(
    (acc, a) => {
      (acc[a.pageNumber] ||= []).push(a);
      return acc;
    },
    {},
  );
  return (
    <div style={{ maxHeight: 480, overflowY: "auto", padding: "8px 0" }}>
      {Object.entries(byPage).map(([page, anns]) => (
        <div
          key={page}
          style={{
            padding: "10px 24px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div
            className="mono subtle"
            style={{
              fontSize: 11,
              letterSpacing: "0.05em",
              marginBottom: 8,
            }}
          >
            PAGE {page} · {anns.length} annotation
            {anns.length === 1 ? "" : "s"}
          </div>
          {anns.map((a, i) => (
            <div
              key={i}
              style={{
                padding: "8px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                fontSize: 13,
              }}
            >
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                {a.colorHex && (
                  <span
                    aria-hidden
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: a.colorHex,
                      flexShrink: 0,
                      border: "1px solid var(--border)",
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "var(--bg-2)",
                    color: "var(--fg-muted)",
                  }}
                >
                  {a.subtype}
                </span>
                {a.author && (
                  <span className="subtle" style={{ fontSize: 12 }}>
                    by {a.author}
                  </span>
                )}
                {a.creationDate && (
                  <span
                    className="subtle"
                    style={{ fontSize: 11, marginLeft: "auto" }}
                  >
                    {new Date(a.creationDate).toLocaleDateString()}
                  </span>
                )}
              </div>
              {a.contents && (
                <div
                  className="muted"
                  style={{
                    marginTop: 6,
                    fontSize: 13,
                    lineHeight: 1.55,
                    paddingLeft: a.colorHex ? 18 : 0,
                  }}
                >
                  {a.contents}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
