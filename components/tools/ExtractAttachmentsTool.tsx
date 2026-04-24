"use client";

// ExtractAttachmentsTool — Tier 1 §1.8 P2.
//
// PDFs can carry embedded files in the `/EmbeddedFiles` name tree —
// invoices attached to forms, raw data attached to reports, etc.
// These are orthogonal to the page content; most viewers show them
// in a sidebar. This tool lists every embedded file and lets the
// user download any of them individually.
//
// We use pdfjs `pdf.getAttachments()` because pdf-lib's attachment
// API is write-focused; reading the name tree via pdf-lib requires
// low-level PDFDict walking. pdfjs returns a nice
// `{ filename: { filename, content: Uint8Array, description? } }`
// map.

import { useState, useCallback } from "react";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import {
  downloadBytes,
  humanSize,
  sha256HexOfBytes,
} from "@/lib/client/pdf-utils";
import { logToolResultAction } from "@/lib/tool-result-actions";

type Attachment = {
  filename: string;
  size: number;
  description: string | null;
  bytes: Uint8Array;
};

export function ExtractAttachmentsTool() {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [sourceName, setSourceName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setError(null);
    setAttachments(null);
    setBusy(true);
    try {
      const buffer = await f.arrayBuffer();
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs-worker.min.mjs";
      }
      const src = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
      const raw = (await src.getAttachments()) as Record<
        string,
        { filename: string; content: Uint8Array; description?: string } | undefined
      > | null;

      const list: Attachment[] = [];
      if (raw) {
        for (const key of Object.keys(raw)) {
          const entry = raw[key];
          if (!entry) continue;
          list.push({
            filename: entry.filename ?? key,
            size: entry.content?.byteLength ?? 0,
            description: entry.description ?? null,
            bytes: entry.content ?? new Uint8Array(),
          });
        }
      }
      setAttachments(list);
      setSourceName(f.name);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error && /encrypted|password/i.test(err.message)
          ? "This PDF is password-protected. Unlock it first."
          : "Couldn't read that PDF. It may be corrupt."
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = () => {
    setAttachments(null);
    setSourceName("");
    setError(null);
  };

  const download = async (a: Attachment) => {
    // Best-effort MIME from filename extension — browsers will still
    // prompt to save either way.
    const ext = a.filename.split(".").pop()?.toLowerCase() ?? "";
    const mime =
      ext === "pdf"
        ? "application/pdf"
        : ext === "csv"
          ? "text/csv"
          : ext === "json"
            ? "application/json"
            : ext === "txt"
              ? "text/plain"
              : "application/octet-stream";
    downloadBytes(a.bytes, a.filename, mime);
    try {
      const sha256 = await sha256HexOfBytes(a.bytes);
      await logToolResultAction({
        toolId: "extract-attachments",
        name: a.filename,
        mime,
        sizeBytes: a.bytes.length,
        sha256,
      });
    } catch (logErr) {
      console.warn("logToolResult failed (non-fatal):", logErr);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {attachments === null ? (
        <ToolDropzone
          onFiles={onFiles}
          disabled={busy}
          prompt="Drop a PDF to list + extract embedded files"
        />
      ) : attachments.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <I.Info size={18} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
                No embedded files
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                <code>{sourceName}</code> has no <code>/EmbeddedFiles</code> name
                tree. This is the normal state for most PDFs — embedded files
                are a specific feature authors opt into, typically for
                invoice-plus-data or form-plus-attachment workflows.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={reset}
            >
              Try another file
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            className="card"
            style={{ padding: "14px 16px", display: "flex", gap: 12, alignItems: "center" }}
          >
            <span style={{ color: "var(--fg-subtle)" }}>
              <I.File size={18} />
            </span>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div
                title={sourceName}
                style={{
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {sourceName}
              </div>
              <div className="subtle" style={{ fontSize: 12 }}>
                {attachments.length} embedded file
                {attachments.length === 1 ? "" : "s"} found
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={reset}
              aria-label="Clear"
            >
              <I.X size={14} />
            </button>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-2)" }}>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 500, color: "var(--fg-subtle)" }}>
                    Name
                  </th>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 500, color: "var(--fg-subtle)" }}>
                    Description
                  </th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 500, color: "var(--fg-subtle)" }}>
                    Size
                  </th>
                  <th style={{ padding: "8px 12px" }} />
                </tr>
              </thead>
              <tbody>
                {attachments.map((a, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono), ui-monospace, monospace", wordBreak: "break-all" }}>
                      {a.filename}
                    </td>
                    <td style={{ padding: "8px 12px", color: "var(--fg-subtle)" }}>
                      {a.description ?? "—"}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>
                      {humanSize(a.size)}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => download(a)}
                      >
                        <I.Download size={12} />
                        <span>Save</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
