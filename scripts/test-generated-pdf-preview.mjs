#!/usr/bin/env node
/**
 * 2026-05-08 — Item #10 from the improvement analysis: preview-
 * before-download for AI-generated PDFs.
 *
 * Three AI tool runners produce a PDF as a base64 payload in their
 * success card: GeneratePdfTool / RedactPdfTool / SignPdfTool.
 * Each must mount the new GeneratedPdfPreview component above the
 * markdown summary so the user can verify the visual result before
 * downloading. This guard pins:
 *
 *   - The component file exists and is a client component
 *   - The component has the expected named export + props shape
 *   - base64 → bytes decode is wrapped in try/catch (decode of
 *     malformed input must not crash the whole tool runner)
 *   - All 3 consumer tools import GeneratedPdfPreview
 *   - Each consumer mounts <GeneratedPdfPreview base64={result.<field>}>
 *     using its specific result-shape field
 *   - The mount is gated on truthy base64 so the preview component
 *     doesn't render an empty shell when the AI op skipped the PDF
 *     output (e.g. replay branch on Generate)
 *
 * Pure static parse. Sub-second.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(msg);
  }
}

const COMP_PATH = path.join(ROOT, "components/tools/GeneratedPdfPreview.tsx");
const GENERATE_PATH = path.join(ROOT, "components/tools/GeneratePdfTool.tsx");
const REDACT_PATH = path.join(ROOT, "components/tools/RedactPdfTool.tsx");
const SIGN_PATH = path.join(ROOT, "components/tools/SignPdfTool.tsx");

for (const p of [COMP_PATH, GENERATE_PATH, REDACT_PATH, SIGN_PATH]) {
  assert(fs.existsSync(p), `${path.basename(p)} missing at ${p}`);
}

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  console.log(`generated-pdf-preview: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

const COMP_SRC = fs.readFileSync(COMP_PATH, "utf8");
const GENERATE_SRC = fs.readFileSync(GENERATE_PATH, "utf8");
const REDACT_SRC = fs.readFileSync(REDACT_PATH, "utf8");
const SIGN_SRC = fs.readFileSync(SIGN_PATH, "utf8");

// ---------------------------------------------------------------------
// Section A — component shape.
// ---------------------------------------------------------------------

assert(
  /^"use client"\s*;/m.test(COMP_SRC),
  "GeneratedPdfPreview must be a client component (uses useState, " +
    "useEffect, atob — all client-only).",
);

assert(
  /export\s+function\s+GeneratedPdfPreview\s*\(/.test(COMP_SRC),
  "Named export `GeneratedPdfPreview` not found.",
);

assert(
  /base64\s*:\s*string\s*\|\s*null/.test(COMP_SRC),
  "Props type must accept `base64: string | null` so callers can " +
    "pass null on result reset to clear the preview.",
);

assert(
  /function\s+base64ToBytes\s*\(\s*b64\s*:\s*string\s*\)/.test(COMP_SRC),
  "base64ToBytes helper must exist as a separately-named function. " +
    "Inlining the atob+charCodeAt loop into the component body makes " +
    "the try/catch around malformed-base64 harder to verify.",
);

assert(
  /try\s*\{[\s\S]*?atob\([\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?return\s+null/.test(
    COMP_SRC,
  ),
  "atob call must be wrapped in try/catch returning null on failure. " +
    "Malformed base64 throws InvalidCharacterError — uncaught, that " +
    "bubbles out and breaks the entire tool-runner success card.",
);

assert(
  /useFirstPagePreview\(\s*bytes\s*,\s*scale\s*\)/.test(COMP_SRC),
  "Must use the existing useFirstPagePreview hook. Reimplementing " +
    "the PDFium render path locally would bypass the M25 cache and " +
    "the M6 object-URL revocation discipline.",
);

// ---------------------------------------------------------------------
// Section B — Generate tool wires the preview.
// ---------------------------------------------------------------------

assert(
  /import\s*\{\s*GeneratedPdfPreview\s*\}\s*from\s*"\.\/GeneratedPdfPreview"/.test(
    GENERATE_SRC,
  ),
  "GeneratePdfTool must import GeneratedPdfPreview.",
);

assert(
  /\{result\.pdfBase64\s*&&\s*\([\s\S]*?<GeneratedPdfPreview\s+base64=\{result\.pdfBase64\}/.test(
    GENERATE_SRC,
  ),
  "GeneratePdfTool must mount <GeneratedPdfPreview base64={result.pdfBase64} /> " +
    "gated on truthy result.pdfBase64 (replay branch returns null pdfBase64; " +
    "without the gate the preview shell would render empty).",
);

// ---------------------------------------------------------------------
// Section C — Redact tool wires the preview.
// ---------------------------------------------------------------------

assert(
  /import\s*\{\s*GeneratedPdfPreview\s*\}\s*from\s*"\.\/GeneratedPdfPreview"/.test(
    REDACT_SRC,
  ),
  "RedactPdfTool must import GeneratedPdfPreview.",
);

assert(
  /\{result\.redactedPdfBase64\s*&&\s*\([\s\S]*?<GeneratedPdfPreview\s+base64=\{result\.redactedPdfBase64\}/.test(
    REDACT_SRC,
  ),
  "RedactPdfTool must mount <GeneratedPdfPreview base64={result.redactedPdfBase64} /> " +
    "gated on truthy result.redactedPdfBase64. This tool ESPECIALLY " +
    "needs the preview — redaction failures expose information the " +
    "user thought they'd hidden, so visual confirmation is high-stakes.",
);

// ---------------------------------------------------------------------
// Section D — Sign tool wires the preview.
// ---------------------------------------------------------------------

assert(
  /import\s*\{\s*GeneratedPdfPreview\s*\}\s*from\s*"\.\/GeneratedPdfPreview"/.test(
    SIGN_SRC,
  ),
  "SignPdfTool must import GeneratedPdfPreview.",
);

assert(
  /\{result\.signedPdfBase64\s*&&\s*\([\s\S]*?<GeneratedPdfPreview\s+base64=\{result\.signedPdfBase64\}/.test(
    SIGN_SRC,
  ),
  "SignPdfTool must mount <GeneratedPdfPreview base64={result.signedPdfBase64} /> " +
    "gated on truthy result.signedPdfBase64. AI sign placement can " +
    "drift one or two fields off when form labels are visually " +
    "ambiguous — the preview catches that.",
);

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
}

console.log(`generated-pdf-preview: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
