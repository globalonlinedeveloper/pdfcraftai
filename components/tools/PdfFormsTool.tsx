"use client";

// components/tools/PdfFormsTool.tsx
//
// Build 2 Wave 4 (2026-04-27): show all AcroForm fields in a PDF.
// Pure byte-parser tool. Useful for auditing what data a PDF
// collects, verifying form completion, or extracting filled values
// for downstream pipelines.
//
// M21 (#193, 2026-04-29): migrated to PdfReadOpsTool. The unique
// rendering — the Name/Type/Value/Flags table with field flag
// summarization — stays here as renderBody.

import type { ReactNode } from "react";
import type { FormField } from "@/lib/pdf/ops/forms";
import { PdfReadOpsTool } from "./PdfReadOpsTool";
import { ToolHowItWorks } from "./ToolHowItWorks";

interface ParseResult {
  fields: FormField[];
  unsupported: boolean;
  noFormPresent: boolean;
}

export function PdfFormsTool() {
  return (
    <PdfReadOpsTool<ParseResult>
      toolId="pdf-forms"
      toolGroup="Organize"
      prompt="Drop a PDF to inspect its form fields"
      hint="Up to 100 MB · runs privately in your browser"
      busyLabel="Reading form fields…"
      howItWorks={
        <ToolHowItWorks
          steps={[
            {
              title: "Drop in your fillable PDF",
              body: "Up to 100 MB. We parse the AcroForm dictionary locally — your form values stay in your browser.",
            },
            {
              title: "We list every field",
              body: "Name, type (text / checkbox / radio / dropdown / signature), current value, and the flag bits (required / read-only / multiline / no-export).",
            },
            {
              title: "Export filled answers for your pipeline",
              body: "Copy as JSON or download as CSV — useful for capturing form submissions, auditing required-field coverage, or feeding form data into downstream tools.",
            },
          ]}
          privacyNote="Your PDF and its filled values stay in your browser. The AcroForm parser reads structural bytes only — nothing is uploaded or persisted."
        />
      }
      parser={async (bytes) => {
        const { extractFormFields } = await import("@/lib/pdf/ops/forms");
        return extractFormFields(bytes);
      }}
      pageCountForTracker={(r) => r.fields.length}
      headline={(r) => {
        if (r.fields.length === 0) {
          const primary = r.unsupported
            ? "Couldn't parse the form"
            : r.noFormPresent
              ? "No form fields"
              : "Form is empty";
          const detail = r.unsupported
            ? "This PDF uses cross-reference streams or encryption that our byte parser can't follow."
            : "This PDF doesn't have any AcroForm fields.";
          return { primary, detail };
        }
        return {
          primary: `${r.fields.length} field${r.fields.length === 1 ? "" : "s"}`,
        };
      }}
      jsonExport={(r) => r.fields}
      csvExport={(r, fileName) => {
        if (r.fields.length === 0) return null;
        const base = fileName.replace(/\.pdf$/i, "");
        return {
          filename: `${base}.form-fields.csv`,
          header: ["name", "type", "value", "required", "read_only"],
          rows: r.fields.map((f) => [
            f.name,
            f.type,
            f.value,
            f.flags.required ? "yes" : "no",
            f.flags.readOnly ? "yes" : "no",
          ]),
        };
      }}
      renderBody={(r) => renderFieldsTable(r.fields)}
    />
  );
}

function renderFieldsTable(fields: FormField[]): ReactNode {
  if (fields.length === 0) return null;
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
            <th style={cellStyle(true)}>Name</th>
            <th style={cellStyle(true)}>Type</th>
            <th style={cellStyle(true)}>Value</th>
            <th style={cellStyle(true)}>Flags</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f, i) => {
            const flags: string[] = [];
            if (f.flags.required) flags.push("required");
            if (f.flags.readOnly) flags.push("read-only");
            if (f.flags.multiline) flags.push("multiline");
            if (f.flags.password) flags.push("password");
            return (
              <tr
                key={`${f.objectNumber}-${i}`}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td style={cellStyle()} title={f.name}>
                  <span style={{ fontFamily: "var(--mono, monospace)" }}>
                    {f.name}
                  </span>
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
                    {f.type}
                  </span>
                </td>
                <td style={cellStyle()} title={f.value}>
                  {f.value || (
                    <span className="subtle" style={{ fontStyle: "italic" }}>
                      (empty)
                    </span>
                  )}
                </td>
                <td style={cellStyle()}>
                  <span className="subtle" style={{ fontSize: 11 }}>
                    {flags.length === 0 ? "—" : flags.join(", ")}
                  </span>
                </td>
              </tr>
            );
          })}
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
    maxWidth: 280,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}
