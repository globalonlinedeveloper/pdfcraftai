#!/usr/bin/env node
// scripts/test-paper-size-naming.mjs
//
// 2026-05-01: catch country-prefixed paper-size labels in user-facing
// copy and config presets.
//
// The convention across the catalog is bare "Letter" / "Legal" /
// "Tabloid" — these are paper-size names, not geographic markers, and
// "Letter" is unambiguous everywhere it's used (no other paper size
// shares the name). The product is region-agnostic, so prefixing with
// "US" implies parochialism (and reads oddly to users in regions where
// Letter is just one option among many).
//
// Drift surfaced on 2026-05-01 across 6+ files: PdfResizeTool's preset
// labels said "US Letter / US Legal", the new ImagesToPdfTool /
// TextToPdfTool inherited that pattern, and 4 SEO landings + 2
// seo-longform passages had similar drift. All fixed in commit X;
// this guard prevents regression.
//
// What's allowed:
//   - "Letter" / "Legal" / "Tabloid" bare in any user-facing copy.
//   - "US printer queue" / "EU printer queue" in copy where the
//     geography is the actual subject (e.g. routing rules).
//   - "US Letter" inside CODE COMMENTS, JSDoc, and TEST DESCRIPTIONS
//     — those describe a technical spec where the formal name helps
//     a developer reading the source.
//
// What's NOT allowed:
//   - "US Letter" / "US Legal" / "US Tabloid" inside string literals
//     that ship to users (component labels, marketing copy, FAQs).
//
// Output line conforms to the aggregator regex
// `${name}: ${pass} passed, ${fail} failed`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let pass = 0;
let fail = 0;
const failures = [];
function assert(label, cond, detail) {
  if (cond) pass += 1;
  else {
    fail += 1;
    failures.push({ label, detail: detail ?? "" });
  }
}

// ---------------------------------------------------------------------
// Section A — collect candidate files.
// ---------------------------------------------------------------------

// Scan the tree for .ts / .tsx files in lib/ + components/ + app/.
// Skip node_modules, .next, scripts/, tests/, anywhere with build
// artifacts.
const SCAN_DIRS = ["lib", "components", "app"];
const SKIP_DIR_PARTS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  ".git",
  "test-results",
  "playwright-report",
]);

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIR_PARTS.has(name)) continue;
    const full = resolve(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile() && /\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(resolve(ROOT, d), files);

assert(
  "Source tree scan returned non-empty file list",
  files.length > 100,
  `Found only ${files.length} .ts/.tsx files; SCAN_DIRS may be wrong.`,
);

// ---------------------------------------------------------------------
// Section B — strip comments + look for forbidden patterns inside
// string literals.
// ---------------------------------------------------------------------

// Forbidden labels that ship to users.
const FORBIDDEN = [
  /\bUS\s+Letter\b/g,
  /\bUS\s+Legal\b/g,
  /\bUS\s+Tabloid\b/g,
];

// Files where the formal name is genuinely needed (rare). Each
// exemption requires a short rationale.
const EXEMPT_FILES = new Map([
  // Code-comment-only references describing the technical paper-size
  // spec for developers reading the file. Not user-facing.
  ["lib/tools-server/pdf-to-office.ts", "code comment about docx-js default page size"],
]);

function stripCommentsAndFences(src) {
  // Remove line comments.
  src = src.replace(/\/\/.*$/gm, "");
  // Remove block comments (incl. JSDoc).
  src = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return src;
}

const offenders = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  if (EXEMPT_FILES.has(rel)) continue;
  const raw = readFileSync(file, "utf8");
  const stripped = stripCommentsAndFences(raw);
  for (const pat of FORBIDDEN) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(stripped)) !== null) {
      // Find the line number in the ORIGINAL source for actionable
      // error messages. The stripped source has the same line numbers
      // for non-comment content (comment removal is per-line / span,
      // doesn't shift line offsets after stripping line comments
      // since we left newlines intact). Block-comment removal does
      // collapse multi-line spans, so line lookup uses the FULL
      // source, searching for the same match string.
      const linesUpTo = raw.slice(0, raw.indexOf(m[0])).split("\n");
      offenders.push({
        file: rel,
        line: linesUpTo.length,
        match: m[0],
        snippet: extractSnippet(raw, m[0]),
      });
    }
  }
}

