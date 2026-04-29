"use client";

// components/tools/useHandoffConsumer.ts
//
// M9 part 2 (#193, 2026-04-29): shared "consume ?handoff=<key> on
// mount" hook. Extracted from PageEditorTool's inline useEffect so
// PageGridTool / PdfSplitTool / PdfMergeTool / PdfSortPagesTool /
// PdfSimpleOpsTool can all opt into incoming handoffs with one line.
//
// On mount:
//  1. Read ?handoff=<key> from window.location.search
//  2. consumeHandoff(key) → returns {blob, filename, sourceToolId} or null
//  3. Strip the handoff param from the URL via history.replaceState
//     (so a refresh doesn't try to consume an already-empty key)
//  4. If a payload was found, build a File and push it through onFiles
//
// Caller is responsible for:
//  - Providing onFiles with the same validation/loading semantics it
//    has for drag-drop. The hook does NOT validate again.
//  - Calling this hook unconditionally (it's a one-shot effect).
//
// Why a hook, not a render-prop or HOC: each consumer tool already
// has its own onFiles closure with its own state setters. A hook
// closes over that closure, runs once on mount, and never returns
// any state — minimal API surface, easiest to wire.

import { useEffect } from "react";
import { consumeHandoff } from "@/lib/client/handoff";

/**
 * Consume an incoming handoff (if any) and feed it to onFiles on mount.
 *
 * `onFiles` should be the same handler the tool uses for drag-drop.
 * The handoff Blob is wrapped in a File and passed as `[file]`.
 *
 * @param onFiles file-load handler; called once on mount IF a valid
 *   handoff key is present in the URL.
 */
export function useHandoffConsumer(onFiles: (files: File[]) => void): void {
  // Effect must depend on a stable reference for onFiles to avoid
  // re-running across re-renders. Most consumers wrap their onFiles
  // in useCallback already; this hook just trusts them. Empty dep
  // array is intentional — the effect is a one-shot mount handler
  // and we capture whatever onFiles was at mount time. If the user
  // somehow remounts (rare; would lose the handoff anyway since
  // consumeHandoff already removed the entry), the effect runs again
  // but consumes nothing.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const key = params.get("handoff");
    if (!key) return;
    const payload = consumeHandoff(key);
    // Strip the param either way — if consume returned null (page
    // refreshed past the handoff), we don't want to keep it in the URL
    // pretending it's still actionable.
    params.delete("handoff");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : "");
    window.history.replaceState(null, "", newUrl);
    if (!payload) return;
    const incoming = new File([payload.blob], payload.filename, {
      type: "application/pdf",
      lastModified: Date.now(),
    });
    onFiles([incoming]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount
  }, []);
}
