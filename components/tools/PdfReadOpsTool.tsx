"use client";

// components/tools/PdfReadOpsTool.tsx
//
// M21 (#193, 2026-04-29): shared base for read-only inspector tools
// (PdfLinks, PdfFonts, PdfForms, PdfAnnotations, PdfAttachments,
// PdfChecklist, PdfOutline, PdfFontInspector, the 6 Wave 8 byte-
// parsers, etc.). These all follow the same upload → parse →
// render-result-card → copy/CSV/JSON-export shape, with ~150 LOC
// of identical boilerplate per tool.
//
// What this base owns:
//   • File drop + validation (PDF MIME, ≤ 100 MB)
//   • Stage state machine (idle / extracting / done)
//   • busy card with parse-time spinner
//   • error card with role="alert"
//   • result card shell (header + action buttons + custom body)
//   • Copy-JSON button (with "Copied" feedback)
//   • CSV download button (via lib/client/csv.ts)
//   • Reset button
//   • GA4 funnel via useTrackToolView
//   • M9/M10 handoff + file-URL consumption
//   • M16 scroll-error-into-view
//   • M18 page-1 preview thumbnail on the file card
//
// What consumers plug in via slots:
//   • toolId / toolGroup
//   • parser — async op fn that turns bytes into a typed result
//   • headline — turns result into { primary, detail }
//   • renderBody — the unique result UI (table, list, whatever)
//   • csvExport — optional { filename, header, rows } builder
//   • jsonExport — optional shape; defaults to the whole result
//   • prompt / hint — dropzone copy
//   • busyLabel — "Extracting links…" etc.
//
// Pattern matches PageEditorTool / PageGridTool / PdfSimpleOpsTool —
// slot-based, generic over the consumer's parse-result type.

