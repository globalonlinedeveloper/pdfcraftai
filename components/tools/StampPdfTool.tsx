"use client";

// StampPdfTool — Tier 1 §1.5 P1.
//
// Preset business stamps (DRAFT, CONFIDENTIAL, APPROVED, PAID, RECEIVED,
// REVIEWED, COPY, ORIGINAL, VOID, FINAL) drawn onto chosen pages with
// rotation + colored bordered rectangle for that classic rubber-stamp
// look. Pure pdf-lib — no canvas overlay needed because the position
// is grid-driven (top/middle/bottom × left/center/right), not click-
// driven like Add Text Box.
//
// Why this is distinct from Image Watermark:
// - Image Watermark = arbitrary user-supplied logo, scale slider,
//   opacity slider, repeat patterns. Power-user tool.
// - Stamp PDF = preset business stamps with the conventional look
//   (red border, rotated text, classic stamp colors). Fast workflow
//   for the common case "stamp this DRAFT" / "mark APPROVED".
//
// SEO: "add stamp to pdf", "draft stamp pdf", "approved stamp pdf
// online", "confidential stamp pdf".

import { useState, useCallback } from "react";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import {
  deriveOutputName,
  downloadBytes,
  humanSize,
  parsePageRanges,
  sha256HexOfBytes,
} from "@/lib/client/pdf-utils";
import { logToolResultAction } from "@/lib/tool-result-actions";
import { useTrackToolView } from "./useToolTracking";

type StampPreset = {
  id: string;
  text: string;
  // Default color hint per stamp — REJECTED red, APPROVED green, etc.
  // RGB 0-1 to match pdf-lib's rgb() signature directly.
  r: number;
  g: number;
  b: number;
};

const STAMPS: StampPreset[] = [
  { id: "draft", text: "DRAFT", r: 0.85, g: 0.1, b: 0.1 },
  { id: "confidential", text: "CONFIDENTIAL", r: 0.85, g: 0.1, b: 0.1 },
  { id: "approved", text: "APPROVED", r: 0.1, g: 0.55, b: 0.2 },
  { id: "rejected", text: "REJECTED", r: 0.85, g: 0.1, b: 0.1 },
  { id: "paid", text: "PAID", r: 0.1, g: 0.55, b: 0.2 },
  { id: "received", text: "RECEIVED", r: 0.1, g: 0.4, b: 0.65 },
  { id: "reviewed", text: "REVIEWED", r: 0.1, g: 0.4, b: 0.65 },
  { id: "copy", text: "COPY", r: 0.4, g: 0.4, b: 0.4 },
  { id: "original", text: "ORIGINAL", r: 0.1, g: 0.4, b: 0.65 },
  { id: "void", text: "VOID", r: 0.85, g: 0.1, b: 0.1 },
  { id: "final", text: "FINAL", r: 0.1, g: 0.55, b: 0.2 },
  { id: "urgent", text: "URGENT", r: 0.95, g: 0.55, b: 0.05 },
];

type Position =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "middle-center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

type Loaded = { file: File; pageCount: number };

