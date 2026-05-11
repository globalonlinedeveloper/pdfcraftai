"use client";

// components/tools/ExtractAttachmentsTool.tsx
//
// 2026-05-01 — Extract Attachments: download embedded files from a
// PDF as actual bytes (vs the existing pdf-attachments tool which
// only LISTS them). Per-file download buttons + bulk ZIP download
// for multi-attachment PDFs.
//
// Closes the long-standing FAQ in pdf-attachments: "Does it download
// the actual file bytes? Not yet — extracting the streams requires
// handling FlateDecode and other compression filters." Today, that
// stream-extraction work shipped (lib/pdf/ops/extract-attachments.ts)
// and this UI surfaces it.
//
// Bespoke runner (not PdfReadOpsTool slot-fill) because the per-file
// download + ZIP bundle action layer doesn't fit the inspector
// template's CSV/JSON-export contract — each attachment is its own
// downloadable artifact, not a row of metadata.

import { useState, useCallback, useEffect } from "react";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import { ToolHowItWorks } from "./ToolHowItWorks";
import { humanSize } from "@/lib/client/pdf-utils";
import { downloadBytes } from "@/lib/client/download";
import { useToolTracking } from "./useToolTracking";
import { mapPdfOpError } from "@/lib/pdf/error-messages";
import { UploadedFilePreview } from "./UploadedFilePreview";
import type { ExtractAttachmentsResult } from "@/lib/pdf/ops/extract-attachments";

export function ExtractAttachmentsTool() {
  const trackTool = useToolTracking("extract-attachments", "Free");
  useEffect(() => trackTool.view(), [trackTool]);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractAttachmentsResult | null>(null);

  const onFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setError(null);
      setResult(null);
      setFile(f);
      trackTool.upload(f);
    },
    [trackTool],
  );

  const reset = () => {
    setFile(null);
    setError(null);
    setResult(null);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

    try {
      const buf = await file.arrayBuffer();
      const { extractAttachmentBytes } = await import(
        "@/lib/pdf/ops/extract-attachments"
      );
      const r = await extractAttachmentBytes(new Uint8Array(buf));
      const processingMs = Math.round(
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
      );
      setResult(r);
      trackTool.success({ processingMs, pageCount: r.totalCount, creditCost: 0 });
    } catch (err) {
      console.error(err);
      setError(mapPdfOpError(err instanceof Error ? err.message : "Failed to extract attachments."));
      trackTool.error({ errorCode: "extract_failed" });
    } finally {
      setBusy(false);
    }
  };

  const downloadOne = (idx: number) => {
    if (!result) return;
    const att = result.attachments[idx];
    if (!att.bytes) return;
    const mime = att.mimeType || "application/octet-stream";
    downloadBytes(att.bytes, sanitizeFilename(att.filename), mime);
  };

  const downloadAllZip = async () => {
    if (!result) return;
    const extractable = result.attachments.filter((a) => a.bytes !== null);
    if (extractable.length === 0) return;

    // Lazy-load JSZip — only pulled in when user clicks the bulk-download
    // button, keeps the initial runner bundle lean.
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const usedNames = new Set<string>();
    for (const att of extractable) {
      let name = sanitizeFilename(att.filename);
      // Dedupe filenames by suffixing (1), (2), etc. — multiple
      // attachments occasionally share a name in research-data PDFs.
      let n = name;
      let i = 1;
      while (usedNames.has(n)) {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        n = `${stem} (${i})${ext}`;
        i++;
      }
      usedNames.add(n);
      zip.file(n, att.bytes!);
    }
    const blob = await zip.generateAsync({ type: "uint8array" });
    const baseName = file ? file.name.replace(/\.pdf$/i, "") : "attachments";
    downloadBytes(blob, `${baseName}.attachments.zip`, "application/zip");
  };

  const extractedCount = result?.extractedCount ?? 0;
  const totalCount = result?.totalCount ?? 0;
  const hasMultiple = extractedCount >= 2;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ToolHowItWorks
        steps={[
          {
            title: "Drop in your PDF",
            body: "Any PDF that has embedded files — invoices with XML, contracts with exhibits, portfolios, ZUGFeRD e-invoices, anything with attachments.",
          },
          {
            title: "We list every embedded file",
            body: "Each attachment surfaces with name, MIME type, size, and the page or annotation it's anchored to — so you can see exactly what's inside.",
          },
          {
            title: "Save them one-by-one or as a ZIP",
            body: "Pull a single attachment out, or bundle the whole set into one .zip with stable filenames. Original bytes preserved, no re-encoding.",
          },
        ]}
        privacyNote="Your PDF never leaves your browser. Attachment extraction happens locally — nothing is uploaded or persisted."
      />
      {!file ? (
        <ToolDropzone onFiles={onFiles} disabled={busy} prompt="Drop a PDF to extract its embedded files" />
      ) : (
        <div className="card" style={{ padding: "14px 16px", display: "flex", gap: 12, alignItems: "center" }}>
          <UploadedFilePreview file={file} maxHeight={80} />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div
              title={file.name}
              style={{
                fontSize: 14,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {file.name}
            </div>
            <div className="subtle" style={{ fontSize: 12 }}>
              {humanSize(file.size)}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={reset}
            aria-label="Remove file"
          >
            <I.X size={14} />
          </button>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}

      {result && (
        <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <Headline result={result} />
          {hasMultiple && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: "var(--accent-soft)",
                border: "1px solid var(--accent)",
                display: "flex",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 13 }}>
                <strong>Bulk download</strong>
                <span className="subtle" style={{ marginLeft: 8 }}>
                  · {extractedCount} files as one .zip
                </span>
              </div>
              <button type="button" className="btn btn-sm btn-primary" onClick={downloadAllZip}>
                <I.Convert size={14} /> Download all as .zip
              </button>
            </div>
          )}
          {totalCount > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {result.attachments.map((att, i) => (
                <AttachmentRow key={i} att={att} idx={i} onDownload={downloadOne} />
              ))}
            </div>
          )}
          {totalCount === 0 && !result.unsupported && (
            <div className="muted" style={{ fontSize: 13 }}>
              No embedded files found. Most PDFs don&apos;t have any &mdash; common
              cases that DO: research-data PDFs with embedded datasets,
              regulatory filings with supporting docs, PDF/A archive files
              with source materials, technical reports with software
              attached.
            </div>
          )}
          {result.unsupported && (
            <div role="alert" style={{ color: "var(--red)", fontSize: 13 }}>
              Couldn&apos;t parse this PDF&apos;s structure. Encrypted PDFs and
              cross-reference streams aren&apos;t supported by the byte parser.
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
        {file && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={reset}>
            Reset
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={run}>
          {busy ? "Extracting…" : "Extract attachments"}
        </button>
      </div>
    </div>
  );
}

// -------- Subcomponents --------

function Headline({ result }: { result: ExtractAttachmentsResult }) {
  const { totalCount, extractedCount } = result;
  if (totalCount === 0) {
    return (
      <div style={{ fontSize: 15, fontWeight: 500 }}>No attachments found</div>
    );
  }
  const failedCount = totalCount - extractedCount;
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 500 }}>
        {extractedCount} of {totalCount} attachment{totalCount === 1 ? "" : "s"} extracted
      </div>
      {failedCount > 0 && (
        <div className="subtle" style={{ fontSize: 12, marginTop: 2, color: "var(--accent)" }}>
          {failedCount} couldn&apos;t be decoded (unsupported filter or
          corrupt stream) &mdash; details below.
        </div>
      )}
    </div>
  );
}

