"use client";

// components/tools/UploadedFilePreview.tsx
//
// M18 (#193, 2026-04-29): small page-1 thumbnail for AI tool upload
// cards. Lets the user verify they uploaded the right PDF before
// clicking the Apply button (which charges credits).
//
// Why a small preview, not the full PageEditorTool surface:
//   - AI tools don't NEED an interactive editor — their config is
//     global and applies doc-wide. They just need a visual
//     "yes, that's the right document" cue.
//   - Page-1 only — multi-page navigation would clutter the upload
//     card. Users who need full doc inspection have PdfInspector.
//   - Renders on top of the M25 cache, so handoff users
//     (free tool → AI tool via "Open in") see the preview instantly.
//
// Layout: ~120px tall thumbnail beside the file name + size. Falls
// back to a generic file icon if the render fails (don't block the
// tool flow on a render hiccup).

import { useEffect, useState } from "react";
import { I } from "@/components/icons/Icons";
import { useFirstPagePreview } from "./useFirstPagePreview";

export interface UploadedFilePreviewProps {
  /** The uploaded File. Pass null to clear. */
  file: File | null;
  /** Render scale for the preview. Default 1.0 (lower = faster
   *  render + smaller blob; AI tools don't need the higher detail
   *  that visual editors do). */
  scale?: number;
  /** Max thumbnail height in CSS pixels. Default 120. Width follows
   *  the page aspect ratio. */
  maxHeight?: number;
}

export function UploadedFilePreview({
  file,
  scale = 1.0,
  maxHeight = 120,
}: UploadedFilePreviewProps) {
  // Read file bytes once per file change. We don't pass the File
  // directly to useFirstPagePreview because the hook expects bytes.
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  useEffect(() => {
    if (!file) {
      setBytes(null);
      return;
    }
    let cancelled = false;
    file.arrayBuffer().then((buf) => {
      if (!cancelled) setBytes(new Uint8Array(buf));
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const { preview, rendering, error } = useFirstPagePreview(bytes, scale);

  if (!file) return null;

  // Common shell: fixed height, centered content.
  const shellStyle: React.CSSProperties = {
    width: "auto",
    height: maxHeight,
    minWidth: 80,
    aspectRatio: preview ? `${preview.pxWidth} / ${preview.pxHeight}` : "8.5 / 11",
    background: "var(--bg-2)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };

  if (rendering || (!preview && !error && bytes)) {
    return (
      <div style={shellStyle} aria-label="Loading preview">
        <span className="pulse-soft" style={{ color: "var(--fg-subtle)" }}>
          <I.File size={20} />
        </span>
      </div>
    );
  }

  if (error || !preview) {
    // Render failure — show a generic file icon. Don't block the tool.
    return (
      <div style={shellStyle} aria-label="Preview unavailable">
        <span style={{ color: "var(--fg-subtle)" }}>
          <I.File size={20} />
        </span>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={preview.url}
        alt="Page 1 preview"
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