function extractSnippet(src, needle) {
  const idx = src.indexOf(needle);
  if (idx < 0) return "";
  const start = Math.max(0, idx - 40);
  const end = Math.min(src.length, idx + needle.length + 40);
  return src.slice(start, end).replace(/\s+/g, " ").trim();
}

assert(
  "No country-prefixed paper-size labels in user-facing copy",
  offenders.length === 0,
  offenders.length === 0
    ? ""
    : `Found ${offenders.length} occurrence(s) of "US Letter" / "US Legal" / "US Tabloid" in shipping code.\n` +
        `Convention is bare "Letter" / "Legal" / "Tabloid" — paper sizes have unambiguous names ` +
        `that don't need a geographic prefix in user-facing copy. ` +
        `If the geography is genuinely the subject (e.g. routing rules), keep the prefix on the queue/region label, ` +
        `not on the paper name (e.g. "Letter → US printer queue" not "US Letter → printer queue").\n` +
        `If the file is a code comment describing the formal spec for developers, add it to EXEMPT_FILES with rationale.\n\n` +
        offenders
          .map(
            (o) =>
              `  ${o.file}:${o.line}  "${o.match}"\n      ...${o.snippet}...`,
          )
          .join("\n\n"),
);

// ---------------------------------------------------------------------
// Section C — sanity: EXEMPT_FILES must reference real files. Stale
// entries hide regressions.
// ---------------------------------------------------------------------

import { existsSync } from "node:fs";
const orphanExempts = [...EXEMPT_FILES.keys()].filter(
  (rel) => !existsSync(resolve(ROOT, rel)),
);
assert(
  "EXEMPT_FILES only references existing files",
  orphanExempts.length === 0,
  orphanExempts.length === 0
    ? ""
    : `Stale EXEMPT_FILES entries: ${orphanExempts.join(", ")}.\n  Remove them.`,
);

// Cap on EXEMPT_FILES so it doesn't grow into "everything is exempt."
assert(
  "EXEMPT_FILES stays focused (≤ 5 entries)",
  EXEMPT_FILES.size <= 5,
  `EXEMPT_FILES has ${EXEMPT_FILES.size} entries; cap is 5. Genuine exemptions are rare.`,
);

// ---------------------------------------------------------------------
// Section D — proof-of-concept: positive control. Inject a synthetic
// offender into a string and verify the regex catches it. Catches
// "regex got broken by a refactor" silently.
// ---------------------------------------------------------------------

const SYNTHETIC = '  const x = "Pick US Letter or A4";';
const SYNTH_HIT = FORBIDDEN[0].test(SYNTHETIC);
FORBIDDEN[0].lastIndex = 0; // reset stateful regex
assert(
  "Forbidden-pattern regex is functional (synthetic match)",
  SYNTH_HIT,
  "FORBIDDEN[0] failed to match a synthetic 'US Letter' literal — regex broken.",
);

const SYNTHETIC_NEG = '  // US Letter is the formal name';
const stripped = stripCommentsAndFences(SYNTHETIC_NEG);
const NEG_HIT = FORBIDDEN[0].test(stripped);
FORBIDDEN[0].lastIndex = 0;
assert(
  "Comment-stripping leaves no match in synthetic comment",
  !NEG_HIT,
  "stripCommentsAndFences failed to remove a line comment — comments would be flagged.",
);

// ---------------------------------------------------------------------
// Aggregator-friendly summary line.
// ---------------------------------------------------------------------

const total = pass + fail;
console.log("");
if (fail > 0) {
  console.log("FAILURES:");
  for (const f of failures) {
    console.log(`  ✗ ${f.label}`);
    if (f.detail) {
      for (const line of f.detail.split("\n")) console.log(`      ${line}`);
    }
  }
  console.log("");
}
console.log(
  `paper-size-naming: ${pass} passed, ${fail} failed (of ${total})`,
);
process.exit(fail > 0 ? 1 : 0);
