"use client";

// components/tools/useFirstPagePreview.ts
//
// Tiny hook that renders page 1 of a PDF File once and exposes the
// resulting JPEG plus pt+px dimensions. Used by config-driven runner
// tools (Stamp, Page Numbers, etc) to show a live WYSIWYG preview as
// the user tweaks position / opacity / font-size — without porting
// the whole tool to PageEditorTool.
//
// Why not just reuse PageEditorTool: PageEditorTool is an interactive
// editor (click-to-place / drag-rect / pen) with state persistence.
// Stamp + Page Numbers don't need that — their config is global and
// applies doc-wide. They just want a visual confirmation, not an
// editor surface. This hook is the minimal lift to give them one.

import { useEffect, useRef, useState } from "react";

export interface FirstPagePreview {
  url: string;
  pxWidth: number;
  pxHeight: number;
  ptWidth: number;
  ptHeight: number;
  renderScale: number;
  pageCount: number;
}

interface State {
  preview: FirstPagePreview | null;
  rendering: boolean;
  error: string | null;
}

/**
 * Renders page 1 of the supplied File (Uint8Array form) and returns
 * the preview metadata. Re-renders if the file ref changes; revokes
 * the prior object URL on unmount or new file.
 *
 * Pass `null` to clear (e.g. on reset).
 */
export function useFirstPagePreview(
  bytes: Uint8Array | null,
  renderScale = 1.5,
): State {
  const [state, setState] = useState<State>({
    preview: null,
    rendering: false,
    error: null,
  });
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!bytes) {
      // Cleanup the previous preview's object URL.
      if (lastUrlRef.current) {
        URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = null;
      }
      setState({ preview: null, rendering: false, error: null });
      return;
    }

    setState((s) => ({ ...s, rendering: true, error: null }));

    (async () => {
      try {
        const { withPdfDocument } = await import("@/lib/pdf/library");
        const pageCount = await withPdfDocument(bytes, async (doc) =>
          doc.getPageCount(),
        );
        if (pageCount === 0) {
          throw new Error("This PDF has no pages.");
        }
        const { renderPdfPage } = await import("@/lib/pdf/ops/rasterize-page");
        const rendered = await renderPdfPage(bytes, {
          pageIndex: 0,
          format: "jpeg",
          scale: renderScale,
          quality: 0.85,
        });
        if (cancelled) return;
        const blob = new Blob([rendered.bytes], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        // Revoke prior URL after we've successfully built the new one
        // (so the <img> never points at a freshly-revoked URL).
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = url;
        setState({
          preview: {
            url,
            pxWidth: rendered.width,
            pxHeight: rendered.height,
            ptWidth: rendered.width / renderScale,
            ptHeight: rendered.height / renderScale,
            renderScale,
            pageCount,
          },
          rendering: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          preview: null,
          rendering: false,
          error: err instanceof Error ? err.message : "Could not render preview.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, renderScale]);

  // Final cleanup on unmount.
  useEffect(() => {
    return () => {
      if (lastUrlRef.current) {
        URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = null;
      }
    };
  }, []);

  return state;
}
