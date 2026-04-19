// StudioRunner — Phase 6.2 batch runner client component.
//
// One page. One user-picked tool. Many files. Files are fanned out to the
// existing /api/ai/<tool> endpoint SERIALLY, one at a time. No batch_runs
// table, no new routes, no parallel orchestration — each file is a plain
// POST exactly like the single-file tool would have made, and the client
// owns the queue in component state.
//
// Why this architecture:
//   - Zero new schema. Adding a batch_runs table + a background job
//     runner would be weeks; this is a day and covers 90% of the need.
//   - Phase 5.5 replay-on-dup is inherited for free. Retries of a failed
//     item re-use the same idempotencyKey and hit the output cache
//     instead of double-charging.
//   - The per-file error matrix (401/402/409/413/422/502/207) is already
//     implemented in each tool's route handler — we just surface the
//     response as a row status without re-implementing anything.
//
// Trade-offs:
//   - If the tab closes mid-run, pending items are lost (but completed
//     ones persist — they were already written to /app/files). This is
//     an acceptable MVP limitation; a future Phase would add a
//     batch_runs row so a refresh can resume.
//   - Serial execution means a 25-file OCR batch takes 25× one file.
//     That's the user's deliberate choice ("Serial, 1 at a time"); the
//     concurrency toggle lives at the picker level so a future tweak to
//     `RUN_CONCURRENCY` is a one-line change.
//
// UI flow:
//   1. Tool picker (radio-like) → selects Summarize / Translate / OCR.
//   2. Per-tool params (depth for summarize, targetLang for translate).
//   3. MacroBar for the selected tool (reuses Phase 6.1 presets).
//   4. Multi-file dropzone, capped at 25 files total.
//   5. Pre-flight cost estimate ("≤ N credits").
//   6. Run → iterates the queue serially; each row updates in place.
//   7. Per-row status + retry-failed + cancel-all.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PDFDocument } from "pdf-lib";

import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "@/components/tools/ToolDropzone";
import { MacroBar, type MacroBarItem } from "@/components/tools/MacroBar";
import { humanSize } from "@/lib/client/pdf-utils";
import {
  createMacroAction,
  deleteMacroAction,
  listMacrosForToolAction,
} from "@/lib/macro-actions";
import { COMMON_TARGET_LANGUAGES } from "@/lib/ai/translate-langs";

import type {
  BatchItem,
  BatchItemStatus,
  StudioToolId,
  StudioToolParams,
} from "@/lib/studio/types";
import { estimateCost, sumEstimatedBatchCost } from "@/lib/studio/costs";

// --- Constants --------------------------------------------------------

/** Absolute cap. Enforced both on dropzone intake and on Add-more. */
const MAX_FILES_PER_RUN = 25;

/** Mirrors CLIENT_MAX_OCR_PAGES in OcrPdfTool.tsx and MAX_OCR_PAGES server-side. */
const CLIENT_MAX_OCR_PAGES = 50;

/** Serial by design (one in-flight POST at a time). Kept as a constant so
 *  a future tweak to e.g. 2 is a one-line change in the runner loop. */
const RUN_CONCURRENCY = 1;

type Depth = "tldr" | "standard" | "detailed";

const DEPTH_OPTIONS: ReadonlyArray<{ value: Depth; label: string; hint: string }> = [
  { value: "tldr", label: "TL;DR", hint: "One paragraph, ~3 sentences." },
  { value: "standard", label: "Standard", hint: "TL;DR + key points + sections." },
  { value: "detailed", label: "Detailed", hint: "Adds notable quotes + open questions." },
];

const TOOL_OPTIONS: ReadonlyArray<{
  id: StudioToolId;
  label: string;
  costHint: string;
  description: string;
}> = [
  {
    id: "ai-summarize",
    label: "Summarize",
    costHint: "3 credits / doc",
    description: "Executive summary + key points per file.",
  },
  {
    id: "ai-translate",
    label: "Translate",
    costHint: "5 credits / doc",
    description: "Preserve layout across 20+ languages.",
  },
  {
    id: "ai-ocr",
    label: "OCR",
    costHint: "2 credits / page",
    description: "Transcribe scanned PDFs (capped at 50 pages each).",
  },
];

