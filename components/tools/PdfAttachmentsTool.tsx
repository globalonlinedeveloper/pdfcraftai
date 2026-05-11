"use client";

// components/tools/PdfAttachmentsTool.tsx
//
// Build 2 Wave 4 (2026-04-27): list embedded files in a PDF. Pure
// byte-parser tool — no PDFium needed.
//
// 2026-04-30 (audit cluster A): migrated to PdfReadOpsTool. Was
// 422 LOC of bespoke drop+busy+error+copy+JSON-download
// boilerplate; collapsed to ~115 LOC of slot-fills (parser +
// headline + renderBody + jsonExport + csvExport). The unique
// surface — the file-list with filename/description/mime/size and
// the "we don't extract bytes" disclaimer — stays here as
// renderBody. Picked up handoff/file-URL/preview infra for free.

import type { ReactNode } from "react";
import { I } from "@/components/icons/Icons";
import { humanSize } from "@/lib/client/pdf-utils";
import type { PdfAttachment } from "@/lib/pdf/ops/attachments";
import { PdfReadOpsTool } from "./PdfReadOpsTool";
import { ToolHowItWorks } from "./ToolHowItWorks";

interface ParseResult {
  attachments: PdfAttachment[];
  unsupported: boolean;
}

export function PdfAttachmentsTool() {
  return (
    <PdfReadOpsTool<ParseResult>
      toolId="pdf-attachments"
      toolGroup="Organize"
      prompt="Drop a PDF to list embedded files"
      hint="Up to 100 MB · runs privately in your browser"
      busyLabel="Reading attachments…"
      howItWorks={
        <ToolHowItWorks
          steps={[
            {
              title: "Drop in your PDF",
              body: "Invoices with XML payloads, e-archives, ZUGFeRD or FacturX e-invoices, portfolios with exhibits — anything with embedded files.",
            },
            {
              title: "We list every attachment",
              body: "Filename, MIME type, description, size and the anchor (page or document-level) for each embedded file are parsed from the PDF's name tree.",
            },
            {
              title: "Audit what's inside before opening",
              body: "Copy the inventory as JSON or download as CSV — handy for compliance, due-diligence, and pre-open security review. Pair with Extract Attachments to pull the bytes out.",
            },
          ]}
          privacyNote="Your PDF never leaves your browser. We only read the structural name tree to enumerate attachments — nothing is uploaded or persisted."
        />
      }
      parser={async (bytes) => {
        const { extractAttachments } = await import(
          "@/lib/pdf/ops/attachments"
        );
        const r = extractAttachments(bytes);
        return {
          attachments: r.attachments,
          unsupported: r.unsupported,
        };
      }}
      pageCountForTracker={(r) => r.attachments.length}
      headline={(r) => {
        if (r.attachments.length === 0) {
          return {
            primary: r.unsupported
              ? "Couldn't parse attachments"
              : "No embedded files",
            detail: r.unsupported
              ? "This PDF uses cross-reference streams or encryption that our byte parser can't follow."
              : "This PDF has no embedded file attachments.",
          };
        }
        return {
          primary: `${r.attachments.length} attachment${r.attachments.length === 1 ? "" : "s"}`,
        };
      }}
      jsonExport={(r) => r.attachments}
      csvExport={(r, fileName) => {
        if (r.attachments.length === 0) return null;
        const base = fileName.replace(/\.pdf$/i, "");
        return {
          filename: `${base}.attachments.csv`,
          header: ["filename", "description", "mime_type", "size_bytes"],
          rows: r.attachments.map((a) => [
            a.filename,
            a.description ?? "",
            a.mimeType ?? "",
            a.sizeBytes >= 0 ? a.sizeBytes : "",
          ]),
        };
      }}
      renderBody={(r) => renderAttachmentsList(r.attachments)}
      errorCode="attachments_failed"
    />
  );
}

function renderAttachmentsList(attachments: PdfAttachment[]): ReactNode {
  if (attachments.length === 0) return null;
  return (
    <>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          maxHeight: 480,
          overflowY: "auto",
        }}
      >
        {attachments.map((a, i) => (
          <li
            key={`${a.filespecObjectNumber}-${i}`}
            style={{
              padding: "12px 24px",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 12,
              alignItems: "start",
            }}
          >
            <span
              style={{
                color: "var(--fg-subtle)",
                flexShrink: 0,
                paddingTop: 2,
              }}
            >
              <I.File size={16} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "var(--mono, monospace)",
                  wordBreak: "break-word",
                }}
              >
                {a.filename || (
                  <em className="subtle">(unnamed attachment)</em>
                )}
              </div>
              {a.description && (
                <div
                  className="muted"
                  style={{ fontSize: 12, marginTop: 3 }}
                >
                  {a.description}
                </div>
              )}
              {a.mimeType && (
                <div
                  className="subtle"
                  style={{ fontSize: 11, marginTop: 3 }}
                >
                  {a.mimeType}
                </div>
              )}
            </div>
            <span
              className="subtle"
              style={{ fontSize: 12, whiteSpace: "nowrap" }}
            >
              {a.sizeBytes >= 0 ? humanSize(a.sizeBytes) : "—"}
            </span>
          </li>
        ))}
      </ul>
      {/* Honest disclaimer about not extracting bytes. */}
      <div
        style={{
          padding: "10px 24px",
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--fg-muted)",
          background: "var(--bg-1)",
        }}
      >
        <I.Info
          size={12}
          style={{ verticalAlign: "middle", marginRight: 6 }}
        />
        We list attachments but don&apos;t extract the file bytes —
        that&apos;s separate work. Open the PDF in Acrobat/Preview to save
        individual attachments.
      </div>
    </>
  );
}
