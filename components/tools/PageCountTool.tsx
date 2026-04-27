"use client";

// components/tools/PageCountTool.tsx
//
// First PDFium-backed tool, shipped as proof-of-concept for the
// lib/pdf/ engine pipeline. User drops a PDF, we count its pages
// via Google's PDFium WASM (the same engine Chrome ships).
//
// Why this is the proof-of-concept:
//   - Simplest possible operation (single getPageCount() call)
//   - Validates the lazy-load + browser detection + dynamic import
//     plumbing works in production end-to-end
//   - If this ships clean, the same pattern unlocks the other 5
//     PDFium-applicable tools (pdf-to-jpg, pdf-to-text, pdf-to-html,
//     pdf-to-markdown, extract-images)

import { useState, useCallback } from "react";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import { humanSize } from "@/lib/client/pdf-utils";
import { useTrackToolView } from "./useToolTracking";

type Result = {
  fileName: string;
  fileSize: number;
  pageCount: number;
};

export function PageCountTool() {
  useTrackToolView("page-count", "Organize");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const onFiles = useCallback((files: File[]) => {
    setError(null);
    setResult(null);
    const f = files[0];
    if (!f) return;
    if (!f.type.includes("pdf") && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("Please drop a PDF file.");
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      setError("File over 100 MB — try a smaller one.");
      return;
    }
    setFile(f);
  }, []);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Lazy import: PDFium WASM (~3.9 MB) only downloads on first use.
      const { getPageCount } = await import("@/lib/pdf/ops/page-count");
      const pageCount = await getPageCount(bytes);
      setResult({
        fileName: file.name,
        fileSize: file.size,
        pageCount,
      });
    } catch (err) {
      console.error("page-count failed", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not read the PDF. Is it valid?",
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setError(null);
    setResult(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!file ? (
        <ToolDropzone
          onFiles={onFiles}
          prompt="Drop a PDF to count its pages"
          hint="Up to 100 MB · processed privately in your browser via Google PDFium"
        />
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <span style={{ color: "var(--fg-subtle)" }}>
              <I.File size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={file.name}
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
              onClick={reset}
              disabled={busy}
              aria-label="Remove file"
            >
              <I.X size={14} />
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}

      {result && (
        <div
          className="card"
          style={{
            padding: 24,
            borderColor: "var(--accent)",
            background: "var(--accent-soft)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--accent)",
              marginBottom: 4,
            }}
          >
            {result.pageCount.toLocaleString()}
          </div>
          <div className="muted" style={{ fontSize: 14 }}>
            page{result.pageCount === 1 ? "" : "s"} in {result.fileName}
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
        {file && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={reset}
            disabled={busy}
          >
            Reset
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!file || busy}
          onClick={run}
        >
          {busy ? "Counting…" : "Count pages"}
        </button>
      </div>
    </div>
  );
}
