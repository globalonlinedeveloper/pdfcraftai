#!/usr/bin/env node
/**
 * 2026-05-05 — Mobile-hostile style guard (PENDING §5f foundation).
 *
 * The Playwright mobile spec (tests/e2e/mobile-tools.spec.ts) catches
 * runtime overflow on 10 specific tool URLs. This static-parse guard
 * catches the BUG CLASS before it ships: hardcoded inline styles
 * that exceed the iPhone 14 viewport (390px) with no responsive
 * fallback.
 *
 * Why static parse vs only Playwright
 * ------------------------------------
 * Playwright covers known URLs. A new tool component shipped without
 * test coverage could ship a 1200px hardcoded width and pass CI
 * because the spec doesn't visit it. The static guard scans every
 * tool component file regardless.
 *
 * What this guard catches
 * -----------------------
 * 1. Inline style `width: <N>` where N > 380 AND no companion
 *    `maxWidth:` in the same style block. (`width: "100%"` is fine;
 *    `width: 1200` without `maxWidth: "100%"` is the bug.)
 * 2. Inline style `minWidth: <N>` where N > 380. minWidth on a
 *    container forces the layout wider than the viewport on mobile.
 *    Using `minWidth: 0` to break flex overflow is fine.
 * 3. `gridTemplateColumns: "repeat(N, …)"` where N >= 4 without a
 *    `minmax()` floor. 4-up grids on 390px viewports give each
 *    column < 100px which is unusable for tool-card-sized content.
 *
 * What this guard does NOT catch
 * ------------------------------
 * - Tailwind class strings (we don't use Tailwind here, but if we
 *   did, class names like `w-[1200px]` would need a different parser)
 * - CSS-in-JS template strings (we use inline style objects almost
 *   exclusively)
 * - Layout issues from FLEX containers without `min-width: 0` on
 *   children (the well-known flex overflow trap). Caught by the
 *   Playwright spec at runtime instead.
 * - Touch target size (44x44 minimum per WCAG). Different invariant;
 *   could add as Section D later.
 *
 * Output line conforms to aggregator regex:
 *   `${name}: ${pass} passed, ${fail} failed`.
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

const MOBILE_VIEWPORT_PX = 390; // iPhone 14
const MAX_HARDCODED_WIDTH = 380; // 10px breathing room

// ---------------------------------------------------------------------------
// Section A: scan tool components for hardcoded mobile-hostile widths
// ---------------------------------------------------------------------------

function findToolComponents(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!fs.existsSync(cur)) continue;
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        stack.push(full);
      } else if (
        (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) &&
        // Tool components only — not test fixtures or marketing
        // longforms (those have legitimate hardcoded widths for
        // print-spec mockups).
        !entry.name.endsWith(".d.ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".spec.ts")
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

const toolFiles = findToolComponents(path.join(ROOT, "components/tools"));
assert(
  toolFiles.length > 0,
  `A1: found tool component files (got ${toolFiles.length})`,
);

const violations = [];

for (const file of toolFiles) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);

  // Find every inline style block: { ... }
  // We use a coarse "line containing width: N where N is a number"
  // pass and then verify no maxWidth nearby. Not perfect — JSX style
  // objects can span multiple lines — but catches the common case
  // where someone writes `style={{ width: 1200 }}` or
  // `style={{ width: "1200px" }}`.
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments. Comments often discuss widths in prose.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;

    // width: 1200 or width: "1200px"
    const widthMatch = line.match(
      /\bwidth:\s*["']?(\d+)(?:px)?["']?/,
    );
    if (widthMatch) {
      const n = parseInt(widthMatch[1], 10);
      if (n > MAX_HARDCODED_WIDTH) {
        // Look 3 lines before + 3 lines after for a maxWidth. If
        // present, this width is bounded — fine on mobile.
        const window = lines
          .slice(Math.max(0, i - 3), Math.min(lines.length, i + 4))
          .join("\n");
        if (!/maxWidth:/.test(window)) {
          violations.push(
            `${rel}:${i + 1}: width: ${n} (no companion maxWidth) — overflows ${MOBILE_VIEWPORT_PX}px viewport`,
          );
        }
      }
    }

    // minWidth: 500 (more aggressive — minWidth FORCES width, no
    // amount of maxWidth saves you).
    const minWidthMatch = line.match(
      /\bminWidth:\s*["']?(\d+)(?:px)?["']?/,
    );
    if (minWidthMatch) {
      const n = parseInt(minWidthMatch[1], 10);
      if (n > MAX_HARDCODED_WIDTH) {
        violations.push(
          `${rel}:${i + 1}: minWidth: ${n} — forces layout wider than ${MOBILE_VIEWPORT_PX}px viewport`,
        );
      }
    }

    // gridTemplateColumns: "repeat(4, ...)" or higher without minmax
    const gridMatch = line.match(
      /\bgridTemplateColumns:\s*["']repeat\((\d+),\s*([^"']+)["']/,
    );
    if (gridMatch) {
      const cols = parseInt(gridMatch[1], 10);
      const cell = gridMatch[2];
      if (cols >= 4 && !cell.includes("minmax(")) {
        violations.push(
          `${rel}:${i + 1}: gridTemplateColumns repeat(${cols}, ${cell}) — 4+ columns on 390px viewport gives each cell < 100px; use minmax() floor`,
        );
      }
    }
  }
}

// Each violation is its own assertion failure so the operator gets
// file + line for each.
if (violations.length === 0) {
  passed++; // umbrella pass
} else {
  for (const v of violations) {
    failed++;
    failures.push(v);
  }
}

assert(
  toolFiles.length >= 30,
  `A2: scanned >= 30 tool components (got ${toolFiles.length})`,
);

// ---------------------------------------------------------------------------
// Section B: Playwright mobile spec exists
// ---------------------------------------------------------------------------

const SPEC = path.join(ROOT, "tests/e2e/mobile-tools.spec.ts");
assert(
  fs.existsSync(SPEC),
  "B1: tests/e2e/mobile-tools.spec.ts exists (mobile runtime coverage)",
);
if (fs.existsSync(SPEC)) {
  const specSrc = fs.readFileSync(SPEC, "utf8");

  assert(
    /devices\["iPhone 14"\]/.test(specSrc),
    "B2: spec uses iPhone 14 device emulation (390×844 viewport — narrowest modern)",
  );

  // The horizontal-scroll assertion must be present. Without it the
  // spec is coverage theater.
  assert(
    /document\.body\.scrollWidth/.test(specSrc) &&
      /window\.innerWidth/.test(specSrc) &&
      /toBeLessThanOrEqual/.test(specSrc),
    "B3: spec asserts body.scrollWidth ≤ window.innerWidth (no horizontal scroll — the #1 mobile-UX anti-signal)",
  );

  // Above-fold CTA assertion
  assert(
    /getBoundingClientRect/.test(specSrc) && /844/.test(specSrc),
    "B4: spec asserts at least one CTA visible above the fold (within 844px)",
  );

  // Console error filter — we DO want to assert no errors but we
  // filter known benign third-party noise (Clarity, GA4) so the
  // spec doesn't false-positive.
  assert(
    /clarity\.ms/.test(specSrc) && /googletagmanager/.test(specSrc),
    "B5: spec filters out known third-party console-error noise (clarity.ms, googletagmanager)",
  );

  // At least 5 tool URLs covered. Below this we're not really a
  // spec, we're a sample.
  const urlCount = (specSrc.match(/^\s*"\/(tool\/[a-z0-9-]+|)?",?\s*\/\//gm) ||
    [])
    .length;
  // The above regex is fragile; do a simpler "count lines starting
  // with quoted path-like strings".
  const urlLines = specSrc
    .split("\n")
    .filter((l) => /^\s*"\/[a-zA-Z0-9-/]*",?\s*(\/\/.*)?$/.test(l));
  assert(
    urlLines.length >= 5,
    `B6: spec covers >= 5 URLs (got ${urlLines.length})`,
  );
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`mobile-hostile-styles: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
