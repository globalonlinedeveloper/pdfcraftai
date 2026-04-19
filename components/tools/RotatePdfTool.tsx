"use client";

// RotatePdfTool — Phase 3 free tool, full "Rotate & Reorder" experience.
//
// The tool's registry name is "Rotate & Reorder" and description is
// "Fix orientation and rearrange pages." The previous implementation
// only rotated — this one lives up to the name with three operations
// in one client-side flow:
//
//   1. Rotate pages — per-page or bulk, 90° steps, accumulates correctly.
//   2. Reorder pages — up/down arrows move a page within the list.
//   3. Delete pages — per-page × dismisses a page from the output.
//
// Everything runs in the browser via pdf-lib. `copyPages` from the
// source doc produces independent page copies, so deletes + reorders
// can't corrupt the original file. We always preserve existing page
// rotation and only ADD the user-requested rotation before saving,
// which means re-running the tool on its own output behaves sanely.

import { useEffect, useMemo, useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import {
  downloadBytes,
  humanSize,
  sha256HexOfBytes,
  deriveOutputName,
} from "@/lib/client/pdf-utils";
import { logToolResultAction } from "@/lib/tool-result-actions";

type Angle = 0 | 90 | 180 | 270;

type PageEntry = {
  /** 0-based index in the ORIGINAL source doc. Stable. */
  originalIndex: number;
  /** The page's starting rotation (from the source doc). Stable. */
  baseRotation: Angle;
  /** User-applied additional rotation, in 90° steps. Resets on Reset. */
  addedRotation: Angle;
};

function normalizeAngle(deg: number): Angle {
  const n = ((deg % 360) + 360) % 360;
  // pdf-lib stores rotations in 90° increments; if the source does
  // something weird (e.g. 45°), snap to nearest valid quarter.
  if (n >= 315 || n < 45) return 0;
  if (n < 135) return 90;
  if (n < 225) return 180;
  return 270;
}

export function RotatePdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    bytes: Uint8Array;
    name: string;
    size: number;
    originalCount: number;
    outputCount: number;
    deletedCount: number;
    rotatedCount: number;
    reordered: boolean;
  } | null>(null);

  // Load the source doc when a file is chosen. We capture the original
  // rotations upfront so per-page rotation math is clean.
  useEffect(() => {
    let cancelled = false;
    setPages([]);
    setResult(null);
    setError(null);
    if (!file) return;
    (async () => {
      try {
        const src = await PDFDocument.load(await file.arrayBuffer(), {
          ignoreEncryption: true,
        });
        if (cancelled) return;
        const entries: PageEntry[] = src.getPages().map((p, i) => ({
          originalIndex: i,
          baseRotation: normalizeAngle(p.getRotation().angle || 0),
          addedRotation: 0,
        }));
        setPages(entries);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Could not read the PDF."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const summary = useMemo(() => {
    if (!pages.length) {
      return { total: 0, rotated: 0, reordered: false };
    }
    const rotated = pages.filter((p) => p.addedRotation !== 0).length;
    const reordered = pages.some(
      (p, i) => p.originalIndex !== i
    );
    return { total: pages.length, rotated, reordered };
  }, [pages]);

  const originalCount = useMemo(() => {
    if (!pages.length && !result) return 0;
    if (result) return result.originalCount;
    // Worst case: largest originalIndex seen + 1.
    let max = -1;
    for (const p of pages) if (p.originalIndex > max) max = p.originalIndex;
    return max + 1;
  }, [pages, result]);

  const reset = () => {
    setFile(null);
    setPages([]);
    setError(null);
    setResult(null);
  };

  const resetEdits = () => {
    if (!file) return;
    // Re-load the file to rebuild the page list in original order.
    setResult(null);
    setError(null);
    setPages([]);
    // Trigger the effect by toggling the file reference.
    const f = file;
    setFile(null);
    // Use queueMicrotask so state batches properly.
    queueMicrotask(() => setFile(f));
  };

  const movePage = (currentIdx: number, dir: -1 | 1) => {
    setPages((prev) => {
      const target = currentIdx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[currentIdx], next[target]] = [next[target]!, next[currentIdx]!];
      return next;
    });
  };

  const rotatePage = (currentIdx: number, delta: 90 | -90) => {
    setPages((prev) =>
      prev.map((p, i) => {
        if (i !== currentIdx) return p;
        const n = normalizeAngle(p.addedRotation + delta);
        return { ...p, addedRotation: n };
      })
    );
  };

  const deletePage = (currentIdx: number) => {
    setPages((prev) => prev.filter((_, i) => i !== currentIdx));
  };

  const applyBulkRotation = (delta: 90 | 180 | -90) => {
    setPages((prev) =>
      prev.map((p) => ({
        ...p,
        addedRotation: normalizeAngle(p.addedRotation + delta),
      }))
    );
  };

  const reverseOrder = () => {
    setPages((prev) => prev.slice().reverse());
  };

  const run = async () => {
    if (!file) return;
    if (!pages.length) {
      setError("Can't save a PDF with zero pages.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const srcBytes = await file.arrayBuffer();
      const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
      const srcTotal = src.getPageCount();
      const out = await PDFDocument.create();

      // copyPages expects the original indices. We pass them in the
      // edited order, so `out` ends up with pages in the right sequence.
      const indices = pages.map((p) => p.originalIndex);
      const copied = await out.copyPages(src, indices);

      for (let i = 0; i < pages.length; i++) {
        const entry = pages[i]!;
        const page = copied[i]!;
        const finalAngle = normalizeAngle(
          entry.baseRotation + entry.addedRotation
        );
        if (finalAngle !== entry.baseRotation) {
          page.setRotation(degrees(finalAngle));
        }
        out.addPage(page);
      }

      const bytes = await out.save({ useObjectStreams: true });
      const suffix =
        pages.length !== srcTotal
          ? "-reordered"
          : summary.reordered
            ? "-reordered"
            : summary.rotated > 0
              ? "-rotated"
              : "-edited";
      const name = deriveOutputName(file.name, suffix);

      setResult({
        bytes,
        name,
        size: bytes.length,
        originalCount: srcTotal,
        outputCount: pages.length,
        deletedCount: srcTotal - pages.length,
        rotatedCount: summary.rotated,
        reordered: summary.reordered,
      });

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
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const hasEdits =
    summary.rotated > 0 ||
    summary.reordered ||
    pages.length !== originalCount;

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
                {originalCount > 0 &&
                  ` · ${originalCount} page${originalCount === 1 ? "" : "s"} loaded`}
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

          {/* Bulk actions — quick wins that apply to every page. */}
          {pages.length > 0 && (
            <div>
              <label
                className="subtle"
                style={{ fontSize: 12, display: "block", marginBottom: 6 }}
              >
                Apply to all pages
              </label>
              <div
                className="row"
                style={{ gap: 8, flexWrap: "wrap" }}
              >
                <BulkButton
                  disabled={busy}
                  onClick={() => applyBulkRotation(90)}
                  label="Rotate all 90° CW"
                />
                <BulkButton
                  disabled={busy}
                  onClick={() => applyBulkRotation(180)}
                  label="Rotate all 180°"
                />
                <BulkButton
                  disabled={busy}
                  onClick={() => applyBulkRotation(-90)}
                  label="Rotate all 90° CCW"
                />
                <BulkButton
                  disabled={busy || pages.length < 2}
                  onClick={reverseOrder}
                  label="Reverse order"
                />
                <BulkButton
                  disabled={busy || !hasEdits}
                  onClick={resetEdits}
                  label="Undo all edits"
                />
              </div>
            </div>
          )}

          {/* Summary + per-page list */}
          {pages.length > 0 && (
            <div>
              <label
                className="subtle"
                style={{
                  fontSize: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 6,
                }}
              >
                <span>
                  Pages ({pages.length} of {originalCount})
                </span>
                <span>
                  {summary.rotated > 0 &&
                    `${summary.rotated} rotated`}
                  {summary.rotated > 0 && summary.reordered ? " · " : ""}
                  {summary.reordered && "reordered"}
                  {pages.length !== originalCount &&
                    (summary.rotated > 0 || summary.reordered ? " · " : "") +
                      `${originalCount - pages.length} deleted`}
                </span>
              </label>

              <div
                className="card"
                style={{
                  padding: 8,
                  maxHeight: 420,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {pages.map((entry, idx) => (
                  <PageRow
                    key={`${entry.originalIndex}-${idx}`}
                    displayIdx={idx}
                    entry={entry}
                    isFirst={idx === 0}
                    isLast={idx === pages.length - 1}
                    disabled={busy}
                    onMoveUp={() => movePage(idx, -1)}
                    onMoveDown={() => movePage(idx, 1)}
                    onRotateCw={() => rotatePage(idx, 90)}
                    onRotateCcw={() => rotatePage(idx, -90)}
                    onDelete={() => deletePage(idx)}
                  />
                ))}
              </div>
            </div>
          )}
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
                PDF saved
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {result.outputCount} of {result.originalCount} pages
                {result.deletedCount > 0 &&
                  ` · ${result.deletedCount} deleted`}
                {result.rotatedCount > 0 &&
                  ` · ${result.rotatedCount} rotated`}
                {result.reordered && ` · reordered`} · {humanSize(result.size)}
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

      {file && (
        <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={reset}>
            Start over
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || pages.length === 0}
            onClick={run}
          >
            {busy ? "Saving…" : hasEdits ? "Apply & download" : "Save PDF"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Sub-components ----------

function BulkButton({
  onClick,
  disabled,
  label,
}: {
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
        background: "var(--bg-2)",
        border: `1px solid var(--border)`,
        color: "var(--fg-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        fontFamily: "var(--font-geist-mono, monospace)",
      }}
    >
      {label}
    </button>
  );
}

function PageRow({
  displayIdx,
  entry,
  isFirst,
  isLast,
  disabled,
  onMoveUp,
  onMoveDown,
  onRotateCw,
  onRotateCcw,
  onDelete,
}: {
  displayIdx: number;
  entry: PageEntry;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRotateCw: () => void;
  onRotateCcw: () => void;
  onDelete: () => void;
}) {
  const finalAngle = normalizeAngle(entry.baseRotation + entry.addedRotation);
  const moved = entry.originalIndex !== displayIdx;
  return (
    <div
      className="row"
      style={{
        padding: "8px 10px",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-1)",
        border: "1px solid var(--border)",
        alignItems: "center",
        gap: 10,
      }}
    >
      {/* Order column: show current + original index when they differ */}
      <div
        style={{
          width: 44,
          textAlign: "center",
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: 13,
          color: "var(--fg-muted)",
          flexShrink: 0,
        }}
      >
        {displayIdx + 1}
      </div>
      {moved && (
        <div
          className="subtle"
          style={{
            fontSize: 11,
            fontFamily: "var(--font-geist-mono, monospace)",
          }}
          title={`Originally page ${entry.originalIndex + 1}`}
        >
          was #{entry.originalIndex + 1}
        </div>
      )}

      {/* Rotation chip */}
      <div
        style={{
          padding: "3px 8px",
          fontSize: 12,
          fontFamily: "var(--font-geist-mono, monospace)",
          borderRadius: 999,
          background:
            entry.addedRotation === 0 ? "var(--bg-2)" : "var(--accent-soft)",
          color:
            entry.addedRotation === 0 ? "var(--fg-muted)" : "var(--accent)",
          flexShrink: 0,
        }}
        title={
          entry.addedRotation === 0
            ? `Page orientation: ${finalAngle}°`
            : `Base ${entry.baseRotation}° + added ${entry.addedRotation}° = ${finalAngle}°`
        }
      >
        {finalAngle}°
      </div>

      <div style={{ flex: 1 }} />

      {/* Action buttons */}
      <RowIconButton
        label="Move up"
        disabled={disabled || isFirst}
        onClick={onMoveUp}
        icon="up"
      />
      <RowIconButton
        label="Move down"
        disabled={disabled || isLast}
        onClick={onMoveDown}
        icon="down"
      />
      <RowIconButton
        label="Rotate 90° clockwise"
        disabled={disabled}
        onClick={onRotateCw}
        icon="rotate"
      />
      <RowIconButton
        label="Rotate 90° counter-clockwise"
        disabled={disabled}
        onClick={onRotateCcw}
        icon="rotate-ccw"
      />
      <RowIconButton
        label="Delete page"
        disabled={disabled}
        onClick={onDelete}
        icon="delete"
        danger
      />
    </div>
  );
}

function RowIconButton({
  icon,
  onClick,
  disabled,
  label,
  danger,
}: {
  icon: "up" | "down" | "rotate" | "rotate-ccw" | "delete";
  onClick: () => void;
  disabled: boolean;
  label: string;
  danger?: boolean;
}) {
  const node = (() => {
    switch (icon) {
      case "up":
        return (
          <span style={{ display: "inline-block", transform: "rotate(180deg)" }}>
            <I.ChevronDown size={14} />
          </span>
        );
      case "down":
        return <I.ChevronDown size={14} />;
      case "rotate":
        return <I.Rotate size={14} />;
      case "rotate-ccw":
        return (
          <span style={{ display: "inline-block", transform: "scaleX(-1)" }}>
            <I.Rotate size={14} />
          </span>
        );
      case "delete":
        return <I.Trash size={14} />;
    }
  })();

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        width: 30,
        height: 30,
        padding: 0,
        display: "grid",
        placeItems: "center",
        borderRadius: 6,
        background: "transparent",
        border: "1px solid var(--border)",
        color: danger ? "var(--red, #e5484d)" : "var(--fg-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        flexShrink: 0,
      }}
    >
      {node}
    </button>
  );
}
