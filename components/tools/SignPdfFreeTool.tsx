"use client";

// SignPdfFreeTool — Tier 1 §1.6 P0. The last P0 outside §1.5.
//
// Free signature placement on PDFs. Three input modes:
//   1. Draw — HTML5 canvas with pointer events (mouse + touch).
//      Captures strokes into a path list, rasterises to PNG on
//      commit via canvas.toDataURL('image/png').
//   2. Type — text input → rendered to an off-screen canvas with
//      an italic system font approximating a script signature,
//      exported as PNG. This is deliberately NOT cursive calligraphy
//      (browser-side font loading for signature fonts is a CSP /
//      privacy headache); pragmatic italic Helvetica lines up with
//      what iLovePDF / Smallpdf deliver.
//   3. Upload — PNG / JPEG file picker. PNG with alpha preserves
//      transparency through pdf-lib's embedPng.
//
// Once a signature exists in any of the three modes, the user
// clicks on a rendered PDF page to place a copy. Multiple
// placements per signature, multi-page via Prev/Next, pdf-lib
// embedPng + drawImage on apply.
//
// Not shipped in v1: digital certificate signing (ISO 32000 DigSig
// annotation), timestamp-authority integration, multiple distinct
// signatures per session. All roadmapped separately.

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { PDFDocument } from "pdf-lib";
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

// The drawing canvas is a fixed pixel size — we rescale to target
// placement size at draw time in pdf-lib. 600×200 gives enough
// resolution for crisp PNG export at typical signature sizes
// (150×50 pt ≈ 2×1 inch on print) without bloating the resource
// dict.
const DRAW_W = 600;
const DRAW_H = 200;

