"use client";

// components/tools/PdfRotateTool.tsx
//
// Build 2 Wave 9 (2026-04-27): rotate PDF pages 90°/180°/270°.
// 2026-04-27 (visual rotate UX): rebuilt around a per-page thumbnail
// grid — users SEE each page and click to rotate it instead of typing
// page numbers blindly.
//
// Architecture:
//   1. On drop → PDFium renders every page as a 0.5×-scale JPG thumbnail
//      via the existing rasterize op. Memory-bounded by the 100 MB cap
//      and the small scale; renders ~30 pages/second on a typical laptop.
//   2. Each thumbnail tracks its own rotation state (0/90/180/270).
//      Click → cycles through the four states. CSS transform: rotate()
//      shows the result live, no re-render needed.
//   3. Bulk action buttons at the top: "All 90° CW", "All 180°", "Reset".
//   4. Apply button calls rotatePdfPerPage with the {pageIndex → angle}
//      map. pdf-lib adjusts each page's /Rotate entry — lossless,
//      milliseconds.
//
// For huge PDFs (>100 pages), thumbnail rendering can take a few
// seconds. We show a progress card during the render with a count.

import { useState, useCallback, useEffect } from "react";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import { humanSize } from "@/lib/client/pdf-utils";
import { useTrackToolView } from "./useToolTracking";

interface PageState {
  /** 1-based page number for display. */
  pageNumber: number;
  /** Object URL for the rendered thumbnail (rasterize.ts output). */
  thumbnailUrl: string;
  /** Natural width / height after PDFium render (used for aspect-ratio). */
  width: number;
  height: number;
  /** User-applied rotation, ADDITIVE to original (0 / 90 / 180 / 270). */
  rotation: number;
}

interface RotateResultState {
  outputBytes: Uint8Array;
  outputFileName: string;
  rotatedCount: number;
  pageCount: number;
}

type Stage = "idle" | "rendering-thumbnails" | "ready" | "applying";

