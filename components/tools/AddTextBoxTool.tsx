"use client";

// AddTextBoxTool — Tier 1 §1.5 P0.
//
// Render each PDF page to an HTML5 canvas via pdfjs, let the user
// click a spot on the canvas to place a text box, and write every
// placed box to the PDF via pdf-lib `page.drawText()` on "Apply".
//
// Architecture decisions:
//   - One canvas ref, re-rendered on page navigation. pdfjs's
//     RenderTask is async and can be cancelled — we track the
//     current task and cancel it on unmount / page change so a
//     rapid Prev/Next tap can't leave two renders racing.
//   - Text boxes live in a single state array keyed by pageIndex
//     (zero-based). On canvas click we push `{ pageIndex, xPdf,
//     yPdf, text, size }` with coordinates already converted to
//     PDF space (y-flipped from canvas space).
//   - Preview overlay: absolutely-positioned <span> elements on
//     top of the canvas show each placed box in roughly the right
//     spot. Not pixel-perfect — pdfjs's rendering scale differs
//     slightly from our font-size math — but good enough to
//     confirm placement before hitting Apply.
//   - Single font (Helvetica, built-in to pdf-lib's
//     StandardFonts), single color (black). A richer version
//     with color picker + font family would be a later iteration
//     — this is the MVP P0.
//
// Coordinate conversion:
//   Canvas is rendered at SCALE (e.g. 1.5x PDF points for a crisp
//   preview). PDF page width/height in points = canvas.width /
//   SCALE. pdfjs renders with y=0 at the top; pdf-lib's drawText
//   uses y=0 at the bottom. So:
//     xPdf = clickX / SCALE
//     yPdf = pageHeightPt - (clickY / SCALE) - fontSize
//   The `- fontSize` gives drawText a BASELINE that lines up with
//   the BOTTOM of the preview overlay — which is what users
//   intuitively expect when they click "here" and see the text
//   land roughly there.

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import {
  deriveOutputName,
  downloadBytes,
  humanSize,
  sha256HexOfBytes,
} from "@/lib/client/pdf-utils";
import { logToolResultAction } from "@/lib/tool-result-actions";

// Render scale: 1.5x gives a crisp preview on standard DPI screens
// without blowing up memory. Bigger = sharper but the canvas data
// URL used by pdfjs can hit the browser's per-image pixel cap for
// very large pages.
const RENDER_SCALE = 1.5;

type TextBox = {
  id: string;
  pageIndex: number; // zero-based
  xPdf: number; // PDF points, x from left
  yPdf: number; // PDF points, y from BOTTOM (drawText baseline)
  text: string;
  size: number;
};

type Loaded = {
  file: File;
  buffer: ArrayBuffer;
  pageSizes: Array<{ widthPt: number; heightPt: number }>; // per-page
};