type Placement = {
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

type SigMode = "draw" | "type" | "upload";

// 0-1 point units. Final placement width is this value * page
// width, scale preserved via natural PNG aspect ratio.
const DEFAULT_SIG_WIDTH_PT = 160;

export function SignPdfFreeTool() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [busy, setBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    bytes: Uint8Array;
    name: string;
    size: number;
  } | null>(null);

  // Signature source state.
  const [mode, setMode] = useState<SigMode>("draw");
  const [typedName, setTypedName] = useState("");
  const [sigPng, setSigPng] = useState<{
    dataUrl: string;
    bytes: Uint8Array;
    aspect: number; // width / height
  } | null>(null);
  const [sizePt, setSizePt] = useState<number>(DEFAULT_SIG_WIDTH_PT);

  const pageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const hasStrokesRef = useRef(false);

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setError(null);
    setResult(null);
    setPlacements([]);
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
        const canvas = pageCanvasRef.current;
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
          console.error(err);
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
    setPlacements([]);
    setPageIndex(0);
    setError(null);
    setResult(null);
    setSigPng(null);
    setTypedName("");
  };

  // ── Drawing mode ────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "draw") return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    canvas.width = DRAW_W;
    canvas.height = DRAW_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, DRAW_W, DRAW_H);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    hasStrokesRef.current = false;
  }, [mode]);

  const getDrawPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * DRAW_W,
      y: ((e.clientY - rect.top) / rect.height) * DRAW_H,
    };
  };

  const onDrawDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    lastPtRef.current = getDrawPoint(e);
  };
  const onDrawMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pt = getDrawPoint(e);
    const last = lastPtRef.current;
    if (!pt || !last) return;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPtRef.current = pt;
    hasStrokesRef.current = true;
  };
  const onDrawUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    isDrawingRef.current = false;
  };

  const clearDrawing = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, DRAW_W, DRAW_H);
    hasStrokesRef.current = false;
  };

  const commitDrawnSignature = () => {
    if (!hasStrokesRef.current) {
      setError("Draw your signature first.");
      return;
    }
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    // Trim white margins would be ideal but adds complexity; ship
    // the full-canvas PNG and let the placement scale handle size.
    const dataUrl = canvas.toDataURL("image/png");
    const bytes = dataUrlToBytes(dataUrl);
    setSigPng({ dataUrl, bytes, aspect: DRAW_W / DRAW_H });
    setError(null);
  };

  // ── Type mode ────────────────────────────────────────────────────
  const commitTypedSignature = () => {
    if (!typedName.trim()) {
      setError("Type your name first.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = DRAW_W;
    canvas.height = DRAW_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, DRAW_W, DRAW_H);
    ctx.fillStyle = "black";
    // Italic approximation of a script sig. Stack falls back
    // through common italic-capable families the user likely has
    // installed. "Brush Script MT" covers macOS; "Segoe Script"
    // covers Windows; "cursive" is the CSS generic fallback.
    ctx.font =
      'italic 90px "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive';
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(typedName, DRAW_W / 2, DRAW_H / 2);
    const dataUrl = canvas.toDataURL("image/png");
    const bytes = dataUrlToBytes(dataUrl);
    setSigPng({ dataUrl, bytes, aspect: DRAW_W / DRAW_H });
    setError(null);
  };

  // ── Upload mode ──────────────────────────────────────────────────
  const onUpload = async (f: File) => {
    setError(null);
    const lower = f.name.toLowerCase();
    if (
      !(f.type === "image/png" || f.type === "image/jpeg" ||
        lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
    ) {
      setError("Upload must be PNG or JPEG.");
      return;
    }
    const arr = await f.arrayBuffer();
    const bytes = new Uint8Array(arr);
    const blob = new Blob([bytes], { type: f.type || "image/png" });
    const bitmap = await createImageBitmap(blob);
    const aspect = bitmap.width / bitmap.height;
    bitmap.close();
    const dataUrl = await blobToDataUrl(blob);
    setSigPng({ dataUrl, bytes, aspect });
  };

  // ── Place on page ────────────────────────────────────────────────
  const onPageClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!loaded || !canvasSize || !sigPng || busy) return;
    const canvas = pageCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssToCanvas = canvas.width / rect.width;
    const xCanvas = (e.clientX - rect.left) * cssToCanvas;
    const yCanvas = (e.clientY - rect.top) * cssToCanvas;
    const pageH = loaded.pageSizes[pageIndex]?.heightPt ?? 0;
    const widthPt = sizePt;
    const heightPt = widthPt / sigPng.aspect;
    const xPdf = xCanvas / RENDER_SCALE - widthPt / 2;
    const yPdf = pageH - yCanvas / RENDER_SCALE - heightPt / 2;
    setPlacements((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2, 12),
        pageIndex,
        xPdf,
        yPdf,
        widthPt,
        heightPt,
      },
    ]);
  };

  const removePlacement = (id: string) => {
    setPlacements((prev) => prev.filter((p) => p.id !== id));
  };

  const apply = async () => {
    if (!loaded) return;
    if (!sigPng) {
      setError("Create or upload a signature first.");
      return;
    }
    if (placements.length === 0) {
      setError("Click on the page to place the signature at least once.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const doc = await PDFDocument.load(loaded.buffer.slice(0), {
        ignoreEncryption: true,
      });
      const embedded = await doc.embedPng(sigPng.bytes);
      for (const p of placements) {
        const page = doc.getPage(p.pageIndex);
        page.drawImage(embedded, {
          x: p.xPdf,
          y: p.yPdf,
          width: p.widthPt,
          height: p.heightPt,
        });
      }
      const bytes = await doc.save({ useObjectStreams: true });
      const name = deriveOutputName(loaded.file.name, "-signed");
      setResult({ bytes, name, size: bytes.length });
      try {
        const sha256 = await sha256HexOfBytes(bytes);
        await logToolResultAction({
          toolId: "sign-pdf-free",
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
      setError(err instanceof Error ? err.message : "Signing failed.");
    } finally {
      setBusy(false);
    }
  };

  const currentPlacements = useMemo(
    () => placements.filter((p) => p.pageIndex === pageIndex),
    [placements, pageIndex]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!loaded ? (
        <ToolDropzone
          onFiles={onFiles}
          disabled={busy}
          prompt="Drop a PDF to sign"
        />
      ) : (
        <div
          className="card"
          style={{ padding: "14px 16px", display: "flex", gap: 12, alignItems: "center" }}
        >
          <span style={{ color: "var(--fg-subtle)" }}>
            <I.File size={18} />
          </span>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div title={loaded.file.name} style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {loaded.file.name}
            </div>
            <div className="subtle" style={{ fontSize: 12 }}>
              {humanSize(loaded.file.size)} · {loaded.pageSizes.length} page
              {loaded.pageSizes.length === 1 ? "" : "s"} · {placements.length} signature placement
              {placements.length === 1 ? "" : "s"}
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={reset} aria-label="Remove file">
            <I.X size={14} />
          </button>
        </div>
      )}

      {loaded && (
        <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-subtle)" }}>
            STEP 1 — CREATE YOUR SIGNATURE
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["draw", "type", "upload"] as SigMode[]).map((m) => {
              const selected = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setSigPng(null); }}
                  disabled={busy}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "var(--radius)",
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    background: selected ? "var(--accent-soft)" : "var(--bg-1)",
                    color: selected ? "var(--accent)" : "var(--fg)",
                    fontSize: 13,
                    fontWeight: selected ? 600 : 400,
                    cursor: busy ? "not-allowed" : "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {mode === "draw" && (
            <>
              <canvas
                ref={drawCanvasRef}
                onPointerDown={onDrawDown}
                onPointerMove={onDrawMove}
                onPointerUp={onDrawUp}
                onPointerLeave={onDrawUp}
                style={{
                  width: "100%",
                  maxWidth: 600,
                  aspectRatio: `${DRAW_W} / ${DRAW_H}`,
                  background: "white",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius)",
                  touchAction: "none",
                  cursor: busy ? "default" : "crosshair",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={clearDrawing} disabled={busy}>
                  Clear
                </button>
                <button type="button" className="btn btn-primary" onClick={commitDrawnSignature} disabled={busy}>
                  Use this signature
                </button>
              </div>
            </>
          )}

          {mode === "type" && (
            <>
              <input
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Type your name"
                disabled={busy}
                style={{
                  padding: "10px 14px",
                  fontSize: 24,
                  fontStyle: "italic",
                  fontFamily: '"Brush Script MT", "Segoe Script", cursive',
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius)",
                  background: "white",
                  color: "black",
                }}
              />
              <div className="subtle" style={{ fontSize: 11 }}>
                Rendered in an italic script-like font (best effort — depends on
                your system's installed fonts).
              </div>
              <button type="button" className="btn btn-primary" onClick={commitTypedSignature} disabled={busy}>
                Use this signature
              </button>
            </>
          )}

          {mode === "upload" && (
            <label
              style={{
                display: "block",
                padding: 20,
                border: "1px dashed var(--border-strong)",
                borderRadius: "var(--radius)",
                textAlign: "center",
                cursor: busy ? "not-allowed" : "pointer",
                fontSize: 13,
                color: "var(--fg-subtle)",
              }}
            >
              Upload a PNG or JPEG of your signature. PNG with transparent
              background works best.
              <input
                type="file"
                accept="image/png,image/jpeg"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                }}
                style={{ display: "none" }}
              />
            </label>
          )}

          {sigPng && (
            <div
              style={{
                padding: 12,
                border: "1px solid var(--accent)",
                background: "var(--accent-soft)",
                borderRadius: "var(--radius)",
                display: "flex",
                gap: 12,
                alignItems: "center",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sigPng.dataUrl}
                alt="Signature preview"
                style={{ width: 120, height: "auto", background: "white", borderRadius: 4 }}
              />
              <div style={{ flex: 1, fontSize: 13 }}>
                <strong>Signature ready.</strong> Now click anywhere on the page
                below to place it. Width {sizePt}pt; click again to place multiple
                copies (different pages work too).
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
                <span style={{ color: "var(--fg-subtle)" }}>WIDTH</span>
                <input
                  type="number"
                  min={40}
                  max={400}
                  step={10}
                  value={sizePt}
                  onChange={(e) => setSizePt(Math.max(40, Math.min(400, Number(e.target.value) || 160)))}
                  style={{
                    width: 72,
                    padding: "6px 8px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 4,
                    background: "var(--bg-1)",
                    color: "var(--fg)",
                    fontSize: 12,
                  }}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {loaded && (
        <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-subtle)" }}>
            STEP 2 — PLACE YOUR SIGNATURE
          </div>
          <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <button type="button" className="btn btn-ghost" disabled={busy || pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))}>
              <I.ArrowLeft size={14} /><span>Prev</span>
            </button>
            <div className="mono" style={{ fontSize: 13, color: "var(--fg-subtle)" }}>
              Page {pageIndex + 1} / {loaded.pageSizes.length}
              {renderBusy ? " · rendering…" : ""}
            </div>
            <button type="button" className="btn btn-ghost" disabled={busy || pageIndex >= loaded.pageSizes.length - 1} onClick={() => setPageIndex((p) => Math.min(loaded.pageSizes.length - 1, p + 1))}>
              <span>Next</span><I.ArrowRight size={14} />
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
                ref={pageCanvasRef}
                onClick={onPageClick}
                style={{
                  display: "block",
                  width: "100%",
                  maxWidth: canvasSize ? canvasSize.w : undefined,
                  height: "auto",
                  background: "var(--bg-1)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  cursor: sigPng ? "crosshair" : "default",
                  userSelect: "none",
                }}
              />
              {canvasSize && currentPlacements.map((p) => {
                const pageH = loaded.pageSizes[pageIndex]?.heightPt ?? 0;
                const pageWpx = canvasSize.w / RENDER_SCALE;
                const pageHpx = canvasSize.h / RENDER_SCALE;
                const leftPct = (p.xPdf / pageWpx) * 100;
                const topPct = ((pageH - p.yPdf - p.heightPt) / pageHpx) * 100;
                const widthPct = (p.widthPt / pageWpx) * 100;
                const heightPct = (p.heightPt / pageHpx) * 100;
                return (
                  <div
                    key={p.id}
                    style={{
                      position: "absolute",
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${widthPct}%`,
                      height: `${heightPct}%`,
                      background: sigPng ? `url(${sigPng.dataUrl}) center / contain no-repeat` : undefined,
                      border: "1px dashed var(--accent)",
                      pointerEvents: "auto",
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removePlacement(p.id); }}
                      aria-label="Remove placement"
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        border: "none",
                        background: "rgba(0,0,0,0.6)",
                        color: "white",
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
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>
      )}

      {result && (
        <div className="card" style={{ padding: 20, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--accent)", color: "var(--bg-1)", display: "grid", placeItems: "center" }}>
              <I.Check size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>Signature applied</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {placements.length} placement{placements.length === 1 ? "" : "s"} · {humanSize(result.size)}
              </div>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => downloadBytes(result.bytes, result.name)}>
              <I.Download size={14} />
              <span>Download</span>
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
        {loaded && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={reset}>
            Reset
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!loaded || busy || !sigPng || placements.length === 0}
          onClick={apply}
        >
          {busy ? "Signing…" : `Sign & download (${placements.length})`}
        </button>
      </div>
    </div>
  );
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