function AttachmentRow({
  att,
  idx,
  onDownload,
}: {
  att: ExtractAttachmentsResult["attachments"][number];
  idx: number;
  onDownload: (idx: number) => void;
}) {
  const sizeLabel =
    att.bytes !== null
      ? humanSize(att.bytes.length)
      : att.sizeBytes >= 0
        ? `${humanSize(att.sizeBytes)} encoded`
        : "size unknown";

  return (
    <div
      className="card"
      style={{
        padding: "10px 14px",
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: att.bytes !== null ? "var(--accent-soft)" : "var(--bg-2)",
          color: att.bytes !== null ? "var(--accent)" : "var(--fg-subtle)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <I.File size={14} />
      </span>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div
          style={{
            fontSize: 13,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: "var(--mono, monospace)",
          }}
          title={att.filename}
        >
          {att.filename}
        </div>
        <div className="subtle" style={{ fontSize: 11, marginTop: 2 }}>
          {att.mimeType ? `${att.mimeType} · ` : ""}
          {sizeLabel}
          {att.filter !== "Identity" && att.filter !== "Unknown" && (
            <span style={{ marginLeft: 6 }}>· {att.filter}</span>
          )}
        </div>
        {att.extractError && (
          <div className="subtle" style={{ fontSize: 11, marginTop: 2, color: "var(--accent)" }}>
            ⚠ {att.extractError}
          </div>
        )}
        {att.description && (
          <div className="subtle" style={{ fontSize: 11, marginTop: 2 }}>
            {att.description}
          </div>
        )}
      </div>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={att.bytes === null}
        onClick={() => onDownload(idx)}
      >
        <I.ArrowRight size={12} /> Download
      </button>
    </div>
  );
}

function sanitizeFilename(name: string): string {
  // Strip path separators (some PDFs embed paths) + control chars.
  // Keep dots / dashes / unicode for legitimate non-ASCII filenames.
  return name
    .replace(/[/\\]/g, "_")
    .replace(/[\x00-\x1f]/g, "")
    .trim() || "attachment";
}
