"use client";

// components/tools/PdfImageWatermarkTool.tsx
//
// Tier 5 (2026-04-28): image watermark / logo overlay. Two file
// inputs (PDF first, then image), config panel for position
// preset + opacity + scale. v1 is config-only — drag-to-position
// is a future v2 once we have multiple visual editors and the
// shared <PageEditorTool> base is justified.

import { useState, useCallback, useEffect, useRef } from "react";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import { humanSize } from "@/lib/client/pdf-utils";
import { useTrackToolView } from "./useToolTracking";
import type { ImagePosition } from "@/lib/pdf/ops/image-watermark";

interface ResultState {
  outputBytes: Uint8Array;
  outputFileName: string;
  pageCount: number;
}

interface PickedImage {
  file: File;
  bytes: Uint8Array;
  /** "image/png" or "image/jpeg" — anything else is rejected up front. */
  mime: "image/png" | "image/jpeg";
  /** Object URL for preview. Revoked on unmount/reset. */
  previewUrl: string;
}

const POSITIONS: Array<{ v: ImagePosition; label: string }> = [
  { v: "top-left", label: "↖" },
  { v: "top-center", label: "↑" },
  { v: "top-right", label: "↗" },
  { v: "center-left", label: "←" },
  { v: "center", label: "·" },
  { v: "center-right", label: "→" },
  { v: "bottom-left", label: "↙" },
  { v: "bottom-center", label: "↓" },
  { v: "bottom-right", label: "↘" },
];

export function PdfImageWatermarkTool() {
  const tracker = useTrackToolView("image-watermark", "Edit");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [image, setImage] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);

  const [position, setPosition] = useState<ImagePosition>("bottom-right");
  const [opacity, setOpacity] = useState(50);
  const [scale, setScale] = useState(25); // % of page width

  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    };
  }, [image]);

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
        setError("PDF over 100 MB — try a smaller one.");
        return;
      }
      setPdfFile(f);
      tracker.upload(f);
    },
    [tracker],
  );

  const onImagePicked = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    if (f.size > 10 * 1024 * 1024) {
      setError("Watermark image over 10 MB — try a smaller one.");
      return;
    }
    const lower = f.name.toLowerCase();
    let mime: "image/png" | "image/jpeg";
    if (f.type === "image/png" || lower.endsWith(".png")) {
      mime = "image/png";
    } else if (
      f.type === "image/jpeg" ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg")
    ) {
      mime = "image/jpeg";
    } else {
      setError("Watermark must be a PNG or JPG.");
      return;
    }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const blob = new Blob([bytes], { type: mime });
      // Revoke prior preview URL.
      if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
      setImage({
        file: f,
        bytes,
        mime,
        previewUrl: URL.createObjectURL(blob),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the image.");
    } finally {
      // Allow re-selecting the same file to trigger another change event.
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const removeImage = () => {
    if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    setImage(null);
    setError(null);
    setResult(null);
  };

  const reset = () => {
    if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    setPdfFile(null);
    setImage(null);
    setError(null);
    setResult(null);
    setBusy(false);
  };

  const run = async () => {
    if (!pdfFile || !image) {
      setError("Add both a PDF and a watermark image.");
      return;
    }
    setError(null);
    setBusy(true);
    const t0 = performance.now();
    try {
      const bytes = new Uint8Array(await pdfFile.arrayBuffer());
      const { imageWatermarkPdf } = await import(
        "@/lib/pdf/ops/image-watermark"
      );
      const r = await imageWatermarkPdf(bytes, {
        imageBytes: image.bytes,
        imageMime: image.mime,
        position,
        opacity: opacity / 100,
        widthScale: scale / 100,
      });
      const baseName = pdfFile.name.replace(/\.pdf$/i, "");
      setResult({
        outputBytes: r.bytes,
        outputFileName: `${baseName || "document"}-watermarked.pdf`,
        pageCount: r.pageCount,
      });
      tracker.success({
        creditCost: 0,
        pageCount: r.pageCount,
        processingMs: Math.round(performance.now() - t0),
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not apply the image watermark.",
      );
      tracker.error({ errorCode: "image_watermark_failed" });
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
      {!pdfFile ? (
        <ToolDropzone
          onFiles={onFiles}
          prompt="Drop a PDF to watermark"
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
                title={pdfFile.name}
              >
                {truncate(pdfFile.name)}
              </div>
              <div className="subtle" style={{ fontSize: 12 }}>
                {humanSize(pdfFile.size)}
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

      {pdfFile && !result && (
        <div
          className="card"
          style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}
        >
          {/* Image upload */}
          <div style={{ fontSize: 13, fontWeight: 500 }}>Watermark image</div>
          {image ? (
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 6,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                  overflow: "hidden",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.previewUrl}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={image.file.name}
                >
                  {truncate(image.file.name)}
                </div>
                <div className="subtle" style={{ fontSize: 11 }}>
                  {humanSize(image.bytes.length)} · {image.mime.replace("image/", "")}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={removeImage}
                disabled={busy}
                aria-label="Remove image"
              >
                <I.X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => imageInputRef.current?.click()}
              style={{ alignSelf: "flex-start" }}
            >
              <I.Image size={14} /> Choose PNG or JPG
            </button>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={onImagePicked}
            style={{ display: "none" }}
          />

          {/* Position picker — 3x3 grid */}
          <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>Position</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 44px)",
              gap: 4,
              alignSelf: "flex-start",
            }}
            role="radiogroup"
            aria-label="Watermark position"
          >
            {POSITIONS.map((opt) => (
              <button
                key={opt.v}
                type="button"
                role="radio"
                aria-checked={position === opt.v}
                onClick={() => setPosition(opt.v)}
                title={opt.v.replace(/-/g, " ")}
                style={{
                  height: 44,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 6,
                  border:
                    position === opt.v
                      ? "2px solid var(--accent)"
                      : "1px solid var(--border)",
                  background:
                    position === opt.v ? "var(--accent-soft)" : "var(--bg-1)",
                  color: position === opt.v ? "var(--accent)" : "var(--fg-muted)",
                  cursor: "pointer",
                  fontSize: 16,
                  font: "inherit",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Opacity + scale */}
          <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span>Opacity</span>
              <input
                type="range"
                min={5}
                max={100}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                style={{ width: 120 }}
              />
              <span
                className="subtle"
                style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", minWidth: 36 }}
              >
                {opacity}%
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span>Size</span>
              <input
                type="range"
                min={5}
                max={100}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                style={{ width: 120 }}
              />
              <span
                className="subtle"
                style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", minWidth: 48 }}
              >
                {scale}% of page
              </span>
            </label>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}

      {busy && (
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
            Applying image watermark…
          </div>
        </div>
      )}

      {result && (
        <div
          className="card"
          style={{ padding: "16px 20px" }}
          role="status"
          aria-live="polite"
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
                Watermarked {result.pageCount} page
                {result.pageCount === 1 ? "" : "s"}
              </div>
              <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                Output: {humanSize(result.outputBytes.length)}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={download}
            >
              <I.Download size={12} /> Download
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
        {result ? (
          <button type="button" className="btn btn-primary" onClick={reset}>
            Watermark another PDF
          </button>
        ) : (
          <>
            {(pdfFile || image) && (
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
              disabled={!pdfFile || !image || busy}
              onClick={run}
            >
              {busy
                ? "Stamping…"
                : !pdfFile
                  ? "Drop a PDF first"
                  : !image
                    ? "Pick an image"
                    : "Apply watermark"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
