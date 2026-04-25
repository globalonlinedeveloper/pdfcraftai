"use client";

// BookletPdfTool — Tier 1 §1.1 P1.
//
// Saddle-stitch booklet imposition. Different problem from N-up:
//
// N-up = "tile multiple source pages onto one output sheet in reading
// order" — page 1 → top-left, page 2 → top-right, page 3 → bottom-left.
// Useful for compact printing.
//
// Booklet imposition = "shuffle pages so that when the printed sheets
// are folded in half and stapled at the spine, the pages read in
// natural order". Page 1 actually prints on the right half of sheet 1,
// front side; page 2 prints on the left half of sheet 1, back side;
// etc. The shuffle math is the imposition.
//
// Algorithm for N source pages (padded up to a multiple of 4 with
// blanks at the END so sheet 1's outer face starts at page 1):
//   sheets = N / 4
//   For sheet i (0-indexed):
//     output page 2i   (front of sheet): [N - 2i, 2i + 1]
//     output page 2i+1 (back  of sheet): [2i + 2, N - 2i - 1]
//   (1-indexed page numbers in the brackets above; left half first.)
//
// User prints output PDF as duplex (flip on long edge for landscape
// sheets), folds the stack in half, staples the spine — booklet.
//
// SEO: "pdf booklet maker", "saddle stitch pdf", "fold and staple pdf",
// "pdf imposition online".

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

const PAPER = {
  letter: { w: 792, h: 612, label: "US Letter (landscape)" },
  a4: { w: 842, h: 595, label: "A4 (landscape)" },
  legal: { w: 1008, h: 612, label: "US Legal (landscape)" },
  a3: { w: 1191, h: 842, label: "A3 (landscape)" },
};

type Loaded = { file: File; pageCount: number };

// 1-based page numbers; null = blank slot. Returns one entry per output
// PDF page; each entry is [leftHalf, rightHalf].
function bookletOrder(srcCount: number): Array<[number | null, number | null]> {
  const padded = Math.ceil(srcCount / 4) * 4;
  const sheets = padded / 4;
  const out: Array<[number | null, number | null]> = [];
  const safe = (n: number): number | null => (n >= 1 && n <= srcCount ? n : null);
  for (let i = 0; i < sheets; i++) {
    // Front of sheet i — outermost wraps innermost.
    out.push([safe(padded - 2 * i), safe(2 * i + 1)]);
    // Back of sheet i.
    out.push([safe(2 * i + 2), safe(padded - 2 * i - 1)]);
  }
  return out;
}

export function BookletPdfTool() {
  useTrackToolView("booklet-pdf", "Organize");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paperId, setPaperId] = useState<keyof typeof PAPER>("letter");
  const [margin, setMargin] = useState<number>(20);
  const [showSpineLine, setShowSpineLine] = useState<boolean>(false);
  const [result, setResult] = useState<{ bytes: Uint8Array; name: string; size: number; outputPages: number; padded: number } | null>(null);

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
    if (loaded.pageCount < 4) {
      setError("Booklet imposition needs at least 4 source pages (one folded sheet).");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const paper = PAPER[paperId];
      const src = await PDFDocument.load(await loaded.file.arrayBuffer(), { ignoreEncryption: true });
      const out = await PDFDocument.create();

      const order = bookletOrder(src.getPageCount());
      const padded = Math.ceil(src.getPageCount() / 4) * 4;
      const embeds = await out.embedPages(src.getPages());

      const halfWidth = (paper.w - margin * 2) / 2;
      const usableHeight = paper.h - margin * 2;

      for (const [leftIdx, rightIdx] of order) {
        const sheet = out.addPage([paper.w, paper.h]);
        const placements: Array<{ idx: number | null; xLeft: number }> = [
          { idx: leftIdx, xLeft: margin },
          { idx: rightIdx, xLeft: margin + halfWidth },
        ];
        for (const { idx, xLeft } of placements) {
          if (idx == null) continue;
          const embed = embeds[idx - 1]; // 1-based → 0-based
          const srcW = embed.width;
          const srcH = embed.height;
          const scale = Math.min(halfWidth / srcW, usableHeight / srcH);
          const drawW = srcW * scale;
          const drawH = srcH * scale;
          const drawX = xLeft + (halfWidth - drawW) / 2;
          const drawY = margin + (usableHeight - drawH) / 2;
          sheet.drawPage(embed, { x: drawX, y: drawY, width: drawW, height: drawH });
        }
        if (showSpineLine) {
          // Light vertical line down the center for fold guidance.
          sheet.drawLine({
            start: { x: paper.w / 2, y: margin / 2 },
            end:   { x: paper.w / 2, y: paper.h - margin / 2 },
            thickness: 0.5,
            opacity: 0.3,
          });
        }
      }

      const bytes = await out.save({ useObjectStreams: true });
      const name = deriveOutputName(loaded.file.name, "-booklet");
      setResult({
        bytes,
        name,
        size: bytes.length,
        outputPages: order.length,
        padded,
      });

      try {
        const sha256 = await sha256HexOfBytes(bytes);
        await logToolResultAction({
          toolId: "booklet-pdf",
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
      setError(err instanceof Error ? err.message : "Imposition failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!loaded ? (
        <ToolDropzone
          onFiles={onFiles}
          disabled={busy}
          prompt="Drop a PDF to impose as a saddle-stitch booklet"
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
                {humanSize(loaded.file.size)} · {loaded.pageCount} source page{loaded.pageCount === 1 ? "" : "s"}
                {loaded.pageCount % 4 !== 0 && (
                  <> → padded to {Math.ceil(loaded.pageCount / 4) * 4} (blanks added at end)</>
                )}
                {" → "}
                {Math.ceil(loaded.pageCount / 4) * 2} output sheet{Math.ceil(loaded.pageCount / 4) * 2 === 1 ? "" : "s"} (front + back)
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={reset} aria-label="Remove file">
              <I.X size={14} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

            <div>
              <label style={{ fontSize: 12, color: "var(--fg-subtle)" }}>Margin: {margin}pt</label>
              <input type="range" min={0} max={72} value={margin} onChange={(e) => setMargin(parseInt(e.target.value, 10))} style={{ width: "100%" }} />
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={showSpineLine} onChange={(e) => setShowSpineLine(e.target.checked)} />
              Draw a faint center line as a fold guide
            </label>
          </div>

          <div className="card" style={{ padding: 14, fontSize: 13, color: "var(--fg-subtle)", background: "var(--bg-1)" }}>
            <strong style={{ color: "var(--fg)", display: "block", marginBottom: 4 }}>How to print:</strong>
            Print double-sided with <em>flip on long edge</em>. Stack the printed sheets in
            order, fold the whole stack in half, then staple along the fold (saddle stitch).
            Pages will read in correct order. If you need to print single-sided, set your
            print dialog to "odd pages only" then "even pages only" with the paper re-fed.
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
              <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}>Booklet imposition complete</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {result.outputPages} output page{result.outputPages === 1 ? "" : "s"} ({result.padded} source pages incl. blanks) · {humanSize(result.size)}
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
          {busy ? "Imposing…" : "Make booklet"}
        </button>
      </div>
    </div>
  );
}
