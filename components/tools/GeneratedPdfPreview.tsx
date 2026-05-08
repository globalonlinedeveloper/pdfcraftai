"use client";

// 2026-05-08 — Item #10 from the improvement analysis: preview-
// before-download for AI-generated PDFs.
//
// Three AI tool runners produce a PDF as a base64 payload in their
// success card today: GeneratePdfTool / RedactPdfTool / SignPdfTool.
// The user clicks Apply, the AI op runs, and the success card
// shows a Download button — but no visual confirmation that the
// generated/redacted/signed PDF actually looks right. Users have
// to download AND open in a separate viewer to verify, which is
// friction for short-loop iterative work (e.g. "let me redact this
// contract, see if I missed any names, redact again").
//
// This component renders page 1 of the result PDF as a thumbnail
// inline in the success card. The user gets immediate visual
// confirmation, and only commits to download once it's right.
//
// Sister to UploadedFilePreview (which previews the INPUT before
// the user spends credits). Together they bracket the AI op:
// upload-preview before, generated-preview after.
//
// Why a separate component from UploadedFilePreview:
//   - Different input shape (base64 string vs File). Going through
//     File → arrayBuffer → bytes is wasteful when we already have
//     bytes via atob.
//   - Different default sizing. Output preview is the focal point
//     of the success card, so it gets a larger maxHeight default
//     (180 vs 120). The user is verifying the result, not just
//     scanning that they uploaded the right doc.
//   - Different fallback copy. Upload preview falls back to a
//     generic file icon silently; output preview should be more
//     explicit about the failure since the user is mid-flow and
//     might think the download button is broken.

import { useEffect, useState } from "react";
import { I } from "@/components/icons/Icons";
import { useFirstPagePreview } from "./useFirstPagePreview";

export interface GeneratedPdfPreviewProps {
  /** Base64-encoded PDF bytes from the AI op response. Pass null/
   *  empty string to clear (e.g. result reset). */
  base64: string | null;
  /** Render scale. Default 1.2 — slightly higher than the upload
   *  preview's 1.0 because the user is verifying the OUTPUT (more
   *  detail useful). */
  scale?: number;
  /** Max thumbnail height in CSS pixels. Default 180 — focal
   *  point of the success card vs UploadedFilePreview's 120 which
   *  is just an "is this the right doc" cue. */
  maxHeight?: number;
}

// Decode base64 string to Uint8Array. Avoid Buffer (server-only)
// and the deprecated atob-then-charCodeAt one-liner pattern; this
// is the canonical browser-safe approach. Wrapped in a try/catch
// because malformed base64 throws InvalidCharacterError — surface
// it as null bytes (the rendering branch handles the no-bytes case).
function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    console.warn("[GeneratedPdfPreview] base64 decode failed", err);
    return null;
  }
}

export function GeneratedPdfPreview({
  base64,
  scale = 1.2,
  maxHeight = 180,
}: GeneratedPdfPreviewProps) {
  // Decode base64 once per change. Memoizing via useMemo would also
  // work, but useEffect lets us null-out cleanly when base64 itself
  // is null/empty (a user resetting the form should clear the
  // preview, not keep stale bytes around).
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  useEffect(() => {
    if (!base64) {
      setBytes(null);
      return;
    }
    setBytes(base64ToBytes(base64));
  }, [base64]);

  const { preview, rendering, error } = useFirstPagePreview(bytes, scale);

  if (!base64) return null;

  const shellStyle: React.CSSProperties = {
    width: "auto",
    height: maxHeight,
    minWidth: 120,
    aspectRatio: preview ? `${preview.pxWidth} / ${preview.pxHeight}` : "8.5 / 11",
    background: "var(--bg-2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };

  if (rendering || (!preview && !error && bytes)) {
    return (
      <div style={shellStyle} aria-label="Rendering preview of generated PDF">
        <span className="pulse-soft" style={{ color: "var(--fg-subtle)" }}>
          <I.File size={24} />
        </span>
      </div>
    );
  }

  if (error || !preview) {
    // Output-preview failure is more disruptive than upload-preview
    // failure — the user is verifying the AI op result, not
    // confirming an upload. Surface an explicit-but-tasteful
    // fallback that doesn't hide the Download button (which still
    // works regardless of whether the preview rendered).
    return (
      <div
        style={{
          ...shellStyle,
          flexDirection: "column",
          gap: 6,
          padding: 12,
          textAlign: "center",
        }}
        aria-label="Preview unavailable — download to view"
      >
        <span style={{ color: "var(--fg-subtle)" }}>
          <I.File size={20} />
        </span>
        <span
          className="subtle"
          style={{ fontSize: 11, lineHeight: 1.4, maxWidth: 140 }}
        >
          Preview unavailable — download to view
        </span>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={preview.url}
        alt="Page 1 of the generated PDF"
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
    </div>
  );
}
