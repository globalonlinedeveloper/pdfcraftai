"use client";

// PdfToTextTool — Tier 1 §1.4 P1.
//
// Extract the textual content of every page and deliver it as a .txt
// download. Pure client-side: pdfjs-dist's legacy bundle does the
// parsing, and we concatenate `getTextContent()` items with a blank
// line between pages. No server round-trip, no AI — this tool is for
// users who just need the raw text out of a text-based PDF.
//
// Honest limitations surfaced in the UI:
//   - Scanned / image-only PDFs will produce empty output here. Those
//     need OCR (AI · OCR, 2 credits/page). The reassurance copy on the
//     page still says "stays in your browser" because that's true; but
//     the runner shows an "empty extraction" warning when it happens
//     so the user isn't left staring at a 0 B .txt file wondering why.
//   - Layout is NOT preserved. pdfjs returns text items in reading
//     order (roughly) but columns, tables, and decorative positioning
//     will flatten to sequential lines. Users who need layout should
//     pick PDF → Word instead (pdf-to-office).
//
// Reference pattern: mirrors PageCountTool for the pdfjs worker wiring
// (scripts/copy-pdfjs-worker.mjs copies the worker to /public so
// webpack/SWC doesn't choke on its ES exports).

import { useState, useCallback } from "react";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import {
  deriveOutputName,
  downloadBytes,
  humanSize,
  sha256HexOfBytes,
} from "@/lib/client/pdf-utils";
import { logToolResultAction } from "@/lib/tool-result-actions";

type Result = {
  fileName: string;
  sourceSize: number;
  text: string;
  pageCount: number;
  wordCount: number;
  characterCount: number;
};

export function PdfToTextTool() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const buf = await f.arrayBuffer();

      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs-worker.min.mjs";
      }

      // Clone the ArrayBuffer: pdfjs takes ownership of the underlying
      // buffer and zeros it out after parsing. Reusing `buf` twice (once
      // here, once for a later pass) would raise "detached buffer".
      const src = await pdfjs.getDocument({ data: buf.slice(0) }).promise;

      const pageTexts: string[] = [];
      let wordCount = 0;
      let characterCount = 0;

      for (let p = 1; p <= src.numPages; p++) {
        const page = await src.getPage(p);
        const content = await page.getTextContent();
        // `items[].str` is one horizontal text-run as pdfjs parsed it.
        // Runs within the same line are usually separated — we join
        // with a single space and let `\n` on `hasEOL` hints break
        // lines. It's not perfect for columns/tables but matches what
        // iLovePDF, Smallpdf, and Adobe Acrobat's "Save as Text" do.
        let pageText = "";
        let prevHadEol = true;
        for (const item of content.items) {
          if ("str" in item && typeof item.str === "string") {
            const s = item.str;
            if (prevHadEol && pageText.length > 0) {
              pageText += "\n";
            } else if (pageText.length > 0) {
              pageText += " ";
            }
            pageText += s;
            characterCount += s.length;
            if (s.trim()) {
              wordCount += s.trim().split(/\s+/).filter(Boolean).length;
            }
            prevHadEol = "hasEOL" in item && Boolean(item.hasEOL);
          }
        }
        pageTexts.push(pageText.trim());
      }

      // Separate pages with an obvious page break marker — some
      // downstream tools (diff, grep) want to know where page
      // boundaries are. Keep it ASCII so .txt consumers don't get
      // a mojibake U+000C on old Windows editors.
      const text = pageTexts.join("\n\n--- Page Break ---\n\n");

      setResult({
        fileName: f.name,
        sourceSize: f.size,
        text,
        pageCount: src.numPages,
        wordCount,
        characterCount,
      });
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error && /encrypted|password/i.test(err.message)
          ? "This PDF is password-protected. Unlock it with the Protect tool first."
          : "Couldn't read that PDF. It may be corrupt or image-only (try AI · OCR)."
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const download = async () => {
    if (!result) return;
    const bytes = new TextEncoder().encode(result.text);
    const name = deriveOutputName(result.fileName, "").replace(/\.pdf$/i, ".txt");
    downloadBytes(bytes, name, "text/plain;charset=utf-8");
    try {
      const sha256 = await sha256HexOfBytes(bytes);
      await logToolResultAction({
        toolId: "pdf-to-text",
        name,
        mime: "text/plain",
        sizeBytes: bytes.length,
        sha256,
      });
    } catch (logErr) {
      console.warn("logToolResult failed (non-fatal):", logErr);
    }
  };

  const isEmpty = result !== null && result.text.trim().length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!result ? (
        <ToolDropzone
          onFiles={onFiles}
          disabled={busy}
          prompt="Drop a PDF to extract text"
        />
      ) : (
        <div
          className="card"
          style={{
            padding: 20,
            borderColor: isEmpty ? "var(--border)" : "var(--accent)",
            background: isEmpty ? "var(--bg-1)" : "var(--accent-soft)",
          }}
        >
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: isEmpty ? "var(--bg-2)" : "var(--accent)",
                color: isEmpty ? "var(--fg-subtle)" : "var(--bg-1)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              {isEmpty ? <I.Info size={18} /> : <I.Check size={18} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}>
                {isEmpty ? "No text found" : "Text extracted"}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {isEmpty ? (
                  <>
                    The PDF contains no extractable text. It's likely a scan or
                    image-only document — try <strong>AI · OCR</strong> instead.
                  </>
                ) : (
                  <>
                    {result.pageCount} page
                    {result.pageCount === 1 ? "" : "s"} · {result.wordCount.toLocaleString()}{" "}
                    words · {result.characterCount.toLocaleString()} characters
                    {" · source "}
                    {humanSize(result.sourceSize)}
                  </>
                )}
              </div>
            </div>
            {!isEmpty && (
              <button type="button" className="btn btn-primary" onClick={download}>
                <I.Download size={14} />
                <span>Download .txt</span>
              </button>
            )}
          </div>
          {!isEmpty && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: "var(--radius)",
                background: "var(--bg-1)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-mono), ui-monospace, monospace",
                fontSize: 12,
                lineHeight: 1.5,
                maxHeight: 240,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {result.text.length > 4000
                ? result.text.slice(0, 4000) + "\n\n… (preview truncated — download for full text)"
                : result.text}
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}

      <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
        {result && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={reset}
          >
            Start over
          </button>
        )}
      </div>
    </div>
  );
}
