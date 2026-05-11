"use client";

// components/tools/ExtractDatesTool.tsx
//
// 2026-05-01 — Extract Dates: regex-based date extraction with ICS
// calendar export. Runs entirely in the browser. Slot-fill on
// PdfReadOpsTool with a custom .ics download button rendered inside
// renderBody (PdfReadOpsTool template only knows about CSV + JSON
// exports natively, so we wire ICS as an action button on the table).

import { useState, type ReactNode } from "react";
import type {
  ExtractedDate,
  ExtractDatesResult,
} from "@/lib/pdf/ops/dates";
import { generateIcs } from "@/lib/pdf/ops/dates";
import { downloadBytes } from "@/lib/client/download";
import { PdfReadOpsTool } from "./PdfReadOpsTool";
import { ToolHowItWorks } from "./ToolHowItWorks";
import { I } from "@/components/icons/Icons";

export function ExtractDatesTool() {
  // Track the last-uploaded file name so we can title the .ics export
  // properly. PdfReadOpsTool exposes the result + filename via the
  // export-builder callbacks but not via renderBody; we capture it in
  // the csvExport hook (which always gets called when there's data,
  // even if the user only wants .ics).
  const [filenameRef] = useState<{ current: string }>({ current: "extracted" });

  return (
    <PdfReadOpsTool<ExtractDatesResult>
      toolId="extract-dates"
      toolGroup="Organize"
      prompt="Drop a PDF to extract every date"
      hint="Up to 100 MB · runs privately in your browser"
      busyLabel="Scanning for dates…"
      howItWorks={
        <ToolHowItWorks
          steps={[
            {
              title: "Drop in your PDF",
              body: "Contracts, schedules, project plans, court orders, invoices — anything with dates inside. Up to 100 MB, processed in your browser.",
            },
            {
              title: "We find every date format",
              body: "ISO, US (MM/DD/YYYY), EU (DD/MM/YYYY), long-form (May 11, 2026), partial (Q3 2026) — each anchored to the page it appears on with surrounding context.",
            },
            {
              title: "Export as calendar (.ics), CSV, or JSON",
              body: "Drop the .ics into Google Calendar or Outlook to see every date in your calendar view, or hand the CSV/JSON to your downstream workflow.",
            },
          ]}
          privacyNote="Everything stays in your browser. The text scan and ICS generation run locally — nothing is uploaded or persisted."
        />
      }
      parser={async (bytes) => {
        const { extractDates } = await import("@/lib/pdf/ops/dates");
        return extractDates(bytes);
      }}
      pageCountForTracker={(r) => r.dates.length}
      headline={(r) => {
        if (r.scannedPdfLikely) {
          return {
            primary: "No text extractable",
            detail:
              "This PDF is likely scanned (image-only). Run AI PDF OCR first to add a text layer, then re-run Extract Dates.",
          };
        }
        if (r.dates.length === 0) {
          return {
            primary: "No dates found",
            detail: `Scanned ${r.pageCount} page${r.pageCount === 1 ? "" : "s"} — no recognizable dates detected.`,
          };
        }
        const ambiguousCount = r.dates.filter((d) => d.ambiguous).length;
        const detail =
          ambiguousCount > 0 ? (
            <span>
              Across {r.pageCount} page{r.pageCount === 1 ? "" : "s"}.{" "}
              <span style={{ color: "var(--accent)" }}>
                {ambiguousCount} ambiguous (DD/MM vs MM/DD) — review the table.
              </span>
            </span>
          ) : (
            `Across ${r.pageCount} page${r.pageCount === 1 ? "" : "s"}.`
          );
        return {
          primary: `${r.dates.length} date${r.dates.length === 1 ? "" : "s"}`,
          detail,
        };
      }}
      jsonExport={(r) => r.dates}
      csvExport={(r, fileName) => {
        // Capture filename for the .ics download button (renderBody
        // doesn't get fileName directly).
        filenameRef.current = fileName.replace(/\.pdf$/i, "");
        if (r.dates.length === 0) return null;
        return {
          filename: `${filenameRef.current}.dates.csv`,
          header: [
            "iso_date",
            "raw_match",
            "format",
            "ambiguous",
            "alt_iso",
            "context",
            "count",
            "pages",
          ],
          rows: r.dates.map((d) => [
            d.iso,
            d.raw,
            d.format,
            d.ambiguous ? "yes" : "no",
            d.altIso ?? "",
            d.context,
            String(d.count),
            d.pages.join(","),
          ]),
        };
      }}
      renderBody={(r) => renderBody(r, filenameRef)}
    />
  );
}

function renderBody(
  r: ExtractDatesResult,
  filenameRef: { current: string },
): ReactNode {
  if (r.scannedPdfLikely || r.dates.length === 0) return null;

  const handleDownloadIcs = () => {
    const ics = generateIcs(r.dates, filenameRef.current);
    const bytes = new TextEncoder().encode(ics);
    downloadBytes(
      bytes,
      `${filenameRef.current}.ics`,
      "text/calendar;charset=utf-8",
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ICS download — primary action for this tool */}
      <div
        className="card"
        style={{
          padding: 12,
          background: "var(--accent-soft)",
          borderColor: "var(--accent)",
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span
            aria-hidden
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--accent)",
              color: "var(--bg-1)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <I.Convert size={16} />
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Download as .ics calendar
            </div>
            <div className="subtle" style={{ fontSize: 12 }}>
              Each date becomes an all-day event with surrounding context.
              Imports into Google Calendar / Apple Calendar / Outlook.
            </div>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={handleDownloadIcs}
        >
          <I.Convert size={14} /> Download .ics
        </button>
      </div>

      {/* Dates table */}
      <div style={{ maxHeight: 480, overflowY: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-1)",
              }}
            >
              <th style={cellStyle(true)}>Date</th>
              <th style={cellStyle(true)}>As found</th>
              <th style={cellStyle(true)}>Context</th>
              <th style={cellStyle(true)}>Pages</th>
            </tr>
          </thead>
          <tbody>
            {r.dates.map((d, i) => (
              <tr
                key={`${d.iso}-${i}`}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td style={cellStyle()}>
                  <span style={{ fontFamily: "var(--mono, monospace)" }}>
                    {d.iso}
                  </span>
                  {d.ambiguous && d.altIso && (
                    <div
                      className="subtle"
                      style={{ fontSize: 11, marginTop: 2 }}
                      title={`Ambiguous DD/MM vs MM/DD. Day-first: ${d.iso}; Month-first: ${d.altIso}.`}
                    >
                      or {d.altIso} (ambiguous)
                    </div>
                  )}
                </td>
                <td style={cellStyle()}>
                  <span style={{ fontFamily: "var(--mono, monospace)" }}>
                    {d.raw}
                  </span>
                  <div className="subtle" style={{ fontSize: 11, marginTop: 2 }}>
                    {d.format}
                  </div>
                </td>
                <td style={cellStyle()}>
                  <span className="subtle" style={{ fontSize: 12 }}>
                    {d.context || "—"}
                  </span>
                </td>
                <td style={cellStyle()}>
                  <span className="subtle" style={{ fontSize: 11 }}>
                    {formatPageList(d.pages)}
                    {d.count > d.pages.length && (
                      <span style={{ marginLeft: 4 }}>· {d.count}×</span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatPageList(pages: number[]): string {
  if (pages.length === 1) return `p. ${pages[0]}`;
  if (pages.length <= 5) return `pp. ${pages.join(", ")}`;
  return `${pages.length} pages`;
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
