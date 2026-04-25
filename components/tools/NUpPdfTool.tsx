"use client";

// NUpPdfTool — Tier 1 §1.1 P1.
//
// "N-up" layout / multi-page-per-sheet imposition. Takes an N-page PDF
// and produces a new PDF where each output page contains 2/4/6/8/9
// scaled-down source pages tiled in a grid. The classic use case is
// printing a booklet or a study packet: 4 source pages on one sheet
// of letter/A4 saves paper and looks cleaner than printing each on
// its own.
//
// Implementation: pdf-lib's `embedPage` produces a `PDFEmbeddedPage`
// that can be placed (drawn) at any (x, y) with arbitrary scale. We
// loop the source, embed each page, then create new output pages and
// draw the embeds at grid positions.
//
// SEO: "n-up pdf", "2 up pdf", "4 pages on one sheet pdf", "booklet
// pdf online", "multi page per sheet pdf".

import { useState, useCallback } from "react";
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

type Layout = { id: string; cols: number; rows: number; label: string };

const LAYOUTS: Layout[] = [
  { id: "2up", cols: 2, rows: 1, label: "2-up (2 per sheet)" },
  { id: "4up", cols: 2, rows: 2, label: "4-up (2×2 grid)" },
  { id: "6up", cols: 3, rows: 2, label: "6-up (3×2 grid)" },
  { id: "8up", cols: 4, rows: 2, label: "8-up (4×2 grid)" },
  { id: "9up", cols: 3, rows: 3, label: "9-up (3×3 grid)" },
];

// Output paper presets — pdf-lib accepts dimensions in PDF points
// (72pt = 1 inch). We always emit landscape because a 2-up portrait
// source in landscape output keeps source pages right-side-up.
const PAPER = {
  letter: { w: 792, h: 612, label: "US Letter (landscape)" },
  a4: { w: 842, h: 595, label: "A4 (landscape)" },
  legal: { w: 1008, h: 612, label: "US Legal (landscape)" },
  a3: { w: 1191, h: 842, label: "A3 (landscape)" },
};

type Loaded = { file: File; pageCount: number };