export function PdfRotateTool() {
  const tracker = useTrackToolView("rotate", "Edit");
  const [file, setFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState<PageState[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RotateResultState | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  // Revoke object URLs on cleanup so we don't leak memory across resets.
  useEffect(() => {
    return () => {
      pages.forEach((p) => URL.revokeObjectURL(p.thumbnailUrl));
    };
  }, [pages]);

  const onFiles = useCallback(
    async (files: File[]) => {
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
      setStage("rendering-thumbnails");

      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        setPdfBytes(bytes);

        const { rasterizePdf } = await import("@/lib/pdf/ops/rasterize");
        // 0.5× scale produces a ~400×566px thumbnail for letter-sized
        // pages — sharp enough to read page content while staying
        // memory-bounded for huge docs.
        const rendered = await rasterizePdf(bytes, {
          format: "jpeg",
          scale: 0.5,
          quality: 0.7,
          onProgress: (done, total) => setProgress({ done, total }),
        });

        const newPages: PageState[] = rendered.map((r) => {
          const blob = new Blob([r.bytes], { type: "image/jpeg" });
          return {
            pageNumber: r.pageNumber,
            thumbnailUrl: URL.createObjectURL(blob),
            width: r.width,
            height: r.height,
            rotation: 0,
          };
        });

        setPages(newPages);
        setStage("ready");
      } catch (err) {
        console.error("rotate thumbnail render failed", err);
        const msg =
          err instanceof Error ? err.message : "Could not parse the PDF.";
        setError(msg);
        setStage("idle");
        tracker.error({ errorCode: "thumbnail_failed" });
      }
    },
    [tracker],
  );

  const reset = () => {
    pages.forEach((p) => URL.revokeObjectURL(p.thumbnailUrl));
    setPages([]);
    setFile(null);
    setPdfBytes(null);
    setError(null);
    setResult(null);
    setStage("idle");
    setProgress({ done: 0, total: 0 });
  };

  const cyclePageRotation = (idx: number) => {
    setPages((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
      ),
    );
  };

  const setAllRotations = (angle: number) => {
    setPages((prev) =>
      prev.map((p) => ({ ...p, rotation: (p.rotation + angle) % 360 })),
    );
  };

  const resetAllRotations = () => {
    setPages((prev) => prev.map((p) => ({ ...p, rotation: 0 })));
  };

  const apply = async () => {
    if (!pdfBytes || !file) return;
    const perPage: Record<number, number> = {};
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].rotation !== 0) perPage[i] = pages[i].rotation;
    }
    const rotatedCount = Object.keys(perPage).length;
    if (rotatedCount === 0) {
      setError("Click a page to rotate it first.");
      return;
    }
    setError(null);
    setStage("applying");
    const t0 = performance.now();
    try {
      const { rotatePdfPerPage } = await import("@/lib/pdf/ops/rotate");
      const r = await rotatePdfPerPage(pdfBytes, perPage);
      const baseName = file.name.replace(/\.pdf$/i, "");
      setResult({
        outputBytes: r.bytes,
        outputFileName: `${baseName || "document"}-rotated.pdf`,
        rotatedCount: r.rotatedCount,
        pageCount: r.pageCount,
      });
      setStage("ready");
      tracker.success({
        creditCost: 0,
        pageCount: r.rotatedCount,
        processingMs: Math.round(performance.now() - t0),
      });
    } catch (err) {
      console.error("rotate apply failed", err);
      const msg =
        err instanceof Error ? err.message : "Could not rotate the PDF.";
      setError(msg);
      setStage("ready");
      tracker.error({ errorCode: "rotate_failed" });
    }
  };

  const downloadResult = () => {
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

  const rotatedCount = pages.filter((p) => p.rotation !== 0).length;
  const busy = stage === "rendering-thumbnails" || stage === "applying";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!file ? (
        <ToolDropzone
          onFiles={onFiles}
          prompt="Drop a PDF to rotate"
          hint="Up to 100 MB · runs privately in your browser"
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
                {truncate(file.name)}
              </div>
              <div className="subtle" style={{ fontSize: 12 }}>
                {humanSize(file.size)}
                {pages.length > 0 ? ` · ${pages.length} page${pages.length === 1 ? "" : "s"}` : ""}
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

      {stage === "rendering-thumbnails" && (
        <div
          className="card"
          style={{ padding: 16, background: "var(--bg-1)", display: "flex", gap: 12 }}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="pulse-soft" style={{ color: "var(--accent)" }}>
            <I.Sparkle size={16} />
          </span>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
            Rendering page previews
            {progress.total > 0 ? ` · ${progress.done} / ${progress.total}` : "…"}
          </div>
        </div>
      )}

      {stage === "applying" && (
        <div
          className="card"
          style={{ padding: 16, background: "var(--bg-1)", display: "flex", gap: 12 }}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="pulse-soft" style={{ color: "var(--accent)" }}>
            <I.Sparkle size={16} />
          </span>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
            Saving rotated PDF…
          </div>
        </div>
      )}

      {stage === "ready" && pages.length > 0 && !result && (
        <>
          {/* Toolbar */}
          <div
            className="card"
            style={{
              padding: "12px 16px",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div className="subtle" style={{ fontSize: 13 }}>
              {rotatedCount === 0
                ? "Click a page to rotate it 90° clockwise. Click again for 180°, 270°."
                : `${rotatedCount} of ${pages.length} page${pages.length === 1 ? "" : "s"} rotated`}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setAllRotations(90)}
                aria-label="Rotate all pages 90 degrees clockwise"
              >
                All 90°
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setAllRotations(180)}
                aria-label="Rotate all pages 180 degrees"
              >
                All 180°
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={resetAllRotations}
                disabled={rotatedCount === 0}
                aria-label="Reset all rotations"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Thumbnail grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 14,
            }}
          >
            {pages.map((p, idx) => (
              <button
                key={p.pageNumber}
                type="button"
                onClick={() => cyclePageRotation(idx)}
                aria-label={
                  p.rotation === 0
                    ? `Page ${p.pageNumber} — click to rotate 90°`
                    : `Page ${p.pageNumber} — currently rotated ${p.rotation}°, click for next`
                }
                style={{
                  position: "relative",
                  background: "var(--bg-1)",
                  border:
                    p.rotation === 0
                      ? "1px solid var(--border)"
                      : "1px solid var(--accent)",
                  borderRadius: 8,
                  padding: 8,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  alignItems: "stretch",
                  transition: "border-color 0.15s",
                  font: "inherit",
                  color: "inherit",
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    aspectRatio: `${p.width} / ${p.height}`,
                    overflow: "hidden",
                    borderRadius: 4,
                    background: "var(--bg-2)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbnailUrl}
                    alt={`Page ${p.pageNumber} preview`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      transform: `rotate(${p.rotation}deg)`,
                      transition: "transform 0.18s ease-out",
                    }}
                  />
                </div>
                <div
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 11,
                  }}
                >
                  <span className="subtle" style={{ fontVariantNumeric: "tabular-nums" }}>
                    Page {p.pageNumber}
                  </span>
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 500,
                      background:
                        p.rotation === 0 ? "var(--bg-2)" : "var(--accent-soft)",
                      color: p.rotation === 0 ? "var(--fg-muted)" : "var(--accent)",
                    }}
                  >
                    {p.rotation === 0 ? "0°" : `+${p.rotation}°`}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {result && (
        <div
          className="card"
          style={{ padding: "16px 20px" }}
          role="status"
          aria-live="polite"
          aria-label={`Rotated ${result.rotatedCount} pages`}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 16,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                Rotated {result.rotatedCount} of {result.pageCount} page
                {result.pageCount === 1 ? "" : "s"}
              </div>
              <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                Output: {humanSize(result.outputBytes.length)}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={downloadResult}
            >
              <I.Download size={12} /> Download
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
        {result ? (
          <button type="button" className="btn btn-primary" onClick={reset}>
            Rotate another PDF
          </button>
        ) : stage === "ready" && pages.length > 0 ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={reset}
              disabled={busy}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={rotatedCount === 0 || busy}
              onClick={apply}
            >
              {busy
                ? "Saving…"
                : rotatedCount === 0
                  ? "Click a page to rotate"
                  : `Apply rotation to ${rotatedCount} page${rotatedCount === 1 ? "" : "s"}`}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