export function StampPdfTool() {
  useTrackToolView("stamp-pdf", "Edit");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stampId, setStampId] = useState<string>("draft");
  const [customText, setCustomText] = useState<string>("");
  const [useCustom, setUseCustom] = useState<boolean>(false);
  const [position, setPosition] = useState<Position>("middle-center");
  const [angle, setAngle] = useState<number>(-20);
  const [opacity, setOpacity] = useState<number>(75);
  const [pageRange, setPageRange] = useState<string>("");
  const [result, setResult] = useState<{ bytes: Uint8Array; name: string; size: number } | null>(null);

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
    const stamp = STAMPS.find((s) => s.id === stampId)!;
    const text = useCustom ? customText.trim() : stamp.text;
    if (!text) {
      setError("Stamp text can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const doc = await PDFDocument.load(await loaded.file.arrayBuffer(), { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.HelveticaBold);

      // Decide which pages to stamp.
      const pages = doc.getPages();
      // parsePageRanges returns groups of 1-based page numbers (number[][]).
      // Flatten + dedupe + zero-base for our drawing loop.
      const targetIdx = pageRange.trim()
        ? Array.from(
            new Set(parsePageRanges(pageRange, pages.length).flat())
          ).map((n) => n - 1)
        : pages.map((_, i) => i);
      if (targetIdx.length === 0) {
        setError("No valid pages in that range.");
        setBusy(false);
        return;
      }

      // Stamp font size scales with page short edge so "DRAFT" looks
      // proportional on a4, letter, A3, etc.
      for (const idx of targetIdx) {
        const page = pages[idx];
        const { width, height } = page.getSize();
        const shortEdge = Math.min(width, height);
        const fontSize = Math.max(36, shortEdge * 0.12);
        const textWidth = font.widthOfTextAtSize(text, fontSize);
        const textHeight = font.heightAtSize(fontSize);
        const padding = fontSize * 0.4;
        const boxWidth = textWidth + padding * 2;
        const boxHeight = textHeight + padding * 1.2;

        // Anchor coordinates in PDF space (origin at bottom-left).
        const margin = shortEdge * 0.08;
        let cx: number, cy: number;
        switch (position) {
          case "top-left":      cx = margin + boxWidth / 2;       cy = height - margin - boxHeight / 2; break;
          case "top-center":    cx = width / 2;                    cy = height - margin - boxHeight / 2; break;
          case "top-right":     cx = width - margin - boxWidth / 2; cy = height - margin - boxHeight / 2; break;
          case "middle-left":   cx = margin + boxWidth / 2;       cy = height / 2; break;
          case "middle-center": cx = width / 2;                    cy = height / 2; break;
          case "middle-right":  cx = width - margin - boxWidth / 2; cy = height / 2; break;
          case "bottom-left":   cx = margin + boxWidth / 2;       cy = margin + boxHeight / 2; break;
          case "bottom-center": cx = width / 2;                    cy = margin + boxHeight / 2; break;
          case "bottom-right":  cx = width - margin - boxWidth / 2; cy = margin + boxHeight / 2; break;
        }

        const opacityValue = opacity / 100;
        const stampColor = rgb(stamp.r, stamp.g, stamp.b);

        // Rectangle border + text, both rotated about (cx, cy). pdf-lib
        // rotation pivots about the supplied (x, y) point — we move the
        // rectangle's local origin to its center then back out via
        // trigonometry. Easier: draw rectangle's bottom-left at (cx -
        // boxWidth/2, cy - boxHeight/2) WITHOUT rotation, then draw a
        // second pass with manual rotation? pdf-lib's drawRectangle
        // takes a `rotate` arg that pivots about the bottom-left.
        //
        // Simpler approach: pre-compute the four corner points of the
        // unrotated rectangle relative to (cx, cy), then apply 2D
        // rotation analytically and draw the rectangle's bottom-left
        // at the rotated corner. drawText follows the same pattern.
        const rad = (angle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        // Bottom-left corner of the *unrotated* rectangle, relative to
        // center: (-boxWidth/2, -boxHeight/2).
        const dx = -boxWidth / 2;
        const dy = -boxHeight / 2;
        // Rotate it about origin to get corner offset post-rotation.
        const rotatedBlX = cx + dx * cos - dy * sin;
        const rotatedBlY = cy + dx * sin + dy * cos;

        page.drawRectangle({
          x: rotatedBlX,
          y: rotatedBlY,
          width: boxWidth,
          height: boxHeight,
          borderColor: stampColor,
          borderWidth: Math.max(2, fontSize * 0.06),
          color: undefined, // transparent fill — we want the doc visible behind the stamp
          opacity: opacityValue,
          borderOpacity: opacityValue,
          rotate: degrees(angle),
        });

        // Text baseline sits at (textOriginX, textOriginY) — pdf-lib
        // rotates around the text's bottom-left. To get the text
        // centered in the rotated rectangle, we use the same
        // rotated-corner trick with the text's local bottom-left.
        const textDx = -textWidth / 2;
        const textDy = -textHeight / 2 + fontSize * 0.2; // visual centering nudge
        const textBlX = cx + textDx * cos - textDy * sin;
        const textBlY = cy + textDx * sin + textDy * cos;

        page.drawText(text, {
          x: textBlX,
          y: textBlY,
          size: fontSize,
          font,
          color: stampColor,
          opacity: opacityValue,
          rotate: degrees(angle),
        });
      }

      const bytes = await doc.save({ useObjectStreams: true });
      const name = deriveOutputName(loaded.file.name, "-stamped");
      setResult({ bytes, name, size: bytes.length });

      try {
        const sha256 = await sha256HexOfBytes(bytes);
        await logToolResultAction({
          toolId: "stamp-pdf",
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
      setError(err instanceof Error ? err.message : "Stamp failed.");
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
          prompt="Drop a PDF to stamp"
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

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Stamp picker */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>
                Stamp
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {STAMPS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setStampId(s.id); setUseCustom(false); }}
                    style={{
                      padding: "6px 12px",
                      border: `2px solid rgb(${s.r * 255}, ${s.g * 255}, ${s.b * 255})`,
                      background: stampId === s.id && !useCustom
                        ? `rgba(${s.r * 255}, ${s.g * 255}, ${s.b * 255}, 0.12)`
                        : "transparent",
                      color: `rgb(${s.r * 255}, ${s.g * 255}, ${s.b * 255})`,
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      cursor: "pointer",
                    }}
                  >
                    {s.text}
                  </button>
                ))}
                <label
                  style={{
                    padding: "6px 12px",
                    border: useCustom ? "2px solid var(--accent)" : "2px dashed var(--border)",
                    background: useCustom ? "var(--accent-soft)" : "transparent",
                    color: useCustom ? "var(--accent)" : "var(--fg-subtle)",
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useCustom}
                    onChange={(e) => setUseCustom(e.target.checked)}
                    style={{ margin: 0 }}
                  />
                  Custom
                </label>
              </div>
              {useCustom && (
                <input
                  type="text"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value.slice(0, 30).toUpperCase())}
                  placeholder="YOUR STAMP TEXT"
                  maxLength={30}
                  style={{
                    marginTop: 8,
                    padding: "8px 12px",
                    width: "100%",
                    background: "var(--bg-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                />
              )}
            </div>

            {/* Position grid */}
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Position</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, maxWidth: 200 }}>
                {(["top-left","top-center","top-right","middle-left","middle-center","middle-right","bottom-left","bottom-center","bottom-right"] as Position[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPosition(p)}
                    style={{
                      aspectRatio: "1.4 / 1",
                      background: position === p ? "var(--accent)" : "var(--bg-2)",
                      border: "1px solid var(--border)",
                      color: position === p ? "var(--bg-1)" : "var(--fg-subtle)",
                      borderRadius: 4,
                      fontSize: 10,
                      cursor: "pointer",
                    }}
                    aria-label={p}
                  >
                    ●
                  </button>
                ))}
              </div>
            </div>

            {/* Sliders */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--fg-subtle)" }}>Rotation: {angle}°</label>
                <input type="range" min={-45} max={45} value={angle} onChange={(e) => setAngle(parseInt(e.target.value, 10))} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--fg-subtle)" }}>Opacity: {opacity}%</label>
                <input type="range" min={20} max={100} value={opacity} onChange={(e) => setOpacity(parseInt(e.target.value, 10))} style={{ width: "100%" }} />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>
                Pages (blank = all)
              </label>
              <input
                type="text"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                placeholder="e.g. 1, 3-5, 7"
                style={{ padding: "8px 12px", width: "100%", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
              />
            </div>
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
              <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}>Stamp applied</div>
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
          {busy ? "Stamping…" : "Apply stamp"}
        </button>
      </div>
    </div>
  );
}
