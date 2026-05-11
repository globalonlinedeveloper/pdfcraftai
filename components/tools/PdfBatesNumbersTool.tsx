"use client";

// components/tools/PdfBatesNumbersTool.tsx
//
// 2026-05-01 Tier 2: Bates numbering for legal discovery / litigation.
// Built on PdfSimpleOpsTool — auto-wires all 7 standardized hooks.

import { useState, useEffect } from "react";
import type { BatesPosition } from "@/lib/pdf/ops/bates-numbers";
import { PdfSimpleOpsTool } from "./PdfSimpleOpsTool";
import { ToolHowItWorks } from "./ToolHowItWorks";

const POSITIONS: Array<{ v: BatesPosition; label: string }> = [
  { v: "bottom-right", label: "Bottom right" },
  { v: "bottom-center", label: "Bottom center" },
  { v: "bottom-left", label: "Bottom left" },
  { v: "top-right", label: "Top right" },
  { v: "top-center", label: "Top center" },
  { v: "top-left", label: "Top left" },
];

export function PdfBatesNumbersTool() {
  const [prefix, setPrefix] = useState("LAW");
  const [digits, setDigits] = useState(6);
  const [startNumber, setStartNumber] = useState(1);
  const [position, setPosition] = useState<BatesPosition>("bottom-right");
  const [fontSize, setFontSize] = useState(9);

  // 2026-05-11 (item #17 sweep batch 12) — URL permalink state sync.
  // Most-complex shape yet: 5 params. prefix (string, alphanumeric
  // only) + digits (number 4..10) + startNumber (number 1..999999)
  // + position (6 literals) + fontSize (number 6..20). Single
  // useEffect with 5-tuple dep per the replaceState non-batching
  // invariant. Defaults (LAW / 6 / 1 / bottom-right / 9) all
  // omitted from URL.
  //
  // The `prefix` field is the FIRST string-typed-user-input synced
  // in the sweep. We validate it as alphanumeric + 1..10 chars to
  // reject URL-injected garbage like `?prefix=<script>` or oversized
  // values that would render off-page. Legal Bates prefixes are
  // typically 3-letter codes (DEF / SMITH / TRIAL) so the bounds
  // match real-world usage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);

    const rawPrefix = params.get("prefix");
    if (rawPrefix && /^[A-Za-z0-9]{1,10}$/.test(rawPrefix)) {
      setPrefix(rawPrefix);
    }

    const rawDigits = params.get("digits");
    if (rawDigits) {
      const n = parseInt(rawDigits, 10);
      if (Number.isFinite(n) && n >= 4 && n <= 10) setDigits(n);
    }

    const rawStart = params.get("startNumber");
    if (rawStart) {
      const n = parseInt(rawStart, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 999999) setStartNumber(n);
    }

    const rawPos = params.get("position");
    if (
      rawPos === "bottom-right" || rawPos === "bottom-left" ||
      rawPos === "bottom-center" || rawPos === "top-right" ||
      rawPos === "top-left" || rawPos === "top-center"
    ) setPosition(rawPos);

    const rawSize = params.get("fontSize");
    if (rawSize) {
      const n = parseInt(rawSize, 10);
      // Bates numbers go on every page — bounds tight 6..20 to
      // keep them readable but not intrusive.
      if (Number.isFinite(n) && n >= 6 && n <= 20) setFontSize(n);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (prefix === "LAW") params.delete("prefix");
    else params.set("prefix", prefix);
    if (digits === 6) params.delete("digits");
    else params.set("digits", String(digits));
    if (startNumber === 1) params.delete("startNumber");
    else params.set("startNumber", String(startNumber));
    if (position === "bottom-right") params.delete("position");
    else params.set("position", position);
    if (fontSize === 9) params.delete("fontSize");
    else params.set("fontSize", String(fontSize));
    const qs = params.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", next);
    }
  }, [prefix, digits, startNumber, position, fontSize]);

  const previewLabel =
    prefix + String(startNumber).padStart(digits, "0");

  return (
    <PdfSimpleOpsTool
      toolId="bates-numbers"
      toolGroup="Edit"
      dropPrompt="Drop a PDF to apply Bates numbering"
      busyLabel="Stamping Bates labels…"
      actionLabel={() => `Stamp Bates labels (${previewLabel}…)`}
      successCta="Stamp another PDF"
      errorCode="bates_failed"
      howItWorks={
        <ToolHowItWorks
          steps={[
            {
              title: "Pick prefix + starting number",
              body:
                "Legal Bates codes are typically 3-letter case codes (DEF, SMITH, TRIAL). Digit width sets the zero-padding (6 digits = LAW000001). Start number is where this batch begins — useful when picking up from a previous production.",
            },
            {
              title: "Drop a PDF",
              body:
                "Up to 100 MB. The preview label updates live so you can sanity-check the format before applying.",
            },
            {
              title: "Stamp every page and download",
              body:
                "pdf-lib draws the Bates label at the chosen position on every page. Each page increments by one. Output is a normal PDF with embedded text — searchable, copyable, ready for production.",
            },
          ]}
          privacyNote="Bates numbering runs entirely in your browser via pdf-lib — files never leave your machine. Critical for legal work."
        />
      }
      configPanel={
        <div
          className="card"
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Prefix
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.slice(0, 16))}
                placeholder="LAW"
                style={{
                  padding: "4px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "var(--bg-1)",
                  color: "var(--fg)",
                  fontSize: 13,
                  width: 100,
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Digit count
              <select
                value={digits}
                onChange={(e) => setDigits(Number(e.target.value))}
                style={{
                  padding: "4px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "var(--bg-1)",
                  color: "var(--fg)",
                  fontSize: 13,
                }}
              >
                {[3, 4, 5, 6, 7, 8].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Start number
              <input
                type="number"
                min={0}
                value={startNumber}
                onChange={(e) => setStartNumber(Math.max(0, Number(e.target.value) || 0))}
                style={{
                  padding: "4px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "var(--bg-1)",
                  color: "var(--fg)",
                  fontSize: 13,
                  width: 110,
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Font size
              <select
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                style={{
                  padding: "4px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "var(--bg-1)",
                  color: "var(--fg)",
                  fontSize: 13,
                }}
              >
                {[8, 9, 10, 11, 12, 14].map((s) => (
                  <option key={s} value={s}>
                    {s}pt
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Position</div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {POSITIONS.map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  className={`btn btn-sm ${position === opt.v ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setPosition(opt.v)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="subtle" style={{ fontSize: 12 }}>
            Preview: <strong>{previewLabel}</strong> on page 1, then sequential.
            Use a wide enough digit count to cover all pages
            (digit pad is enforced — overflow throws an error before stamping).
          </div>
        </div>
      }
      apply={async (bytes, file) => {
        const { batesNumbersPdf } = await import("@/lib/pdf/ops/bates-numbers");
        const r = await batesNumbersPdf(bytes, {
          prefix,
          digits,
          startNumber,
          position,
          fontSize,
        });
        const baseName = file.name.replace(/\.pdf$/i, "");
        return {
          outputBytes: r.bytes,
          outputFileName: `${baseName || "document"}-bates.pdf`,
          headline: `Stamped ${r.pageCount} page${r.pageCount === 1 ? "" : "s"} (${previewLabel} → ${r.lastLabel})`,
          detail: `Last label stamped: ${r.lastLabel}. Continue your next batch from #${startNumber + r.pageCount}.`,
        };
      }}
    />
  );
}