// --- Types for macro params (narrowed by the discriminated union) -----

type SummarizeMacroParams = { depth: Depth };
type TranslateMacroParams = { targetLang: string };

// --- Helpers ----------------------------------------------------------

/** New client-side UUID; fallback for old browsers. */
function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ik-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Map toolId → route path. Kept exhaustive so adding a StudioToolId
 *  fires a TS error here until the new endpoint is wired. */
function routeForTool(toolId: StudioToolId): string {
  switch (toolId) {
    case "ai-summarize":
      return "/api/ai/summarize";
    case "ai-translate":
      return "/api/ai/translate";
    case "ai-ocr":
      return "/api/ai/ocr";
  }
}

/** Peek a PDF's page count locally for OCR cost estimation. Returns
 *  undefined on any failure — the estimator falls back to the page cap. */
async function peekPageCount(file: File): Promise<number | undefined> {
  try {
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const n = doc.getPageCount();
    return n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** Shared error-body → human string. Differs slightly per tool (OCR has
 *  its own too_many_pages) but 90% of the matrix is common. */
function mapErrorBody(
  toolId: StudioToolId,
  status: number,
  body: Record<string, unknown>
): string {
  const code = typeof body.error === "string" ? body.error : "";
  const detail = typeof body.detail === "string" ? body.detail : "";

  switch (status) {
    case 401:
      return "Session expired — sign in again.";
    case 402: {
      const required = typeof body.required === "number" ? body.required : 0;
      const balance = typeof body.balance === "number" ? body.balance : 0;
      return `Out of credits (needs ${required}, have ${balance}).`;
    }
    case 409:
      return detail || "Already processed — check your Files.";
    case 413:
      return "PDF is too large.";
    case 422:
      if (toolId === "ai-ocr" && code === "too_many_pages") {
        return `Over the ${CLIENT_MAX_OCR_PAGES}-page cap — split it first.`;
      }
      return detail || "Couldn't process this PDF.";
    case 400:
      return detail || "That file doesn't look like a valid PDF.";
    case 502:
      return detail || "AI provider errored (credits refunded).";
    case 503:
      return "No AI provider configured for this tool.";
    default:
      return detail || `Failed (status ${status}).`;
  }
}

/** BCP-47-ish validation. Same regex used by TranslatePdfTool's "Other…"
 *  mode; we re-validate here so nothing unsound reaches the server. */
const BCP47_ISH = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

// ---------------------------------------------------------------------

export function StudioRunner() {
  // --- Tool & params --------------------------------------------------

  const [toolId, setToolId] = useState<StudioToolId>("ai-summarize");
  const [depth, setDepth] = useState<Depth>("standard");
  const [targetLang, setTargetLang] = useState<string>("es");
  // Keeps the translate dropdown UX consistent with TranslatePdfTool:
  // the user either picks from the curated list or types a custom code.
  const [langChoice, setLangChoice] = useState<string>("es"); // "other" sentinel → custom
  const [customLang, setCustomLang] = useState<string>("");

  // --- Queue ---------------------------------------------------------

  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cancel flag is a ref so the in-flight serial loop can observe
  // changes without being captured in a stale closure.
  const cancelRef = useRef(false);

  // --- Macros (per-tool) ---------------------------------------------

  const [macros, setMacros] = useState<MacroBarItem[]>([]);
  const [canSaveMacro, setCanSaveMacro] = useState(false);

  // Reload whenever the picker flips to a different tool. OCR has no
  // persisted params so skip the fetch entirely.
  useEffect(() => {
    let cancelled = false;
    if (toolId === "ai-ocr") {
      setMacros([]);
      setCanSaveMacro(false);
      return;
    }
    (async () => {
      const res = await listMacrosForToolAction({ toolId });
      if (cancelled) return;
      if (res.ok) {
        setMacros(
          res.macros.map((m) => ({ id: m.id, name: m.name, params: m.params }))
        );
        setCanSaveMacro(res.canSave);
      } else {
        setMacros([]);
        setCanSaveMacro(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toolId]);

  // --- Derived: current target-lang for Translate --------------------
  //
  // Mirrors TranslatePdfTool exactly: dropdown pick overrides unless the
  // user selected "other", in which case the free-form input wins.
  const commonLangCodes = useMemo<Set<string>>(
    () => new Set(COMMON_TARGET_LANGUAGES.map((l) => l.code)),
    []
  );
  const currentTargetLang: string | null = (() => {
    if (langChoice !== "other") return langChoice;
    const trimmed = customLang.trim();
    if (trimmed.length === 0) return null;
    if (!BCP47_ISH.test(trimmed)) return null;
    return trimmed;
  })();

  // Sync `targetLang` from (langChoice, customLang) so the runner uses
  // a single source of truth when submitting.
  useEffect(() => {
    if (currentTargetLang) setTargetLang(currentTargetLang);
  }, [currentTargetLang]);

  // --- Derived: active macro id for chip highlighting -----------------

  const activeMacroId: string | null = (() => {
    if (toolId === "ai-summarize") {
      return (
        macros.find((m) => (m.params as SummarizeMacroParams).depth === depth)
          ?.id ?? null
      );
    }
    if (toolId === "ai-translate") {
      return (
        macros.find(
          (m) => (m.params as TranslateMacroParams).targetLang === currentTargetLang
        )?.id ?? null
      );
    }
    return null;
  })();

  // --- Macro callbacks ------------------------------------------------

  const applyMacro = useCallback(
    (m: MacroBarItem) => {
      if (toolId === "ai-summarize") {
        const d = (m.params as SummarizeMacroParams).depth;
        if (d === "tldr" || d === "standard" || d === "detailed") setDepth(d);
      } else if (toolId === "ai-translate") {
        const lang = (m.params as TranslateMacroParams).targetLang;
        if (commonLangCodes.has(lang)) {
          setLangChoice(lang);
          setCustomLang("");
        } else {
          setLangChoice("other");
          setCustomLang(lang);
        }
      }
    },
    [toolId, commonLangCodes]
  );

  const saveMacro = useCallback(
    async (name: string) => {
      if (toolId === "ai-ocr") return;

      const params =
        toolId === "ai-summarize"
          ? { depth }
          : { targetLang: currentTargetLang ?? "" };

      if (toolId === "ai-translate" && !commonLangCodes.has(params.targetLang ?? "")) {
        throw new Error("Only common target languages can be saved as presets.");
      }

      const res = await createMacroAction({ toolId, name, params });
      if (!res.ok) {
        if (res.error === "duplicate_name") {
          throw new Error("A macro with that name already exists.");
        }
        if (res.error === "not_authenticated") {
          throw new Error("Sign in to save macros.");
        }
        if (res.error === "invalid_macro") {
          throw new Error("That macro isn't valid — check the params.");
        }
        throw new Error("Couldn't save macro — try again.");
      }
      setMacros((prev) => [
        { id: res.macro.id, name: res.macro.name, params: res.macro.params },
        ...prev,
      ]);
    },
    [toolId, depth, currentTargetLang, commonLangCodes]
  );

  const deleteMacro = useCallback(async (id: string) => {
    const prevSnapshot = macros;
    setMacros((prev) => prev.filter((m) => m.id !== id));
    const res = await deleteMacroAction({ id });
    if (!res.ok) {
      // Restore only if our optimistic removal is still the visible state.
      setMacros((curr) => {
        if (curr.some((m) => m.id === id)) return curr;
        return prevSnapshot;
      });
      throw new Error("Couldn't delete macro — try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- macros captured by closure intentionally as snapshot for rollback
  }, [macros]);

  // --- File handling --------------------------------------------------

  const addFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      if (items.length + files.length > MAX_FILES_PER_RUN) {
        const remaining = MAX_FILES_PER_RUN - items.length;
        setError(
          `Batch cap is ${MAX_FILES_PER_RUN} files per run (you have ${items.length}, this drop adds ${files.length}). ` +
            (remaining > 0 ? `Add up to ${remaining} more.` : "Remove some first.")
        );
        return;
      }

      // Enqueue as pending immediately so the UI shows progress.
      const stubs: BatchItem[] = files.map((file) => ({
        id: newClientId(),
        file,
        idempotencyKey: newClientId(),
        status: "pending",
      }));
      setItems((prev) => [...prev, ...stubs]);

      // Background: peek page counts for OCR cost estimation. Don't
      // block the enqueue UI — the estimator gracefully handles
      // undefined pageCount by using the worst-case cap.
      if (toolId === "ai-ocr") {
        for (const stub of stubs) {
          const pages = await peekPageCount(stub.file);
          setItems((prev) =>
            prev.map((it) => (it.id === stub.id ? { ...it, pageCount: pages } : it))
          );
        }
      }
    },
    [items.length, toolId]
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    setError(null);
  }, []);

  // --- Runner ---------------------------------------------------------

  // Serial loop: iterate pending items, update status in-place. Uses
  // functional setState so concurrent re-renders don't stomp updates.
  const runSerial = useCallback(
    async (targetIds: Set<string>) => {
      setRunning(true);
      setError(null);
      cancelRef.current = false;

      try {
        // Snapshot the ordered queue once so new adds don't inject
        // themselves into the current run.
        const queue = items.filter((it) => targetIds.has(it.id));

        for (const item of queue) {
          if (cancelRef.current) {
            // Mark remaining targets as cancelled and stop.
            setItems((prev) =>
              prev.map((it) =>
                targetIds.has(it.id) && it.status === "pending"
                  ? { ...it, status: "cancelled" as BatchItemStatus, error: "Cancelled." }
                  : it
              )
            );
            break;
          }

          // Flip to running.
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id ? { ...it, status: "running" as BatchItemStatus, error: undefined } : it
            )
          );

          try {
            const body = await postSingle(toolId, item, { depth, targetLang });
            setItems((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? {
                      ...it,
                      status: "succeeded" as BatchItemStatus,
                      creditsSpent:
                        typeof body.creditCost === "number" ? body.creditCost : undefined,
                      fileId: typeof body.fileId === "string" ? body.fileId : undefined,
                      markdown: typeof body.markdown === "string" ? body.markdown : undefined,
                      error: undefined,
                    }
                  : it
              )
            );
          } catch (err) {
            setItems((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? {
                      ...it,
                      status: "failed" as BatchItemStatus,
                      error:
                        err instanceof Error
                          ? err.message
                          : "Request failed — check your connection.",
                    }
                  : it
              )
            );
          }
        }
      } finally {
        setRunning(false);
      }
    },
    [items, toolId, depth, targetLang]
  );

  const runAll = useCallback(() => {
    const pendingIds = new Set(
      items.filter((it) => it.status === "pending").map((it) => it.id)
    );
    if (pendingIds.size === 0) return;
    void runSerial(pendingIds);
  }, [items, runSerial]);

  const retryFailed = useCallback(() => {
    // Reset failed rows back to pending (keeping the same idempotencyKey
    // so Phase 5.5 replay kicks in for anything that actually made it to
    // the provider before the network blip).
    const failedIds = items
      .filter((it) => it.status === "failed")
      .map((it) => it.id);
    if (failedIds.length === 0) return;

    setItems((prev) =>
      prev.map((it) =>
        failedIds.includes(it.id)
          ? { ...it, status: "pending" as BatchItemStatus, error: undefined }
          : it
      )
    );
    void runSerial(new Set(failedIds));
  }, [items, runSerial]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  // --- Derived summary ------------------------------------------------

  const counts = useMemo(() => {
    const c: Record<BatchItemStatus, number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const it of items) c[it.status] += 1;
    return c;
  }, [items]);

  const estBatchCost = useMemo(
    () => sumEstimatedBatchCost(toolId, items),
    [toolId, items]
  );

  const canRun =
    !running &&
    items.length > 0 &&
    counts.pending > 0 &&
    (toolId !== "ai-translate" || Boolean(currentTargetLang));

  // --- Render ---------------------------------------------------------

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Tool picker */}
      <fieldset
        disabled={running}
        style={{ border: "none", margin: 0, padding: 0 }}
      >
        <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          Tool
        </legend>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }}>
          {TOOL_OPTIONS.map((opt) => {
            const selected = toolId === opt.id;
            return (
              <label
                key={opt.id}
                className="card"
                style={{
                  padding: 14,
                  cursor: running ? "not-allowed" : "pointer",
                  borderColor: selected ? "var(--accent)" : "var(--border)",
                  background: selected ? "var(--accent-soft)" : undefined,
                }}
              >
                <input
                  type="radio"
                  name="studio-tool"
                  value={opt.id}
                  checked={selected}
                  onChange={() => setToolId(opt.id)}
                  style={{ marginRight: 8 }}
                />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{opt.label}</span>
                <span className="subtle" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
                  {opt.description}
                </span>
                <span className="mono subtle" style={{ display: "block", fontSize: 11, marginTop: 4 }}>
                  {opt.costHint}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Macro row (summarize + translate only) */}
      {toolId !== "ai-ocr" && (
        <MacroBar
          macros={macros}
          disabled={running}
          canSave={canSaveMacro}
          activeId={activeMacroId}
          onApply={applyMacro}
          onSave={saveMacro}
          onDelete={deleteMacro}
        />
      )}

      {/* Per-tool params */}
      {toolId === "ai-summarize" && (
        <fieldset
          disabled={running}
          style={{ border: "none", margin: 0, padding: 0 }}
        >
          <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Depth
          </legend>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {DEPTH_OPTIONS.map((opt) => {
              const selected = depth === opt.value;
              return (
                <label
                  key={opt.value}
                  className="card"
                  style={{
                    padding: "10px 14px",
                    cursor: running ? "not-allowed" : "pointer",
                    borderColor: selected ? "var(--accent)" : "var(--border)",
                    background: selected ? "var(--accent-soft)" : undefined,
                    fontSize: 13,
                  }}
                >
                  <input
                    type="radio"
                    name="studio-depth"
                    value={opt.value}
                    checked={selected}
                    onChange={() => setDepth(opt.value)}
                    style={{ marginRight: 8 }}
                  />
                  <span style={{ fontWeight: 600 }}>{opt.label}</span>
                  <span className="subtle" style={{ display: "block", fontSize: 11 }}>
                    {opt.hint}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {toolId === "ai-translate" && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            <span style={{ display: "block", marginBottom: 6 }}>Target language</span>
            <select
              disabled={running}
              value={langChoice}
              onChange={(e) => setLangChoice(e.target.value)}
              className="input"
              style={{ minWidth: 200 }}
            >
              {COMMON_TARGET_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} ({l.code})
                </option>
              ))}
              <option value="other">Other…</option>
            </select>
          </label>
          {langChoice === "other" && (
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              <span style={{ display: "block", marginBottom: 6 }}>Code</span>
              <input
                type="text"
                className="input"
                disabled={running}
                placeholder="e.g. eu, fa-IR"
                value={customLang}
                onChange={(e) => setCustomLang(e.target.value)}
                style={{ minWidth: 140 }}
              />
            </label>
          )}
        </div>
      )}

      {/* Dropzone (only shown if below the cap) */}
      {items.length < MAX_FILES_PER_RUN && (
        <ToolDropzone
          onFiles={addFiles}
          multiple
          disabled={running}
          prompt={`Drop up to ${MAX_FILES_PER_RUN - items.length} PDFs`}
          hint={`Up to ${MAX_FILES_PER_RUN} files per run · processed serially on our servers.`}
        />
      )}

      {error && (
        <div
          role="alert"
          style={{
            color: "var(--danger)",
            fontSize: 13,
            padding: "10px 14px",
            border: "1px solid var(--danger)",
            borderRadius: "var(--radius-sm)",
            background: "rgba(220, 38, 38, 0.06)",
          }}
        >
          {error}
        </div>
      )}

      {/* Queue table */}
      {items.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Queue — {items.length} file{items.length === 1 ? "" : "s"}
            </div>
            <div className="subtle" style={{ fontSize: 12 }}>
              {counts.succeeded} done · {counts.failed} failed · {counts.pending + counts.running} to go
            </div>
            <div style={{ flex: 1 }} />
            <div className="subtle mono" style={{ fontSize: 12 }}>
              {counts.pending + counts.running > 0 && (
                <>
                  est. {toolId === "ai-ocr" ? "≤ " : ""}
                  {estBatchCost} credit{estBatchCost === 1 ? "" : "s"} remaining
                </>
              )}
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={clearAll}
              disabled={running}
            >
              Clear
            </button>
          </div>

          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((it) => (
              <li
                key={it.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 16px",
                  borderTop: "1px solid var(--border)",
                  fontSize: 13,
                }}
              >
                <StatusDot status={it.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    title={it.file.name}
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {it.file.name}
                  </div>
                  <div className="subtle" style={{ fontSize: 11 }}>
                    {humanSize(it.file.size)}
                    {typeof it.pageCount === "number" && <> · {it.pageCount} pages</>}
                    {typeof it.creditsSpent === "number" && (
                      <> · spent {it.creditsSpent}</>
                    )}
                    {it.status === "pending" && (
                      <> · est. {estimateCost(toolId, it.pageCount)} credits</>
                    )}
                    {it.error && (
                      <span style={{ color: "var(--danger)", marginLeft: 6 }}>
                        · {it.error}
                      </span>
                    )}
                  </div>
                </div>
                {it.status === "succeeded" && it.fileId && (
                  <Link
                    href={`/app/files/${it.fileId}/preview`}
                    className="btn btn-sm btn-ghost"
                    style={{ fontSize: 12 }}
                  >
                    View
                  </Link>
                )}
                {!running && it.status === "pending" && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-label="Remove"
                    onClick={() => removeItem(it.id)}
                    style={{ color: "var(--fg-subtle)", padding: 6 }}
                  >
                    <I.X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Run controls */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={runAll}
          disabled={!canRun}
        >
          {running
            ? "Running…"
            : counts.pending > 0
              ? `Run ${counts.pending} file${counts.pending === 1 ? "" : "s"} — ${toolId === "ai-ocr" ? "≤ " : ""}${estBatchCost} credits`
              : items.length === 0
                ? "Add files to run"
                : "Nothing pending"}
        </button>
        {running && (
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            Cancel
          </button>
        )}
        {!running && counts.failed > 0 && (
          <button type="button" className="btn btn-ghost" onClick={retryFailed}>
            Retry {counts.failed} failed
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span className="subtle" style={{ fontSize: 12 }}>
          {RUN_CONCURRENCY === 1
            ? "Serial · 1 file at a time"
            : `${RUN_CONCURRENCY}× parallel`}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Fire a single POST. Throws on non-2xx so runSerial's catch flips the
// row to failed. On 207 (persist partial) we still treat it as success —
// compute and charge succeeded, only the /app/files write failed, which
// is not something the user can act on from Studio's table view.
// ---------------------------------------------------------------------

async function postSingle(
  toolId: StudioToolId,
  item: BatchItem,
  params: { depth: Depth; targetLang: string }
): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append("pdf", item.file);
  form.append("idempotencyKey", item.idempotencyKey);

  if (toolId === "ai-summarize") form.append("depth", params.depth);
  if (toolId === "ai-translate") form.append("targetLang", params.targetLang);

  const res = await fetch(routeForTool(toolId), { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.ok || res.status === 207) return body;
  throw new Error(mapErrorBody(toolId, res.status, body));
}

// ---------------------------------------------------------------------

function StatusDot({ status }: { status: BatchItemStatus }) {
  const map: Record<BatchItemStatus, { color: string; label: string }> = {
    pending: { color: "var(--fg-subtle)", label: "Pending" },
    running: { color: "var(--accent)", label: "Running" },
    succeeded: { color: "var(--success, #16a34a)", label: "Done" },
    failed: { color: "var(--danger)", label: "Failed" },
    cancelled: { color: "var(--fg-subtle)", label: "Cancelled" },
  };
  const m = map[status];
  return (
    <span
      aria-label={m.label}
      title={m.label}
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: m.color,
        flexShrink: 0,
        boxShadow: status === "running" ? "0 0 0 3px var(--accent-soft)" : undefined,
      }}
    />
  );
}

// Fallback if callers pass an unused StudioToolParams (type narrowing —
// referenced only to prevent unused-import errors in some TS configs).
export type { StudioToolParams };
