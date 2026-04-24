"use client";

// RedactFreeTool — Tier 1 §1.5/§1.6 P0 (free MVP of Edit PDF /
// §1.6 manual Redact).
//
// Same canvas-overlay + drag-to-select pattern as HighlightPdfTool,
// but with color fixed to black and opacity 1.0 — i.e. "cover the
// region completely, no peek-through." Ships as free because the
// surgery is the SAME primitive pdf-lib drawRectangle call — the
// paid AI · Redact adds value by detecting what to redact, not by
// drawing the rectangle itself. So users who know WHERE the
// sensitive bits are should be able to redact for free.
//
// HONEST security caveat surfaced clearly in UI + FAQ:
//   Content-stream rectangles visually cover text but do NOT delete
//   the underlying text object. A determined attacker can still
//   extract the original text with `pdftotext` or any PDF editor
//   that ignores the painted rectangle. TRUE cryptographic
//   redaction requires deleting the text object + re-flowing the
//   content stream, which pdf-lib doesn't expose. For
//   visual-privacy-only use cases (sharing a screenshot of the
//   page, printing, most non-adversarial viewers), this works. For
//   legal discovery / adversarial redaction, you need a tool that
//   deletes content at the stream level (we'll ship that as a paid
//   feature later).
//
// We also flatten the PDF on save so any annotations carrying
// metadata get baked into static content — a partial mitigation
// for the above.

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { PDFDocument, rgb } from "pdf-lib";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import {
  deriveOutputName,
  downloadBytes,
  humanSize,
  sha256HexOfBytes,
} from "@/lib/client/pdf-utils";
import { logToolResultAction } from "@/lib/tool-result-actions";

const RENDER_SCALE = 1.5;
const MIN_DRAG_CSS_PX = 6;

type Redaction = {
  id: string;
  pageIndex: number;
  xPdf: number;
  yPdf: number;
  widthPt: number;
  heightPt: number;
};

type Loaded = {
  file: File;
  buffer: ArrayBuffer;
  pageSizes: Array<{ widthPt: number; heightPt: number }>;
};

type Drag = {
  startXCss: number;
  startYCss: number;
  currentXCss: number;
  currentYCss: number;
};

