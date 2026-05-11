"use client";

// components/tools/PdfFontsTool.tsx
//
// Build 2 Wave 4 (final) (2026-04-27): list every font referenced
// in a PDF, dedupe across pages, flag embedded vs not.
//
// M21 (#193, 2026-04-29): migrated to PdfReadOpsTool. The unique
// rendering — the Font/Subtype/Embedded/Pages table with subset
// callout and embedded color-coding — stays here as renderBody.

import type { ReactNode } from "react";
import type { PdfFont } from "@/lib/pdf/ops/fonts";
import { PdfReadOpsTool } from "./PdfReadOpsTool";
import { ToolHowItWorks } from "./ToolHowItWorks";

interface ParseResult {
  fonts: PdfFont[];
  nonEmbeddedCount: number;
  unsupported: boolean;
}

export function PdfFontsTool() {
  return (
    <PdfReadOpsTool<ParseResult>
      toolId="pdf-fonts"
      toolGroup="Organize"
      prompt="Drop a PDF to inspect its fonts"
      hint="Up to 100 MB · runs privately in your browser"
      busyLabel="Reading fonts…"
      howItWorks={
        <ToolHowItWorks
          steps={[
            {
              title: "Drop in your PDF",
              body: "Up to 100 MB. The byte parser inspects the font dictionary locally — no upload, no PDFium engine required.",
            },
            {
              title: "We dedupe every font reference",
              body: "Font name, subtype (TrueType / Type 0 / Type 1 / CID), encoding, subset flag, and the page numbers each font is used on.",
            },
            {
              title: "Spot non-embedded fonts before they break print",
              body: "Missing embedded fonts get a callout — that's the #1 reason a PDF reflows or substitutes glyphs at the press. Export as JSON or CSV.",
            },
          ]}
          privacyNote="Your PDF never leaves your browser. The font parser reads structural bytes only — nothing is uploaded, logged, or persisted."
        />
      }
      parser={async (bytes) => {
        const { extractFonts } = await import("@/lib/pdf/ops/fonts");
        return extractFonts(bytes);
      }}
      pageCountForTracker={(r) => r.fonts.length}
      headline={(r) => {
        if (r.fonts.length === 0) {
          return {
            primary: r.unsupported ? "Couldn't parse fonts" : "No fonts found",
            detail: r.unsupported
              ? "Cross-reference streams or encryption block our byte parser."
              : undefined,
          };
        }
        const detail =
          r.nonEmbeddedCount > 0 ? (
            <span style={{ color: "var(--accent)" }}>
              {r.nonEmbeddedCount} of {r.fonts.length} not embedded — print may
              substitute glyphs
            </span>
          ) : (
            "All fonts embedded — safe for print"
          );
        return {
          primary: `${r.fonts.length} font${r.fonts.length === 1 ? "" : "s"}`,
          detail,
        };
      }}
      jsonExport={(r) => r.fonts}
      csvExport={(r, fileName) => {
        if (r.fonts.length === 0) return null;
        const base = fileName.replace(/\.pdf$/i, "");
        return {
          filename: `${base}.fonts.csv`,
          header: ["base_font", "subtype", "embedded", "subsetted", "pages"],
          rows: r.fonts.map((f) => [
            f.baseFont,
            f.subtype,
            f.embedded ? "yes" : "no",
            f.subsetted ? "yes" : "no",
            f.pages.join(","),
          ]),
        };
      }}
      renderBody={(r) => renderFontsTable(r.fonts)}
    />
  );
}

function renderFontsTable(fonts: PdfFont[]): ReactNode {
  if (fonts.length === 0) return null;
  return (
    <div style={{ maxHeight: 480, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr
            style={{
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-1)",
            }}
          >
            <th style={cellStyle(true)}>Font</th>
            <th style={cellStyle(true)}>Subtype</th>
            <th style={cellStyle(true)}>Embedded</th>
            <th style={cellStyle(true)}>Pages</th>
          </tr>
        </thead>
        <tbody>
          {fonts.map((f, i) => (
            <tr
              key={`${f.objectNumber}-${i}`}
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <td style={cellStyle()} title={f.baseFont}>
                <span style={{ fontFamily: "var(--mono, monospace)" }}>
                  {f.baseFont}
                </span>
                {f.subsetted && (
                  <span
                    className="subtle"
                    style={{ fontSize: 11, marginLeft: 6 }}
                  >
                    (subset)
                  </span>
                )}
              </td>
              <td style={cellStyle()}>
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
                  {f.subtype || "—"}
                </span>
              </td>
              <td style={cellStyle()}>
                {f.embedded ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "rgba(74, 222, 128, 0.12)",
                      color: "rgb(74, 222, 128)",
                    }}
                  >
                    ✓ embedded
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "rgba(251, 146, 60, 0.12)",
                      color: "rgb(251, 146, 60)",
                    }}
                  >
                    ✗ not embedded
                  </span>
                )}
              </td>
              <td style={cellStyle()}>
                <span className="subtle" style={{ fontSize: 11 }}>
                  {f.pages.length === 1
                    ? `p. ${f.pages[0]}`
                    : f.pages.length <= 5
                      ? `pp. ${f.pages.join(", ")}`
                      : `${f.pages.length} pages`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cellStyle(isHeader = false): React.CSSProperties {
  return {
    padding: "10px 16px",
    textAlign: "left",
    fontWeight: isHeader ? 500 : 400,
    fontSize: isHeader ? 11 : 13,
    letterSpacing: isHeader ? "0.05em" : undefined,
    textTransform: isHeader ? ("uppercase" as const) : undefined,
    color: isHeader ? "var(--fg-muted)" : "var(--fg)",
    verticalAlign: "top",
  };
}
