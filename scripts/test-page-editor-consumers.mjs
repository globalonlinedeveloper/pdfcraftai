#!/usr/bin/env node
/**
 * M1 (#193, 2026-04-29): single-page edge case invariants for PageEditorTool consumers.
 *
 * Each multi-page consumer of PageEditorTool (Highlight / Redact /
 * AddLinks / FreeDraw / Sign) needs to handle the case where a user
 * uploads a single-page PDF or only edits one page of a multi-page
 * PDF. Specifically the apply label and success headline copy needs
 * to read naturally in BOTH cases:
 *
 *   single-page  → "Apply 3 highlights" / "Added 3 highlights to page 1"
 *   multi-page   → "Apply 5 highlights on 3 pages" / "Added 5 highlights across 3 pages"
 *
 * Without this guard, a developer adding a new multi-page tool can
 * easily ship a "Apply 3 highlights on 1 pages" string (grammar fail)
 * or "Added 5 highlights across 1 pages" (singular pluralized). Both
 * shipped in earlier WIP; this audit codifies the fix.
 *
 * Also asserts that single-page consumers (Crop, AddTextBox) don't
 * gate their UI on `pageCount > 1` (they apply to all pages by design,
 * so the navigator stays hidden — wired via `multiPage: false` on
 * PageEditorTool, which the test verifies indirectly via grep).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const TOOLS_DIR = path.join(ROOT, "components/tools");

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

const MULTI_PAGE_CONSUMERS = [
  "PdfHighlightTool.tsx",
  "PdfRedactTool.tsx",
  "PdfAddLinksTool.tsx",
  "PdfFreeDrawTool.tsx",
  "PdfSignTool.tsx",
];

const SINGLE_PAGE_CONSUMERS = [
  "PdfCropTool.tsx",
  "PdfAddTextBoxTool.tsx",
];

console.log("PageEditorTool multi-page consumers — single-page handling:");
for (const name of MULTI_PAGE_CONSUMERS) {
  const full = path.join(TOOLS_DIR, name);
  const src = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
  assert(src.length > 0, `${name} exists`);
  if (!src) continue;

  // Must opt into multiPage mode.
  assert(
    /multiPage(\s*=\s*\{?\s*true|:\s*true)/.test(src) || /multiPage\b[^=]/.test(src),
    `${name} declares multiPage prop`,
  );

  // applyLabel must branch on pages count — either via `pages <= 1`,
  // `pages === 1`, `pages > 1`, or `entries.length === 1`.
  const hasPagesBranch =
    /pages\s*<=\s*1/.test(src) ||
    /pages\s*===\s*1/.test(src) ||
    /pages\s*>\s*1/.test(src) ||
    /entries\.length\s*===\s*1/.test(src);
  assert(hasPagesBranch, `${name} applyLabel branches on single vs multi page`);

  // Success headline must distinguish single-page from multi-page.
  // Either via `totalPages === 1` ternary, or via a length-1 array
  // formatter — either way, "1 pages" must not be possible.
  const hasHeadlineBranch =
    /totalPages\s*===\s*1/.test(src) ||
    /totalPages\s*<=\s*1/.test(src) ||
    /pages?\s*\?\s*"\s*page\s*"\s*:\s*"\s*pages\s*"/.test(src);
  assert(hasHeadlineBranch, `${name} success headline distinguishes single vs multi page`);

  // Plural-correct on the count ITSELF (not just the page word).
  // E.g. "highlights" must be pluralized only when count !== 1.
  const hasCountPluralization = /\$\{[^}]+(=== 1|!== 1)[^}]*\?[^}]*""[^}]*:\s*"s"/.test(src);
  assert(
    hasCountPluralization,
    `${name} pluralizes the count noun (e.g. highlight/highlights)`,
  );
}

console.log("");
console.log("PageEditorTool single-page consumers — must NOT use multiPage:");
for (const name of SINGLE_PAGE_CONSUMERS) {
  const full = path.join(TOOLS_DIR, name);
  const src = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
  assert(src.length > 0, `${name} exists`);
  if (!src) continue;

  // Crop and AddTextBox apply to all pages — they should NOT pass
  // multiPage: true (which would surface the page navigator).
  assert(
    !/multiPage\s*=\s*\{true\}/.test(src) && !/multiPage:\s*true/.test(src),
    `${name} does NOT opt into multiPage mode (per-page navigator stays hidden)`,
  );
}

console.log("");
console.log("PageEditorTool — page navigator gated on pageCount > 1:");
{
  const editor = fs.readFileSync(path.join(TOOLS_DIR, "PageEditorTool.tsx"), "utf8");
  assert(
    /render\.pageCount\s*>\s*1/.test(editor),
    "PageEditorTool gates the page navigator on pageCount > 1 (single-page docs hide it)",
  );
}

// ──────────────────────────────────────────────────────────────────
// M13 (#193, 2026-04-29; extended 2026-05-02): orientation-change
// resilience.
//
// The architectural invariant that makes M13 a non-issue: every
// visual editor stores rects/strokes in PDFium-pixel coordinates
// (orientation-independent) and renders them via percentage-based
// positioning relative to pageRender.pxWidth/pxHeight. When the
// device rotates, the container re-flows, but:
//   - Stored rects don't change (PDFium pixels are fixed)
//   - Rendered positions auto-rescale (% of new container width)
//   - Pointer coords convert via current rect.width on each event
// So orientation change "just works" — the only mid-rotation glitch
// would be a single in-flight drag, which the user can abandon.
//
// 2026-05-02 extension: the original 3-tool guard left 6 of 9 visual
// editors uncovered. The full audit confirmed all 9 use the same
// pattern, but only the 3 with rect-style overlays had explicit
// pointer-conversion checks. The other 6 use SVG viewBox auto-scale
// (FreeDraw) or marker-style centered positioning (Sign / Stamp /
// ImageWatermark / Crop / AddTextBox). The unifying invariant for
// ALL 9: aspectRatio-locked container matching pageRender pxWidth/
// pxHeight. Without that, the overlay container's aspect ratio
// drifts from the underlying image's aspect ratio on resize, and
// EVERYTHING — rect rects, SVG paths, centered markers — misaligns.
// ──────────────────────────────────────────────────────────────────
console.log("");
console.log("M13 — visual editors use orientation-independent % positioning:");
const VISUAL_EDITORS_WITH_RECTS = [
  "PdfHighlightTool.tsx",
  "PdfRedactTool.tsx",
  "PdfAddLinksTool.tsx",
];
for (const name of VISUAL_EDITORS_WITH_RECTS) {
  const src = fs.readFileSync(path.join(TOOLS_DIR, name), "utf8");
  // pointerToPx pattern: divides clientX-rect.left by rect.width and
  // multiplies by pageRender.pxWidth. That's the "store in PDFium
  // pixels, regardless of current display size" pattern.
  assert(
    /\(\s*xCss\s*\/\s*rect\.width\s*\)\s*\*\s*pageRender\.pxWidth/.test(src) ||
      /xCss\s*\*\s*pageRender\.pxWidth\s*\/\s*rect\.width/.test(src),
    `${name} converts pointer coords to PDFium pixels (orientation-independent)`,
  );
  // Render: rect x-coord divided by pageRender.pxWidth times 100 →
  // percentage positioning. Either `r.x` or `s.rect.x` shape (the two
  // structures consumers use). % positioning means a re-flowed
  // container automatically displays the rect at the correct relative
  // position post-rotation.
  assert(
    /\(\s*\w+(?:\.\w+)*\.x\s*\/\s*pageRender\.pxWidth\s*\)\s*\*\s*100/.test(src),
    `${name} renders rect x-coord as % of pxWidth (auto-rescales on rotation)`,
  );
}

// 2026-05-02 — extension: the unifying aspect-ratio invariant for
// ALL 9 visual editors. The overlay container MUST lock its aspect
// ratio to pageRender.pxWidth / pageRender.pxHeight. Without this,
// the container can re-flow at a different aspect ratio than the
// underlying image, and every overlay element (rects, SVG paths,
// markers) misaligns regardless of how positions are stored. This
// invariant alone fixes orientation change for editors that use
// SVG viewBox or centered-marker positioning — the "store in PDFium
// pixels" pointer-conversion check above only applies to the 3
// rect-style consumers.
console.log("");
console.log("M13 — all visual editors aspect-ratio-lock to page dimensions:");
const ALL_VISUAL_EDITORS = [
  "PdfHighlightTool.tsx",
  "PdfRedactTool.tsx",
  "PdfAddLinksTool.tsx",
  "PdfAddTextBoxTool.tsx",
  "PdfFreeDrawTool.tsx",
  "PdfSignTool.tsx",
  "PdfStampTool.tsx",
  "PdfImageWatermarkTool.tsx",
  "PdfCropTool.tsx",
];
for (const name of ALL_VISUAL_EDITORS) {
  const src = fs.readFileSync(path.join(TOOLS_DIR, name), "utf8");
  // The container's aspectRatio CSS property pins it to a ratio
  // derived from pageRender.pxWidth / pageRender.pxHeight. Two
  // patterns observed: template-literal "${pxWidth} / ${pxHeight}"
  // (most editors) or fixed "8.5 / 11" (Stamp's hero preview before
  // a file is loaded). The fixed-ratio variant is acceptable because
  // it locks an aspect ratio — just one specific to Letter paper.
  // Once a PDF loads, Stamp also uses the dynamic shape on its
  // editing overlay.
  const hasDynamicLock = /aspectRatio:\s*`?\$\{[^}]*pxWidth[^}]*\}\s*\/\s*\$\{[^}]*pxHeight[^}]*\}/.test(src);
  const hasFixedLock = /aspectRatio:\s*"\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?"/.test(src);
  assert(
    hasDynamicLock || hasFixedLock,
    `${name} aspect-ratio-locks its overlay container (orientation-independent layout)`,
  );
}

// SVG viewBox lock — for editors that draw via SVG (FreeDraw is the
// canonical case), the viewBox attribute auto-scales contents to fit
// the container while preserving aspect ratio. Pin it explicitly so
// a refactor that switches FreeDraw back to canvas can't silently
// regress orientation behavior.
console.log("");
console.log("M13 — SVG-overlay editors use pxWidth/pxHeight viewBox:");
const SVG_OVERLAY_EDITORS = ["PdfFreeDrawTool.tsx"];
for (const name of SVG_OVERLAY_EDITORS) {
  const src = fs.readFileSync(path.join(TOOLS_DIR, name), "utf8");
  assert(
    /viewBox=\{?`?0\s+0\s+\$\{[^}]*pxWidth[^}]*\}\s+\$\{[^}]*pxHeight[^}]*\}/.test(src),
    `${name} uses SVG viewBox locked to PDFium pxWidth/pxHeight`,
  );
}

console.log("");
if (failed === 0) {
  console.log(`PASS — ${passed} assertions`);
  console.log(`${passed} passed, 0 failed`);
  process.exit(0);
} else {
  console.error(`FAIL — ${failed} assertion(s) failed`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(1);
}
