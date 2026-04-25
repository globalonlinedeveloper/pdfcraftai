"use client";

// StripLinksTool — Tier 1 §1.6 P1.
//
// Remove all hyperlinks (URI links AND internal goto-page links) from a
// PDF without touching anything else. Useful before sharing a doc you
// don't want recipients to navigate away from, before printing (where
// blue underlined text just looks like noise), or as a privacy step
// when the linked URLs themselves are sensitive (private GitHub repos,
// internal Confluence URLs, etc.).
//
// Distinct from Flatten PDF: Flatten removes ALL annotations
// (highlights, comments, form widgets, links). Strip Links is the
// surgical version — only /Subtype /Link annotations get removed; every
// other annotation stays put.
//
// Distinct from Remove Metadata: that tool clears /Info + /Metadata
// XMP. URLs embedded as /Link annotations on individual pages are not
// metadata — they're annotation objects.
//
// Implementation: walk each page's /Annots array, filter out anything
// whose /Subtype is /Link, write the filtered array back. pdf-lib
// exposes the page's `node.Annots()` PDFArray directly so we can do
// this without copying every other annotation object.
//
// SEO: "remove hyperlinks from pdf", "strip links pdf", "remove urls
// from pdf online".

import { useState, useCallback } from "react";
import { PDFDocument, PDFArray, PDFDict, PDFName } from "pdf-lib";
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

type Loaded = {
  file: File;
  pageCount: number;
  uriLinkCount: number;     // /Subtype /Link with /A /S /URI
  internalLinkCount: number; // /Subtype /Link with /Dest or /A /S /GoTo
};

export function StripLinksTool() {
  useTrackToolView("strip-links", "Security");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    bytes: Uint8Array;
    name: string;
    size: number;
    removed: number;
  } | null>(null);

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      let uriLinkCount = 0;
      let internalLinkCount = 0;
      for (const page of doc.getPages()) {
        const annots = page.node.Annots();
        if (!annots) continue;
        for (let i = 0; i < annots.size(); i++) {
          const ref = annots.get(i);
          if (!ref) continue;
          const annotObj = doc.context.lookup(ref);
          if (!(annotObj instanceof PDFDict)) continue;
          const subtype = annotObj.get(PDFName.of("Subtype"));
          if (!(subtype instanceof PDFName) || subtype.asString() !== "/Link") continue;
          // Categorize: URI vs internal goto.
          const action = annotObj.get(PDFName.of("A"));
          if (action instanceof PDFDict) {
            const s = action.get(PDFName.of("S"));
            if (s instanceof PDFName && s.asString() === "/URI") {
              uriLinkCount++;
              continue;
            }
          }
          // Anything else with /Link subtype is internal navigation.
          internalLinkCount++;
        }
      }
      setLoaded({
        file: f,
        pageCount: doc.getPageCount(),
        uriLinkCount,
        internalLinkCount,
      });
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
    const totalLinks = loaded.uriLinkCount + loaded.internalLinkCount;
    if (totalLinks === 0) {
      setError("This PDF has no link annotations to remove — nothing would change.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const doc = await PDFDocument.load(await loaded.file.arrayBuffer(), { ignoreEncryption: true });
      let removed = 0;

      for (const page of doc.getPages()) {
        const annots = page.node.Annots();
        if (!annots || annots.size() === 0) continue;

        // Build a new array of refs that are NOT /Link annotations.
        const keep: ReturnType<typeof annots.get>[] = [];
        for (let i = 0; i < annots.size(); i++) {
          const ref = annots.get(i);
          if (!ref) continue;
          const annotObj = doc.context.lookup(ref);
          if (annotObj instanceof PDFDict) {
            const subtype = annotObj.get(PDFName.of("Subtype"));
            if (subtype instanceof PDFName && subtype.asString() === "/Link") {
              removed++;
              continue;
            }
          }
          keep.push(ref);
        }

        // Replace the page's /Annots with the filtered array. If the
        // filtered list is empty, delete the entry entirely (cleaner
        // than an empty array — some viewers warn on zero-length).
        if (keep.length === 0) {
          page.node.delete(PDFName.of("Annots"));
        } else {
          const fresh = doc.context.obj([]) as PDFArray;
          for (const ref of keep) fresh.push(ref);
          page.node.set(PDFName.of("Annots"), fresh);
        }
      }

      const bytes = await doc.save({ useObjectStreams: true });
      const name = deriveOutputName(loaded.file.name, "-no-links");
      setResult({ bytes, name, size: bytes.length, removed });

      try {
        const sha256 = await sha256HexOfBytes(bytes);
        await logToolResultAction({
          toolId: "strip-links",
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
      setError(err instanceof Error ? err.message : "Strip failed.");
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
          prompt="Drop a PDF to strip every hyperlink"
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
                {humanSize(loaded.file.size)} · {loaded.pageCount} page{loaded.pageCount === 1 ? "" : "s"} · {loaded.uriLinkCount} URL link{loaded.uriLinkCount === 1 ? "" : "s"}, {loaded.internalLinkCount} internal nav
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={reset} aria-label="Remove file">
              <I.X size={14} />
            </button>
          </div>

          <div className="card" style={{ padding: 14, fontSize: 13, color: "var(--fg-subtle)", background: "var(--bg-1)" }}>
            <strong style={{ color: "var(--fg)", display: "block", marginBottom: 4 }}>What this does:</strong>
            Removes every <code>/Link</code> annotation from every page — both URL links (clickable
            external URLs) and internal navigation (in-document table-of-contents jumps). Other
            annotations like highlights, comments, and form widgets are preserved. The visible
            text of the link stays — only the click target is removed. To also strip blue/underline
            styling, run Edit PDF afterwards.
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
              <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}>Links stripped</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {result.removed} link{result.removed === 1 ? "" : "s"} removed · {humanSize(result.size)}
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
          {busy ? "Stripping…" : "Strip all links"}
        </button>
      </div>
    </div>
  );
}