import { copyText } from "@/lib/client/copy-text";
import {
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { I } from "@/components/icons/Icons";
import { ToolDropzone } from "./ToolDropzone";
import { humanSize } from "@/lib/client/pdf-utils";
import { useTrackToolView } from "./useToolTracking";
import { mapPdfOpError } from "@/lib/pdf/error-messages";
import { downloadCsv as downloadCsvFile } from "@/lib/client/csv";
import { useHandoffConsumer } from "./useHandoffConsumer";
import { useFileUrlConsumer } from "./useFileUrlConsumer";
import { useScrollErrorIntoView } from "./useScrollErrorIntoView";
import { UploadedFilePreview } from "./UploadedFilePreview";
import type { ToolGroup } from "@/lib/tools";

type Stage = "idle" | "extracting" | "done";

export interface PdfReadOpsResult<TParsed> {
  /** Source filename (used by CSV filename + JSON-clipboard). */
  fileName: string;
  /** Source size in bytes. */
  fileSize: number;
  /** Whatever the parser returned. */
  parsed: TParsed;
}

export interface PdfReadOpsCsvExport {
  /** e.g. "document.links.csv" — downloaded filename. */
  filename: string;
  /** CSV header row. */
  header: readonly string[];
  /** Body rows; each cell can be string/number/null (CSV writer escapes). */
  rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

export interface PdfReadOpsToolProps<TParsed> {
  /** Tool ID for GA4 + handoff suggestions. Must match `lib/tools.ts`. */
  toolId: string;
  /** Tool group for GA4 (Organize / Edit / Security / etc.). */
  toolGroup: ToolGroup;
  /** Drop-zone prompt: "Drop a PDF to extract its links". */
  prompt: string;
  /** Drop-zone hint line (size + privacy note). */
  hint?: ReactNode;
  /** Spinner label during parse: "Extracting links…". */
  busyLabel: string;
  /** Async parser. Receives raw bytes; returns the typed parse result.
   *  The base wraps parse errors with mapPdfOpError. */
  parser: (bytes: Uint8Array) => Promise<TParsed> | TParsed;
  /** Builds the result-card header text. `detail` is the secondary
   *  line; both are optional in case the result is a 0-item case. */
  headline: (parsed: TParsed) => { primary: string; detail?: ReactNode };
  /** Renders the unique result body (a table, a list, etc). */
  renderBody: (parsed: TParsed) => ReactNode;
  /** When provided, surfaces a "CSV" download button on the result
   *  card. Returning null disables CSV for that particular result
   *  (e.g. zero rows — nothing to export). */
  csvExport?: (parsed: TParsed, fileName: string) => PdfReadOpsCsvExport | null;
  /** When provided, the "JSON" copy button serializes this value
   *  instead of the entire `parsed` shape. Useful for stripping
   *  computed fields from the clipboard payload. Defaults to
   *  `parsed`. */
  jsonExport?: (parsed: TParsed) => unknown;
  /** GA4 success metric. Default: 0. */
  pageCountForTracker?: (parsed: TParsed) => number;
  /** Error code label for tracker.error. Default: `${toolId}_failed`. */
  errorCode?: string;
  /** 2026-05-11 (item #8 batch 9): optional "How it works" explainer
   *  rendered above the dropzone. Same slot pattern that batches
   *  5-8 used to wire PdfSimpleOpsTool / PageEditorTool /
   *  PdfChecklistTool consumers — each PdfReadOpsTool consumer
   *  threads its own ToolHowItWorks block via this prop. */
  howItWorks?: ReactNode;
}

const MAX_FILE_BYTES = 100 * 1024 * 1024;

export function PdfReadOpsTool<TParsed>(
  props: PdfReadOpsToolProps<TParsed>,
): ReactNode {
  const tracker = useTrackToolView(props.toolId, props.toolGroup);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PdfReadOpsResult<TParsed> | null>(null);
  const [copied, setCopied] = useState(false);

  const onFiles = useCallback(
    (files: File[]) => {
      setError(null);
      setResult(null);
      const f = files[0];
      if (!f) return;
      if (!f.type.includes("pdf") && !f.name.toLowerCase().endsWith(".pdf")) {
        setError("That's not a PDF. Drop a .pdf file to continue.");
        return;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError("File over 100 MB — try a smaller one.");
        return;
      }
      setFile(f);
      tracker.upload(f);
    },
    [tracker],
  );

  // Shared infrastructure: handoff, file-URL, scroll-error.
  useHandoffConsumer(onFiles);
  useFileUrlConsumer(onFiles);
  const errorRef = useScrollErrorIntoView(error);

  const reset = () => {
    setFile(null);
    setError(null);
    setResult(null);
    setStage("idle");
    setCopied(false);
  };

  const run = async () => {
    if (!file) return;
    setError(null);
    setStage("extracting");
    const t0 = performance.now();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await props.parser(bytes);
      setResult({
        fileName: file.name,
        fileSize: file.size,
        parsed,
      });
      setStage("done");
      tracker.success({
        creditCost: 0,
        pageCount: props.pageCountForTracker?.(parsed) ?? 0,
        processingMs: Math.round(performance.now() - t0),
      });
    } catch (err) {
      console.error(`${props.toolId} failed`, err);
      const msg = err instanceof Error ? err.message : "Could not parse the PDF.";
      setError(mapPdfOpError(msg));
      setStage("idle");
      tracker.error({ errorCode: props.errorCode ?? `${props.toolId}_failed` });
    }
  };

  const copyJson = async () => {
    if (!result) return;
    try {
      const payload = props.jsonExport
        ? props.jsonExport(result.parsed)
        : result.parsed;
      await copyText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // silent — clipboard permission denied or browser quirk
    }
  };

  const downloadCsv = () => {
    if (!result || !props.csvExport) return;
    const exp = props.csvExport(result.parsed, result.fileName);
    if (!exp) return;
    downloadCsvFile(exp.filename, exp.header, exp.rows);
  };

  const busy = stage === "extracting";
  const head = result ? props.headline(result.parsed) : null;
  const csvAvailable = result && props.csvExport && props.csvExport(result.parsed, result.fileName) !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {props.howItWorks}
      {!file ? (
        <ToolDropzone onFiles={onFiles} prompt={props.prompt} hint={props.hint} />
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            <UploadedFilePreview file={file} maxHeight={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={file.name}
              >
                {file.name}
              </div>
              <div className="subtle" style={{ fontSize: 12 }}>
                {humanSize(file.size)}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={reset}
              disabled={busy}
              aria-label="Remove file"
            >
              <I.X size={14} />
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          ref={errorRef as React.RefObject<HTMLParagraphElement>}
          role="alert"
          style={{ color: "var(--red)", fontSize: 13, margin: 0 }}
        >
          {error}
        </p>
      )}

      {busy && (
        <div
          className="card"
          style={{ padding: 16, background: "var(--bg-1)", display: "flex", gap: 12 }}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="pulse-soft" style={{ color: "var(--accent)" }}>
            <I.Sparkle size={16} />
          </span>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
            {props.busyLabel}
          </div>
        </div>
      )}

      {result && head && (
        <div
          className="card"
          style={{ padding: 0, overflow: "hidden" }}
          role="status"
          aria-live="polite"
          aria-label={head.primary}
        >
          <div
            style={{
              padding: "16px 24px",
              borderBottom: "1px solid var(--border)",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 16,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{head.primary}</div>
              {head.detail && (
                <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                  {head.detail}
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={copyJson}
                style={{ minWidth: 90 }}
              >
                {copied ? (
                  <>
                    <I.Check size={12} /> Copied
                  </>
                ) : (
                  <>
                    <I.Copy size={12} /> JSON
                  </>
                )}
              </button>
              {csvAvailable && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={downloadCsv}
                >
                  <I.Download size={12} /> CSV
                </button>
              )}
            </div>
          </div>

          {props.renderBody(result.parsed)}
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
        {result ? (
          <button type="button" className="btn btn-primary" onClick={reset}>
            Inspect another PDF
          </button>
        ) : (
          <>
            {file && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={reset}
                disabled={busy}
              >
                Reset
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={!file || busy}
              onClick={run}
            >
              {busy ? props.busyLabel : "Inspect"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