export function NUpPdfTool() {
  useTrackToolView("n-up-pdf", "Organize");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layoutId, setLayoutId] = useState<string>("4up");
  const [paperId, setPaperId] = useState<keyof typeof PAPER>("letter");
  const [margin, setMargin] = useState<number>(20);
  const [gap, setGap] = useState<number>(10);
  const [drawBorder, setDrawBorder] = useState<boolean>(false);
  const [result, setResult] = useState<{ bytes: Uint8Array; name: string; size: number; outputPages: number } | null>(null);

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
    setLoaded(null);
    setError(null);
    setResult(null);
  };

  const run = async () => {
    if (!loaded) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const layout = LAYOUTS.find((l) => l.id === layoutId)!;
      const paper = PAPER[paperId];
      const slotsPerSheet = layout.cols * layout.rows;

      const src = await PDFDocument.load(await loaded.file.arrayBuffer(), { ignoreEncryption: true });
      const out = await PDFDocument.create();

      // Embed every source page once. PDFEmbeddedPage holds the page's
      // content stream + resources so we can drawPage() it at any
      // (x, y, scale) without re-copying everything per slot.
      const srcPageRefs = src.getPages();
      const srcCount = srcPageRefs.length;
      const embeds = await out.embedPages(srcPageRefs);

      // Compute slot dimensions on the output sheet.
      const usableWidth = paper.w - margin * 2 - gap * (layout.cols - 1);
      const usableHeight = paper.h - margin * 2 - gap * (layout.rows - 1);
      const slotWidth = usableWidth / layout.cols;
      const slotHeight = usableHeight / layout.rows;
      if (slotWidth < 50 || slotHeight < 50) {
        setError("Margins/gap leave the slots too small. Try lower margin or smaller gap.");
        setBusy(false);
        return;
      }

      let outputPages = 0;
      for (let i = 0; i < srcCount; i += slotsPerSheet) {
        const sheet = out.addPage([paper.w, paper.h]);
        outputPages++;
        for (let s = 0; s < slotsPerSheet; s++) {
          const srcIdx = i + s;
          if (srcIdx >= srcCount) break;
          const embed = embeds[srcIdx];

          // Slot grid position. Row 0 is the TOP visually; convert to
          // PDF space (origin at bottom-left) by counting rows from the
          // top down.
          const col = s % layout.cols;
          const rowFromTop = Math.floor(s / layout.cols);
          const slotX = margin + col * (slotWidth + gap);
          const slotY = paper.h - margin - (rowFromTop + 1) * slotHeight - rowFromTop * gap;

          // Aspect-preserving fit of the embedded page into the slot.
          const srcW = embed.width;
          const srcH = embed.height;
          const scale = Math.min(slotWidth / srcW, slotHeight / srcH);
          const drawW = srcW * scale;
          const drawH = srcH * scale;
          // Center within the slot.
          const drawX = slotX + (slotWidth - drawW) / 2;
          const drawY = slotY + (slotHeight - drawH) / 2;

          sheet.drawPage(embed, { x: drawX, y: drawY, width: drawW, height: drawH });

          if (drawBorder) {
            sheet.drawRectangle({
              x: drawX,
              y: drawY,
              width: drawW,
              height: drawH,
              borderWidth: 0.5,
              borderColor: undefined, // pdf-lib fills with a default if undefined; we want gray
            });
          }
        }
      }

      const bytes = await out.save({ useObjectStreams: true });
      const name = deriveOutputName(loaded.file.name, `-${layoutId}`);
      setResult({ bytes, name, size: bytes.length, outputPages });

      try {
        const sha256 = await sha256HexOfBytes(bytes);
        await logToolResultAction({
          toolId: "n-up-pdf",
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
      setError(err instanceof Error ? err.message : "N-up failed.");
    } finally {
      setBusy(false);
    }
  };

  const layoutPick = LAYOUTS.find((l) => l.id === layoutId)!;
  const slotsPerSheet = layoutPick.cols * layoutPick.rows;
  const expectedSheets = loaded ? Math.ceil(loaded.pageCount / slotsPerSheet) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!loaded ? (
        <ToolDropzone
          onFiles={onFiles}
          disabled={busy}
          prompt="Drop a PDF to combine multiple pages per sheet"
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
                {" → "}
                {expectedSheets} output sheet{expectedSheets === 1 ? "" : "s"}
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={reset} aria-label="Remove file">
              <I.X size={14} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Layout</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLayoutId(l.id)}
                    style={{
                      padding: "8px 12px",
                      border: "1px solid var(--border)",
                      background: layoutId === l.id ? "var(--accent)" : "var(--bg-2)",
                      color: layoutId === l.id ? "var(--bg-1)" : "var(--fg)",
                      borderRadius: 6,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Output paper</label>
              <select
                value={paperId}
                onChange={(e) => setPaperId(e.target.value as keyof typeof PAPER)}
                style={{ padding: "8px 12px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, color: "var(--fg)" }}
              >
                {(Object.entries(PAPER) as [keyof typeof PAPER, typeof PAPER[keyof typeof PAPER]][]).map(([id, p]) => (
                  <option key={id} value={id}>{p.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--fg-subtle)" }}>Margin: {margin}pt</label>
                <input type="range" min={0} max={72} value={margin} onChange={(e) => setMargin(parseInt(e.target.value, 10))} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--fg-subtle)" }}>Gap between slots: {gap}pt</label>
                <input type="range" min={0} max={48} value={gap} onChange={(e) => setGap(parseInt(e.target.value, 10))} style={{ width: "100%" }} />
              </div>
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={drawBorder} onChange={(e) => setDrawBorder(e.target.checked)} />
              Draw a thin border around each placed page
            </label>
          </div>
        </>
      )}

      {error && <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>}

      {result && (
        <div className="card" style={{ padding: 20, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--accent)", color: "var(--bg-1)", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <I.Check size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}>N-up complete</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {result.outputPages} sheet{result.outputPages === 1 ? "" : "s"} · {humanSize(result.size)}
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
        <button type="button" className="btn btn-primary" disabled={!loaded || busy} onClick={run}>
          {busy ? "Combining…" : "Combine pages"}
        </button>
      </div>
    </div>
  );
}