export function RedactFreeTool() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);
  const [redactions, setRedactions] = useState<Redaction[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    bytes: Uint8Array;
    name: string;
    size: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setError(null);
    setResult(null);
    setRedactions([]);
    setPageIndex(0);
    setBusy(true);
    try {
      const buffer = await f.arrayBuffer();
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const pages = doc.getPages();
      if (pages.length === 0) throw new Error("PDF has no pages.");
      setLoaded({
        file: f,
        buffer,
        pageSizes: pages.map((p) => ({
          widthPt: p.getWidth(),
          heightPt: p.getHeight(),
        })),
      });
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error && /encrypted|password/i.test(err.message)
          ? "This PDF is password-protected. Unlock it first."
          : "Couldn't read that PDF. It may be corrupt."
      );
      setLoaded(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const render = async () => {
      setRenderBusy(true);
      renderTaskRef.current?.cancel();
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs-worker.min.mjs";
        }
        const src = await pdfjs.getDocument({ data: loaded.buffer.slice(0) }).promise;
        if (cancelled) return;
        const page = await src.getPage(pageIndex + 1);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;
        setCanvasSize({ w: viewport.width, h: viewport.height });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (!/cancelled|Worker was destroyed/i.test(msg)) {
          console.error("page render failed:", err);
          setError("Couldn't render this page.");
        }
      } finally {
        if (!cancelled) setRenderBusy(false);
      }
    };
    render();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [loaded, pageIndex]);

  const reset = () => {
    setLoaded(null);
    setRedactions([]);
    setPageIndex(0);
    setError(null);
    setResult(null);
    setDrag(null);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || busy) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDrag({ startXCss: x, startYCss: y, currentXCss: x, currentYCss: y });
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setDrag({
      ...drag,
      currentXCss: e.clientX - rect.left,
      currentYCss: e.clientY - rect.top,
    });
  };

  const commitDrag = () => {
    if (!drag || !loaded || !canvasRef.current || !canvasSize) {
      setDrag(null);
      return;
    }
    const dx = Math.abs(drag.currentXCss - drag.startXCss);
    const dy = Math.abs(drag.currentYCss - drag.startYCss);
    if (dx < MIN_DRAG_CSS_PX || dy < MIN_DRAG_CSS_PX) {
      setDrag(null);
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const cssToCanvas = canvasSize.w / rect.width;
    const x0Canvas = Math.min(drag.startXCss, drag.currentXCss) * cssToCanvas;
    const y0Canvas = Math.min(drag.startYCss, drag.currentYCss) * cssToCanvas;
    const x1Canvas = Math.max(drag.startXCss, drag.currentXCss) * cssToCanvas;
    const y1Canvas = Math.max(drag.startYCss, drag.currentYCss) * cssToCanvas;
    const pageH = loaded.pageSizes[pageIndex]?.heightPt ?? 0;
    const xPdf = x0Canvas / RENDER_SCALE;
    const widthPt = (x1Canvas - x0Canvas) / RENDER_SCALE;
    const yTopPt = pageH - y0Canvas / RENDER_SCALE;
    const yBotPt = pageH - y1Canvas / RENDER_SCALE;
    const yPdf = yBotPt;
    const heightPt = yTopPt - yBotPt;
    setRedactions((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pageIndex,
        xPdf,
        yPdf,
        widthPt,
        heightPt,
      },
    ]);
    setDrag(null);
  };

  const removeRedaction = (id: string) => {
    setRedactions((prev) => prev.filter((r) => r.id !== id));
  };

  const apply = async () => {
    if (!loaded) return;
    if (redactions.length === 0) {
      setError("Draw at least one redaction first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const doc = await PDFDocument.load(loaded.buffer.slice(0), {
        ignoreEncryption: true,
      });
      // Flatten form fields before redacting so annotations-carried
      // metadata gets baked into the static content (partial defence
      // against metadata leakage on top of the visual cover).
      try {
        doc.getForm().flatten();
      } catch {
        // No form present, or already flat — non-fatal.
      }
      for (const r of redactions) {
        const page = doc.getPage(r.pageIndex);
        page.drawRectangle({
          x: r.xPdf,
          y: r.yPdf,
          width: r.widthPt,
          height: r.heightPt,
          color: rgb(0, 0, 0),
          opacity: 1,
          borderWidth: 0,
        });
      }
      const bytes = await doc.save({
        useObjectStreams: true,
        updateFieldAppearances: false,
      });
      const name = deriveOutputName(loaded.file.name, "-redacted");
      setResult({ bytes, name, size: bytes.length });

      try {
        const sha256 = await sha256HexOfBytes(bytes);
        await logToolResultAction({
          toolId: "redact-free",
          name,
          mime: "application/pdf",
          sizeBytes: bytes.length,
          sha256,
        });
      } catch (logErr) {
        console.warn("logToolResult failed (non-fatal):", logErr);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Apply failed.");
    } finally {
      setBusy(false);
    }
  };

  const currentPageRedactions = useMemo(
    () => redactions.filter((r) => r.pageIndex === pageIndex),
    [redactions, pageIndex]
  );

  const dragCss = useMemo(() => {
    if (!drag || !canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width === 0) return null;
    const left = (Math.min(drag.startXCss, drag.currentXCss) / rect.width) * 100;
    const top = (Math.min(drag.startYCss, drag.currentYCss) / rect.height) * 100;
    const width =
      (Math.abs(drag.currentXCss - drag.startXCss) / rect.width) * 100;
    const height =
      (Math.abs(drag.currentYCss - drag.startYCss) / rect.height) * 100;
    return { left, top, width, height };
  }, [drag]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!loaded ? (
        <ToolDropzone
          onFiles={onFiles}
          disabled={busy}
          prompt="Drop a PDF to redact"
        />
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
                title={loaded.file.name}
                style={{
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {loaded.file.name}
              </div>
              <div className="subtle" style={{ fontSize: 12 }}>
                {humanSize(loaded.file.size)} · {loaded.pageSizes.length} page
                {loaded.pageSizes.length === 1 ? "" : "s"} · {redactions.length} redaction
                {redactions.length === 1 ? "" : "s"} staged
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

          <div
            className="card"
            style={{
              padding: 14,
              borderColor: "var(--red, #b91c1c)",
              background: "var(--red-soft, #fff1f2)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "var(--red, #b91c1c)" }}>
              Visual redaction only — read this before you ship
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              Rectangles cover the content visually. For most uses — screenshots,
              printing, casual sharing — this is enough. For legal discovery or
              adversarial review, the original text can still be extracted with
              <code>pdftotext</code>. Cryptographic redaction deletes the
              underlying text at the stream level; that's roadmapped as a paid
              feature.
            </div>
          </div>

          <div
            className="card"
            style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div
              className="row"
              style={{ justifyContent: "space-between", gap: 10, alignItems: "center" }}
            >
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || pageIndex === 0}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              >
                <I.ArrowLeft size={14} />
                <span>Prev</span>
              </button>
              <div
                className="mono"
                style={{ fontSize: 13, color: "var(--fg-subtle)" }}
              >
                Page {pageIndex + 1} / {loaded.pageSizes.length}
                {renderBusy ? " · rendering…" : ""}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || pageIndex >= loaded.pageSizes.length - 1}
                onClick={() =>
                  setPageIndex((p) => Math.min(loaded.pageSizes.length - 1, p + 1))
                }
              >
                <span>Next</span>
                <I.ArrowRight size={14} />
              </button>
            </div>

            <div
              style={{
                position: "relative",
                width: "100%",
                overflow: "auto",
                background: "var(--bg-2)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                padding: 12,
              }}
            >
              <div
                style={{
                  position: "relative",
                  margin: "0 auto",
                  width: canvasSize ? canvasSize.w : undefined,
                  maxWidth: "100%",
                }}
              >
                <canvas
                  ref={canvasRef}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={commitDrag}
                  onMouseLeave={commitDrag}
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: canvasSize ? canvasSize.w : undefined,
                    height: "auto",
                    background: "var(--bg-1)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    cursor: busy ? "default" : "crosshair",
                    userSelect: "none",
                  }}
                />
                {canvasSize &&
                  currentPageRedactions.map((r) => {
                    const pageH = loaded.pageSizes[pageIndex]?.heightPt ?? 0;
                    if (pageH === 0) return null;
                    const pageWpx = canvasSize.w / RENDER_SCALE;
                    const pageHpx = canvasSize.h / RENDER_SCALE;
                    const leftPct = (r.xPdf / pageWpx) * 100;
                    const widthPct = (r.widthPt / pageWpx) * 100;
                    const topPct = ((pageH - r.yPdf - r.heightPt) / pageHpx) * 100;
                    const heightPct = (r.heightPt / pageHpx) * 100;
                    return (
                      <div
                        key={r.id}
                        style={{
                          position: "absolute",
                          left: `${leftPct}%`,
                          top: `${topPct}%`,
                          width: `${widthPct}%`,
                          height: `${heightPct}%`,
                          background: "black",
                          pointerEvents: "auto",
                        }}
                        title={`${Math.round(r.widthPt)}×${Math.round(r.heightPt)} pt`}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRedaction(r.id);
                          }}
                          aria-label="Remove redaction"
                          style={{
                            position: "absolute",
                            top: 2,
                            right: 2,
                            border: "none",
                            background: "rgba(255,255,255,0.7)",
                            color: "black",
                            width: 16,
                            height: 16,
                            borderRadius: 8,
                            fontSize: 10,
                            cursor: "pointer",
                            padding: 0,
                            lineHeight: "16px",
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                {dragCss && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${dragCss.left}%`,
                      top: `${dragCss.top}%`,
                      width: `${dragCss.width}%`,
                      height: `${dragCss.height}%`,
                      background: "rgba(0,0,0,0.85)",
                      border: "1px dashed rgba(255,255,255,0.4)",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </>
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
            padding: 20,
            borderColor: "var(--accent)",
            background: "var(--accent-soft)",
          }}
        >
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "var(--accent)",
                color: "var(--bg-1)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <I.Check size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}>
                {redactions.length} region{redactions.length === 1 ? "" : "s"} redacted
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {humanSize(result.size)}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => downloadBytes(result.bytes, result.name)}
            >
              <I.Download size={14} />
              <span>Download</span>
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
        {loaded && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={reset}
          >
            Reset
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!loaded || busy || redactions.length === 0}
          onClick={apply}
        >
          {busy ? "Applying…" : `Redact (${redactions.length})`}
        </button>
      </div>
    </div>
  );
}
