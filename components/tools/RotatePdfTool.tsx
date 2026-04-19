"use client";

import { useEffect, useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
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

type Angle = 90 | 180 | 270;
type Scope = "all" | "ranges";

export function RotatePdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [angle, setAngle] = useState<Angle>(90);
  const [scope, setScope] = useState<Scope>("all");
  const [rangeSpec, setRangeSpec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    bytes: Uint8Array;
    name: string;
    size: number;
    rotatedPages: number;
  } | null>(null);

  // Preload page count once a file is chosen.
  useEffect(() => {
    let cancelled = false;
    setPageCount(null);
    setResult(null);
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
    setAngle(90);
    setScope("all");
    setRangeSpec("");
    setError(null);
    setResult(null);
  };

  const run = async () => {
    if (!file || !pageCount) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Decide which 1-based page numbers to rotate.
      const targets = new Set<number>();
      if (scope === "all") {
        for (let i = 1; i <= pageCount; i++) targets.add(i);
      } else {
        const groups = parsePageRanges(rangeSpec, pageCount);
        for (const g of groups) for (const p of g) targets.add(p);
      }
      if (targets.size === 0) throw new Error("No pages selected to rotate.");

      const doc = await PDFDocument.load(await file.arrayBuffer(), {
        ignoreEncryption: true,
      });
      const pages = doc.getPages();
      for (let i = 0; i < pages.length; i++) {
        if (!targets.has(i + 1)) continue;
        const page = pages[i]!;
        // Preserve any existing rotation — add to it, mod 360.
        const current = page.getRotation().angle || 0;
        const next = ((current + angle) % 360 + 360) % 360;
        page.setRotation(degrees(next));
      }

      const bytes = await doc.save({ useObjectStreams: true });
      const name = deriveOutputName(file.name, `-rotated-${angle}`);
      setResult({ bytes, name, size: bytes.length, rotatedPages: targets.size });

      // Log metadata (best-effort; no-op for anonymous users).
      try {
        const sha256 = await sha256HexOfBytes(bytes);
        await logToolResultAction({
          toolId: "rotate",
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
      setError(err instanceof Error ? err.message : "Rotate failed.");
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
            <label
              className="subtle"
              style={{ fontSize: 12, display: "block", marginBottom: 6 }}
            >
              Rotation
            </label>
            <div className="row" style={{ gap: 8 }}>
              <AngleButton
                active={angle === 90}
                disabled={busy}
                onClick={() => setAngle(90)}
                label="90° CW"
              />
              <AngleButton
                active={angle === 180}
                disabled={busy}
                onClick={() => setAngle(180)}
                label="180°"
              />
              <AngleButton
                active={angle === 270}
                disabled={busy}
                onClick={() => setAngle(270)}
                label="90° CCW"
              />
            </div>
          </div>

          <div>
            <label
              className="subtle"
              style={{ fontSize: 12, display: "block", marginBottom: 6 }}
            >
              Apply to
            </label>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <ScopeButton
                active={scope === "all"}
                disabled={busy}
                onClick={() => setScope("all")}
                label="All pages"
              />
              <ScopeButton
                active={scope === "ranges"}
                disabled={busy}
                onClick={() => setScope("ranges")}
                label="Specific pages"
              />
            </div>
            {scope === "ranges" && (
              <>
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
                  Pages are 1-indexed. Untouched pages keep their current orientation.
                </p>
              </>
            )}
          </div>
        </>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}

      {result && (
        <div
          className="card"
          style={{
            padding: 20,
            borderColor: "var(--accent)",
            background: "var(--accent-soft)",
          }}
        >
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "var(--accent)",
                color: "var(--bg-1)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <I.Check size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}>
                Rotation complete
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Rotated {result.rotatedPages} page
                {result.rotatedPages === 1 ? "" : "s"} by {angle}° · {humanSize(result.size)}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => downloadBytes(result.bytes, result.name)}
            >
              <I.Download size={14} />
              <span>Download</span>
            </button>
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
          {busy ? "Rotating…" : "Rotate PDF"}
        </button>
      </div>
    </div>
  );
}

function AngleButton({
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
        padding: "8px 14px",
        fontSize: 13,
        borderRadius: "var(--radius-sm)",
        background: active ? "var(--accent-soft)" : "var(--bg-2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        color: active ? "var(--accent)" : "var(--fg-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontFamily: "var(--font-geist-mono, monospace)",
      }}
    >
      {label}
    </button>
  );
}

function ScopeButton({
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
