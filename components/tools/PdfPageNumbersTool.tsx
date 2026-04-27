"use client";

// components/tools/PdfPageNumbersTool.tsx
// Tier 3 (2026-04-28): add page numbers. Position + format pickers
// before apply. pdf-lib's drawText handles the overlay.

import { useState, useCallback } from "react";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import { humanSize } from "@/lib/client/pdf-utils";
import { useTrackToolView } from "./useToolTracking";
import type { Position, NumberFormat } from "@/lib/pdf/ops/page-numbers";

interface ResultState {
  outputBytes: Uint8Array;
  outputFileName: string;
  numberedCount: number;
  pageCount: number;
}

export function PdfPageNumbersTool() {
  const tracker = useTrackToolView("page-numbers", "Edit");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [position, setPosition] = useState<Position>("bottom-center");
  const [format, setFormat] = useState<NumberFormat>("1 of N");
  const [fontSize, setFontSize] = useState<number>(11);

  const onFiles = useCallback(
    (files: File[]) => {
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
      tracker.upload(f);
    },
    [tracker],
  );

  const reset = () => {
    setFile(null);
    setError(null);
    setResult(null);
    setBusy(false);
  };

  const run = async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    const t0 = performance.now();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { addPageNumbers } = await import("@/lib/pdf/ops/page-numbers");
      const r = await addPageNumbers(bytes, {
        position,
        format,
        fontSize,
      });
      const baseName = file.name.replace(/\.pdf$/i, "");
      setResult({
        outputBytes: r.bytes,
        outputFileName: `${baseName || "document"}-numbered.pdf`,
        numberedCount: r.numberedCount,
        pageCount: r.pageCount,
      });
      tracker.success({
        creditCost: 0,
        pageCount: r.numberedCount,
        processingMs: Math.round(performance.now() - t0),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not add page numbers.";
      setError(msg);
      tracker.error({ errorCode: "page_numbers_failed" });
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([result.outputBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = result.outputFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  const truncate = (s: string, max = 38) =>
    s.length <= max ? s : `${s.slice(0, max - 1)}…`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!file ? (
        <ToolDropzone onFiles={onFiles} prompt="Drop a PDF to add page numbers" hint="Up to 100 MB · runs privately in your browser" />
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <span style={{ color: "var(--fg-subtle)" }}><I.File size={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={file.name}>{truncate(file.name)}</div>
              <div className="subtle" style={{ fontSize: 12 }}>{humanSize(file.size)}</div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={reset} disabled={busy} aria-label="Remove file"><I.X size={14} /></button>
          </div>
        </div>
      )}

      {file && !result && (
        <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Position</div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {(
              [
                { v: "bottom-center", label: "Bottom center" },
                { v: "bottom-right", label: "Bottom right" },
                { v: "bottom-left", label: "Bottom left" },
                { v: "top-center", label: "Top center" },
                { v: "top-right", label: "Top right" },
                { v: "top-left", label: "Top left" },
              ] as Array<{ v: Position; label: string }>
            ).map((opt) => (
              <button key={opt.v} type="button" className={`btn btn-sm ${position === opt.v ? "btn-primary" : "btn-outline"}`} onClick={() => setPosition(opt.v)}>{opt.label}</button>
            ))}
          </div>

          <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>Format</div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {(
              [
                { v: "1", label: "1, 2, 3" },
                { v: "1 of N", label: "1 of N" },
                { v: "Page 1", label: "Page 1" },
                { v: "Page 1 of N", label: "Page 1 of N" },
              ] as Array<{ v: NumberFormat; label: string }>
            ).map((opt) => (
              <button key={opt.v} type="button" className={`btn btn-sm ${format === opt.v ? "btn-primary" : "btn-outline"}`} onClick={() => setFormat(opt.v)}>{opt.label}</button>
            ))}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
            <span>Font size</span>
            <input type="number" min={6} max={48} value={fontSize} onChange={(e) => setFontSize(Math.max(6, Math.min(48, Number(e.target.value) || 11)))} style={{ width: 80, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-1)", color: "var(--fg)" }} />
            <span className="subtle" style={{ fontSize: 11 }}>points (default 11)</span>
          </label>
        </div>
      )}

      {error && <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>}

      {busy && (
        <div className="card" style={{ padding: 16, background: "var(--bg-1)", display: "flex", gap: 12 }} role="status" aria-live="polite" aria-busy="true">
          <span className="pulse-soft" style={{ color: "var(--accent)" }}><I.Sparkle size={16} /></span>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>Adding page numbers…</div>
        </div>
      )}

      {result && (
        <div className="card" style={{ padding: "16px 20px" }} role="status" aria-live="polite" aria-label={`Numbered ${result.numberedCount} pages`}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Numbered {result.numberedCount} of {result.pageCount} page{result.pageCount === 1 ? "" : "s"}</div>
              <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>Output: {humanSize(result.outputBytes.length)}</div>
            </div>
            <button type="button" className="btn btn-sm btn-outline" onClick={download}><I.Download size={12} /> Download</button>
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
        {result ? (
          <button type="button" className="btn btn-primary" onClick={reset}>Number another PDF</button>
        ) : (
          <>
            {file && <button type="button" className="btn btn-ghost" onClick={reset} disabled={busy}>Reset</button>}
            <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={run}>{busy ? "Adding…" : "Add page numbers"}</button>
          </>
        )}
      </div>
    </div>
  );
}
