"use client";

import { useEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import {
  downloadBytes,
  humanSize,
  parsePageRanges,
  sha256HexOfBytes,
  deriveOutputName,
} from "@/lib/client/pdf-utils";
import { logToolResultAction } from "@/lib/tool-result-actions";

type Mode = "ranges" | "everyN";

type Piece = {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  rangeLabel: string;
};

export function SplitPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("ranges");
  const [rangeSpec, setRangeSpec] = useState("");
  const [everyN, setEveryN] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pieces, setPieces] = useState<Piece[] | null>(null);

  // Preload the page count when a file is chosen so the UI can validate.
  useEffect(() => {
    let cancelled = false;
    setPageCount(null);
    setPieces(null);
    setError(null);
    setRangeSpec("");
    if (!file) return;
    (async () => {
      try {
        const src = await PDFDocument.load(await file.arrayBuffer(), {
          ignoreEncryption: true,
        });
        if (cancelled) return;
        const n = src.getPageCount();
        setPageCount(n);
        setRangeSpec(`1-${n}`);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not read the PDF.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const reset = () => {
    setFile(null);
    setPageCount(null);
    setMode("ranges");
    setRangeSpec("");
    setEveryN(1);
    setError(null);
    setPieces(null);
  };

  const run = async () => {
    if (!file || !pageCount) return;
    setBusy(true);
    setError(null);
    setPieces(null);
    try {
      // Build the list of 1-based page groups for each output piece.
      let groups: number[][];
      if (mode === "ranges") {
        groups = parsePageRanges(rangeSpec, pageCount);
      } else {
        if (everyN < 1) throw new Error("Split size must be at least 1.");
        groups = [];
        for (let start = 1; start <= pageCount; start += everyN) {
          const end = Math.min(start + everyN - 1, pageCount);
          const arr: number[] = [];
          for (let i = start; i <= end; i++) arr.push(i);
          groups.push(arr);
        }
      }

      const src = await PDFDocument.load(await file.arrayBuffer(), {
        ignoreEncryption: true,
      });

      const outPieces: Piece[] = [];
      for (const group of groups) {
        const dest = await PDFDocument.create();
        const zeroBased = group.map((p) => p - 1);
        const copied = await dest.copyPages(src, zeroBased);
        for (const p of copied) dest.addPage(p);
        const bytes = await dest.save({ useObjectStreams: true });
        const rangeLabel = group.length === 1
          ? `p${group[0]}`
          : `p${group[0]}-${group[group.length - 1]}`;
        outPieces.push({
          name: deriveOutputName(file.name, `-${rangeLabel}`),
          bytes,
          pageCount: group.length,
          rangeLabel,
        });
      }

      setPieces(outPieces);

      // Log metadata for each produced piece, best-effort.
      try {
        await Promise.all(
          outPieces.map(async (piece) => {
            const sha256 = await sha256HexOfBytes(piece.bytes);
            await logToolResultAction({
              toolId: "split",
              name: piece.name,
              mime: "application/pdf",
              sizeBytes: piece.bytes.length,
              sha256,
            });
          })
        );
      } catch (logErr) {
        console.warn("logToolResult failed (non-fatal):", logErr);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Split failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {!file ? (
        <ToolDropzone onFiles={(files) => setFile(files[0] ?? null)} />
      ) : (
        <>
          <div
            className="card"
            style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}
          >
            <span style={{ color: "var(--fg-subtle)" }}>
              <I.File size={16} />
            </span>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div
                title={file.name}
                style={{
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {file.name}
              </div>
              <div className="subtle" style={{ fontSize: 12 }}>
                {humanSize(file.size)}
                {pageCount != null && ` · ${pageCount} pages`}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label="Remove"
              disabled={busy}
              onClick={reset}
              style={{ padding: 6, color: "var(--fg-subtle)" }}
            >
              <I.X size={14} />
            </button>
          </div>

          <div>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <ModeButton
                active={mode === "ranges"}
                onClick={() => setMode("ranges")}
                disabled={busy}
                label="By page ranges"
              />
              <ModeButton
                active={mode === "everyN"}
                onClick={() => setMode("everyN")}
                disabled={busy}
                label="Every N pages"
              />
            </div>

            {mode === "ranges" ? (
              <div>
                <label className="subtle" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
                  Page ranges
                </label>
                <input
                  type="text"
                  value={rangeSpec}
                  onChange={(e) => setRangeSpec(e.target.value)}
                  placeholder="e.g. 1-3, 5, 7-10"
                  disabled={busy || !pageCount}
                  spellCheck={false}
                  className="input"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: 14,
                    background: "var(--bg-1)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--fg)",
                    fontFamily: "var(--font-geist-mono, monospace)",
                  }}
                />
                <p className="subtle" style={{ fontSize: 12, marginTop: 6 }}>
                  Each range becomes its own PDF. Pages are 1-indexed.
                </p>
              </div>
            ) : (
              <div>
                <label className="subtle" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
                  Pages per piece
                </label>
                <input
                  type="number"
                  min={1}
                  max={pageCount ?? 1}
                  value={everyN}
                  onChange={(e) => setEveryN(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  disabled={busy || !pageCount}
                  style={{
                    width: 120,
                    padding: "10px 12px",
                    fontSize: 14,
                    background: "var(--bg-1)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--fg)",
                  }}
                />
                {pageCount != null && (
                  <p className="subtle" style={{ fontSize: 12, marginTop: 6 }}>
                    Will produce {Math.ceil(pageCount / Math.max(everyN, 1))} file
                    {Math.ceil(pageCount / Math.max(everyN, 1)) === 1 ? "" : "s"}.
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}

      {pieces && pieces.length > 0 && (
        <div
          className="card"
          style={{
            padding: 16,
            borderColor: "var(--accent)",
            background: "var(--accent-soft)",
          }}
        >
          <div className="row" style={{ gap: 10, marginBottom: 12 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "var(--accent)",
                color: "var(--bg-1)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <I.Check size={16} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>
                Split into {pieces.length} file{pieces.length === 1 ? "" : "s"}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Click each to download — your browser may ask once to allow multiple downloads.
              </div>
            </div>
            {pieces.length > 1 && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  for (const p of pieces) downloadBytes(p.bytes, p.name);
                }}
              >
                <I.Download size={14} />
                <span>Download all</span>
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pieces.map((p) => (
              <div
                key={p.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  background: "var(--bg-1)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <span style={{ color: "var(--fg-subtle)" }}>
                  <I.File size={14} />
                </span>
                <span style={{ fontSize: 13, flex: 1 }}>{p.name}</span>
                <span className="subtle" style={{ fontSize: 12 }}>
                  {p.pageCount} pg · {humanSize(p.bytes.length)}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => downloadBytes(p.bytes, p.name)}
                  aria-label={`Download ${p.name}`}
                  style={{ padding: "4px 8px" }}
                >
                  <I.Download size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
        {file && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={reset}>
            Reset
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !file || !pageCount}
          onClick={run}
        >
          {busy ? "Splitting…" : "Split PDF"}
        </button>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  label,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 12px",
        fontSize: 13,
        borderRadius: "var(--radius-sm)",
        background: active ? "var(--accent-soft)" : "var(--bg-2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        color: active ? "var(--accent)" : "var(--fg-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  );
}