export function AddTextBoxTool() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);
  const [boxes, setBoxes] = useState<TextBox[]>([]);
  const [draftText, setDraftText] = useState("");
  const [draftSize, setDraftSize] = useState(14);
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
    setBoxes([]);
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

  // Render the selected page to our canvas whenever loaded file or
  // pageIndex changes. Cancels any previous render so rapid
  // navigation can't leave stale paint on the canvas.
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
        // pdfjs throws a special "RenderingCancelledException" when
        // we cancel — that's fine, it's not a real error.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/cancelled|Worker was destroyed/i.test(msg)) {
          console.error("page render failed:", err);
          setError("Couldn't render this page. It may contain unsupported features.");
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
    setBoxes([]);
    setDraftText("");
    setPageIndex(0);
    setError(null);
    setResult(null);
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!loaded || !canvasRef.current || draftText.trim().length === 0) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // Canvas is rendered responsively — its CSS size != its backing
    // pixel size. Scale the click coords from CSS-space to
    // canvas-pixel-space, then divide by RENDER_SCALE to get PDF
    // points.
    const cssToCanvas = canvas.width / rect.width;
    const xCanvas = (e.clientX - rect.left) * cssToCanvas;
    const yCanvas = (e.clientY - rect.top) * cssToCanvas;
    const pageHeightPt = loaded.pageSizes[pageIndex]?.heightPt ?? 0;
    const xPdf = xCanvas / RENDER_SCALE;
    // Convert canvas-y (origin top) to PDF-y (origin bottom) and
    // subtract font size so drawText's baseline lines up roughly
    // with the CLICK POINT (what the user saw).
    const yPdf = pageHeightPt - yCanvas / RENDER_SCALE - draftSize;
    setBoxes((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pageIndex,
        xPdf,
        yPdf,
        text: draftText.trim(),
        size: draftSize,
      },
    ]);
    setDraftText("");
  };

  const removeBox = (id: string) => {
    setBoxes((prev) => prev.filter((b) => b.id !== id));
  };

  const apply = async () => {
    if (!loaded) return;
    if (boxes.length === 0) {
      setError("Add at least one text box first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const doc = await PDFDocument.load(loaded.buffer.slice(0), {
        ignoreEncryption: true,
      });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (const box of boxes) {
        const page = doc.getPage(box.pageIndex);
        page.drawText(box.text, {
          x: box.xPdf,
          y: box.yPdf,
          size: box.size,
          font,
          color: rgb(0, 0, 0),
        });
      }
      const bytes = await doc.save({ useObjectStreams: true });
      const name = deriveOutputName(loaded.file.name, "-with-text");
      setResult({ bytes, name, size: bytes.length });

      try {
        const sha256 = await sha256HexOfBytes(bytes);
        await logToolResultAction({
          toolId: "add-text-box",
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

  // Preview overlay — we position absolutely-placed spans on top of
  // the canvas for each box on the CURRENT page so the user can see
  // what they're about to apply before hitting "Apply".
  const currentPageBoxes = useMemo(
    () => boxes.filter((b) => b.pageIndex === pageIndex),
    [boxes, pageIndex]
  );

  const pageH = loaded?.pageSizes[pageIndex]?.heightPt ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!loaded ? (
        <ToolDropzone
          onFiles={onFiles}
          disabled={busy}
          prompt="Drop a PDF to add text boxes"
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
                {loaded.pageSizes.length === 1 ? "" : "s"} · {boxes.length} text box
                {boxes.length === 1 ? "" : "es"} placed
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
            style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div
              style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
            >
              <div style={{ flex: "1 1 240px", minWidth: 200 }}>
                <label
                  htmlFor="draft-text"
                  style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-subtle)", display: "block", marginBottom: 4 }}
                >
                  TEXT (then click on the page to place)
                </label>
                <input
                  id="draft-text"
                  type="text"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  disabled={busy}
                  placeholder="Type the text you want to add…"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border-strong)",
                    background: "var(--bg-1)",
                    color: "var(--fg)",
                    fontSize: 14,
                  }}
                />
              </div>
              <div style={{ width: 120 }}>
                <label
                  htmlFor="draft-size"
                  style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-subtle)", display: "block", marginBottom: 4 }}
                >
                  SIZE
                </label>
                <input
                  id="draft-size"
                  type="number"
                  min={6}
                  max={96}
                  step={1}
                  value={draftSize}
                  disabled={busy}
                  onChange={(e) => setDraftSize(Math.max(6, Math.min(96, Number(e.target.value) || 14)))}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border-strong)",
                    background: "var(--bg-1)",
                    color: "var(--fg)",
                    fontSize: 14,
                    fontFamily: "var(--font-mono), ui-monospace, monospace",
                  }}
                />
              </div>
            </div>
            <div className="subtle" style={{ fontSize: 12 }}>
              Font: Helvetica · Color: black · Click cancels if the text field is empty.
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
                  onClick={onCanvasClick}
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: canvasSize ? canvasSize.w : undefined,
                    height: "auto",
                    background: "var(--bg-1)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    cursor: draftText.trim().length > 0 ? "crosshair" : "default",
                  }}
                />
                {/* Preview overlay for already-placed boxes on this page. */}
                {canvasSize &&
                  pageH > 0 &&
                  currentPageBoxes.map((b) => {
                    // Convert PDF coords back to canvas-css coords for the overlay.
                    const pageHpx = canvasSize.h;
                    // The canvas renders at RENDER_SCALE; we reverse-map.
                    const topPt = pageH - b.yPdf - b.size;
                    const leftPct = (b.xPdf / (canvasSize.w / RENDER_SCALE)) * 100;
                    const topPct = (topPt / (pageHpx / RENDER_SCALE)) * 100;
                    return (
                      <div
                        key={b.id}
                        style={{
                          position: "absolute",
                          left: `${leftPct}%`,
                          top: `${topPct}%`,
                          transform: "translateY(-2px)",
                          fontFamily: "Helvetica, Arial, sans-serif",
                          fontSize: `${(b.size / (pageH)) * 100}cqh`,
                          color: "black",
                          background: "rgba(255, 240, 120, 0.55)",
                          padding: "1px 4px",
                          borderRadius: 2,
                          pointerEvents: "auto",
                          maxWidth: "60%",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                        title={`${b.text} · ${b.size}pt · (${Math.round(b.xPdf)}, ${Math.round(b.yPdf)})`}
                      >
                        <span>{b.text}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeBox(b.id);
                          }}
                          aria-label={`Remove "${b.text}"`}
                          style={{
                            border: "none",
                            background: "rgba(0,0,0,0.15)",
                            color: "black",
                            width: 14,
                            height: 14,
                            lineHeight: "14px",
                            borderRadius: 7,
                            fontSize: 10,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          {boxes.length > 0 && (
            <div className="card" style={{ padding: "12px 16px" }}>
              <div
                style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-subtle)", marginBottom: 8 }}
              >
                PLACED TEXT BOXES ({boxes.length})
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {boxes.map((b) => (
                  <li
                    key={b.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      padding: "6px 10px",
                      background: b.pageIndex === pageIndex ? "var(--accent-soft)" : "var(--bg-1)",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <span
                      className="mono"
                      style={{ color: "var(--fg-subtle)", width: 50, flexShrink: 0 }}
                    >
                      p.{b.pageIndex + 1}
                    </span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {b.text}
                    </span>
                    <span
                      className="mono subtle"
                      style={{ fontSize: 11 }}
                    >
                      {b.size}pt · ({Math.round(b.xPdf)}, {Math.round(b.yPdf)})
                    </span>
                    <button
                      type="button"
                      onClick={() => removeBox(b.id)}
                      className="btn btn-sm btn-ghost"
                      disabled={busy}
                      aria-label="Remove text box"
                    >
                      <I.X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
                {boxes.length} text box{boxes.length === 1 ? "" : "es"} applied
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
          disabled={!loaded || busy || boxes.length === 0}
          onClick={apply}
        >
          {busy ? "Applying…" : `Apply (${boxes.length})`}
        </button>
      </div>
    </div>
  );
}
