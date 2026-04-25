"use client";

// GrayscalePdfTool — Tier 1 §1.2 P1.
//
// Convert color PDF to grayscale. Each page is rendered to canvas via
// pdfjs-dist, the canvas pixels are converted to grayscale via the
// luminance formula (0.299R + 0.587G + 0.114B), then the resulting PNG
// is embedded as a single image filling a fresh page in the output PDF.
//
// Use cases:
// - Print prep (B&W laser saves color toner)
// - Submit-as-PDF requirements that disallow color (some legal/govt forms)
// - Reduce visual noise for text-heavy archives
//
// Trade-off: rasterizing loses selectable text. The output is image-only.
// We surface this in the UI so users with text-search needs don't ship
// a search-broken PDF by accident. For text-aware grayscale (preserves
// text selection but converts ink to gray), a true content-stream
// remap is needed — that's a paid AI tier roadmap item.
//
// SEO: "convert pdf to grayscale", "pdf to black and white", "color
// pdf to bw online".

import { useState, useCallback, useRef } from "react";
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
import { useTrackToolView } from "./useToolTracking";

type Loaded = { file: File; pageCount: number };

const SCALE_PRESETS = {
  draft: { scale: 1.0, label: "Draft (96 DPI)" },
  standard: { scale: 1.5, label: "Standard (144 DPI)" },
  hi: { scale: 2.0, label: "High (192 DPI)" },
  print: { scale: 2.5, label: "Print (240 DPI)" },
};

export function GrayscalePdfTool() {
  useTrackToolView("grayscale-pdf", "Optimize");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [scaleId, setScaleId] = useState<keyof typeof SCALE_PRESETS>("standard");
  const [result, setResult] = useState<{ bytes: Uint8Array; name: string; size: number } | null>(null);
  const cancelRef = useRef<boolean>(false);

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      setLoaded({ file: f, pageCount: doc.getPageCount() });
    } catch (err) {
      setError(err instanceof Error && /encrypted|password/i.test(err.message)
        ? "This PDF is password-protected. Unlock it first."
        : "Couldn't read that PDF. It may be corrupt.");
      setLoaded(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = () => {
    cancelRef.current = true;
    setLoaded(null);
    setError(null);
    setResult(null);
    setProgress(null);
  };

  const run = async () => {
    if (!loaded) return;
    setBusy(true);
    setError(null);
    setResult(null);
    cancelRef.current = false;
    setProgress({ done: 0, total: loaded.pageCount });
    try {
      const buf = await loaded.file.arrayBuffer();
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs-worker.min.mjs";
      }

      const src = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
      const out = await PDFDocument.create();
      const scale = SCALE_PRESETS[scaleId].scale;

      for (let p = 1; p <= src.numPages; p++) {
        if (cancelRef.current) {
          setError("Cancelled.");
          setBusy(false);
          return;
        }
        const page = await src.getPage(p);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Couldn't get 2D canvas context.");
        // White background — pdfjs renders transparent backgrounds for
        // pages that don't have an opaque /MediaBox rectangle, which
        // would translate to black after grayscale + JPEG re-encode.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        // Pixel walk: luminance formula (Rec. 601 weights — slightly
        // better perceptual fidelity than naive R+G+B/3).
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = img.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          data[i] = y;
          data[i + 1] = y;
          data[i + 2] = y;
          // alpha (data[i + 3]) untouched
        }
        ctx.putImageData(img, 0, 0);

        // Encode to PNG (lossless — preserves the grayscale walk we
        // just did). JPEG would re-introduce color noise via chroma
        // subsampling.
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob((b) => res(b), "image/png")
        );
        if (!blob) throw new Error("Canvas → PNG encode failed.");
        const pngBytes = new Uint8Array(await blob.arrayBuffer());
        const embedded = await out.embedPng(pngBytes);

        // Output page matches the original page's PDF-point dimensions
        // (viewport at scale=1.0). The embedded PNG is drawn to fill
        // the page exactly — no margins, no scaling shifts.
        const sheet = out.addPage([viewport.width / scale, viewport.height / scale]);
        sheet.drawImage(embedded, {
          x: 0,
          y: 0,
          width: sheet.getWidth(),
          height: sheet.getHeight(),
        });

        setProgress({ done: p, total: src.numPages });
      }

      const bytes = await out.save({ useObjectStreams: true });
      const name = deriveOutputName(loaded.file.name, "-grayscale");
      setResult({ bytes, name, size: bytes.length });

      try {
        const sha256 = await sha256HexOfBytes(bytes);
        await logToolResultAction({
          toolId: "grayscale-pdf",
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
      setError(err instanceof Error ? err.message : "Grayscale conversion failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!loaded ? (
        <ToolDropzone
          onFiles={onFiles}
          disabled={busy}
          prompt="Drop a PDF to convert to grayscale (black & white)"
        />
      ) : (
        <>
          <div className="card" style={{ padding: "14px 16px", display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ color: "var(--fg-subtle)" }}><I.File size={18} /></span>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div title={loaded.file.name} style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {loaded.file.name}
              </div>
              <div className="subtle" style={{ fontSize: 12 }}>
                {humanSize(loaded.file.size)} · {loaded.pageCount} page{loaded.pageCount === 1 ? "" : "s"}
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={reset} aria-label="Remove file">
              <I.X size={14} />
            </button>
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Render quality</label>
            <select
              value={scaleId}
              onChange={(e) => setScaleId(e.target.value as keyof typeof SCALE_PRESETS)}
              disabled={busy}
              style={{ padding: "8px 12px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, color: "var(--fg)" }}
            >
              {(Object.entries(SCALE_PRESETS) as [keyof typeof SCALE_PRESETS, typeof SCALE_PRESETS[keyof typeof SCALE_PRESETS]][]).map(([id, p]) => (
                <option key={id} value={id}>{p.label}</option>
              ))}
            </select>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Higher quality = bigger output file. Standard is fine for screen review;
              choose Print for hard-copy archive.
            </div>
          </div>

          <div className="card" style={{ padding: 14, fontSize: 13, color: "var(--fg-subtle)", background: "var(--bg-1)" }}>
            <strong style={{ color: "var(--fg)", display: "block", marginBottom: 4 }}>What this does:</strong>
            Each page is rasterized to grayscale using the standard luminance
            formula (Rec. 601). The output is image-only — selectable text and
            embedded fonts are NOT preserved. If you need both text-selectable
            AND grayscale, that&apos;s a content-stream color remap (paid roadmap
            item, not free-tier).
          </div>
        </>
      )}

      {error && <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>}

      {progress && (
        <div className="card" style={{ padding: 14 }}>
          <div className="subtle" style={{ fontSize: 12, marginBottom: 6 }}>
            Converting page {progress.done} of {progress.total}…
          </div>
          <div style={{ height: 6, background: "var(--bg-1)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              width: `${(progress.done / progress.total) * 100}%`,
              height: "100%",
              background: "var(--accent)",
              transition: "width 200ms linear",
            }} />
          </div>
        </div>
      )}

      {result && (
        <div className="card" style={{ padding: 20, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--accent)", color: "var(--bg-1)", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <I.Check size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}>Grayscale conversion complete</div>
              <div className="muted" style={{ fontSize: 13 }}>{humanSize(result.size)}</div>
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
        <button type="button" className="btn btn-primary" disabled={!loaded || busy} onClick={run}>
          {busy ? "Converting…" : "Convert to grayscale"}
        </button>
      </div>
    </div>
  );
}
