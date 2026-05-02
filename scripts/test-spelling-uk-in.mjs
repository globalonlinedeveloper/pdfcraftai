#!/usr/bin/env node
/**
 * 2026-05-02 Tier B2: British/Indian spelling consistency guard.
 *
 * The site is India-based — INR pricing, India-specific landing
 * copy, India-specific legal disclaimers (CrPC, IT Act 2000,
 * IRDAI, etc.). Verbs that have both forms should use the
 * British/Indian convention by default. Specifically:
 *
 *   Analysing   (not Analyzing)
 *   Recognising (not Recognizing)
 *   Categorising (not Categorizing)
 *
 * Rationale: brand voice consistency. "Analyzing…" in one tool's
 * busy-state spinner amid 8 other tools' "Analysing…" reads as
 * a typo, not as locale-correct copy. Caught one such drift in
 * CourtOrderTool today; this guard prevents future ones.
 *
 * Verbs that take only -ize in both dialects are NOT flagged:
 *   Summarize / Summarizing — Oxford spelling allows -ize for these
 *   Optimize / Optimizing — same
 *   Memorize / Customize / Sanitize — same
 *
 * Scope: user-facing strings only. Code identifiers, comments, and
 * internal log messages are exempt — the guard checks string
 * literals in JSX-like contexts.
 *
 * Output line conforms to the aggregator regex
 * `${name}: ${pass} passed, ${fail} failed`.
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

// Verbs we audit. Each entry: [bad-pattern, good-pattern, common form].
// The pattern is a substring search on string literals (anchored on
// word boundaries via the regex below).
const SPELLING_PAIRS = [
  ["Analyzing", "Analysing"],
  ["Analyzed", "Analysed"],
  ["Analyze", "Analyse"],
  ["Recognizing", "Recognising"],
  ["Recognized", "Recognised"],
  ["Recognize", "Recognise"],
  ["Categorizing", "Categorising"],
  ["Categorized", "Categorised"],
  ["Categorize", "Categorise"],
];

// Walk components/tools and lib for TS/TSX files. Skip node_modules,
// .next, scripts (CI scripts can use either spelling), and docs.
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = [
  ...walk(path.join(ROOT, "components")),
  ...walk(path.join(ROOT, "lib")),
  ...walk(path.join(ROOT, "app")).filter((f) => !f.includes("/api/")),
];

// String-literal extractor — captures double-quoted and template-
// literal contents from the source. Comment lines starting with `//`
// or inside `/* */` blocks are excluded by stripping them first.
function extractUserFacingStrings(src) {
  // Strip block comments (/* ... */) and line comments (// ...).
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const out = [];
  // Match double-quoted strings.
  const STR_RE = /"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = STR_RE.exec(stripped)) !== null) out.push(m[1]);
  // Match template literals (backtick-delimited). Conservative — only
  // capture the raw segments between ${...} interpolations.
  const TEMPLATE_RE = /`((?:\\.|[^`\\])*)`/g;
  while ((m = TEMPLATE_RE.exec(stripped)) !== null) out.push(m[1]);
  return out;
}

// Third-party-product-name exceptions: when our copy QUOTES a third
// party's UI label, accuracy beats consistency. Common case: Adobe
// Acrobat's "Recognize Text" menu item — quoting it as "Recognise
// Text" misleads readers about what to look for in Acrobat's UI.
//
// Pattern in copy: the bad spelling appears in a sentence that
// names the third-party tool. Conservative substring match — if
// the string contains BOTH the third-party name AND the bad
// spelling, allow it. Add new entries when new third-party UI
// labels need to be quoted.
const THIRD_PARTY_QUOTE_KEYWORDS = ["Acrobat", "Adobe", "Microsoft", "Google"];

function isThirdPartyQuote(str) {
  return THIRD_PARTY_QUOTE_KEYWORDS.some((k) => str.includes(k));
}

const violations = [];
for (const filePath of FILES) {
  const relPath = path.relative(ROOT, filePath);
  const src = fs.readFileSync(filePath, "utf8");
  const strings = extractUserFacingStrings(src);
  for (const str of strings) {
    for (const [bad, good] of SPELLING_PAIRS) {
      // Word-boundary regex; matches the bad spelling as a standalone
      // word, not as a substring of a longer identifier.
      const wordRe = new RegExp(`\\b${bad}\\b`);
      if (wordRe.test(str)) {
        // Allow third-party UI label quotes — accuracy beats consistency.
        if (isThirdPartyQuote(str)) continue;
        violations.push({
          file: relPath,
          string: str.length > 80 ? str.slice(0, 77) + "..." : str,
          bad,
          good,
        });
      }
    }
  }
}

assert(
  violations.length === 0,
  `Found ${violations.length} string(s) with American spelling that should use British/Indian convention.\n` +
    `Replace each occurrence with the British/Indian form (UI_COPY.md §Loading / busy states documents the rule).\n\n` +
    violations
      .map(
        (v) =>
          `  - ${v.file}: "${v.string}" — replace "${v.bad}" with "${v.good}"`,
      )
      .join("\n"),
);

// ---------------------------------------------------------------------------
// Sanity: floor on -ising/-ysing usage. Should be ~10+ across the
// catalog (Analysing in 8 tools today). If this drops to zero,
// someone migrated everything to American — flag it.
// ---------------------------------------------------------------------------

let goodCount = 0;
for (const filePath of FILES) {
  const src = fs.readFileSync(filePath, "utf8");
  for (const [, good] of SPELLING_PAIRS) {
    if (new RegExp(`\\b${good}\\b`).test(src)) {
      goodCount++;
      break; // count each file once
    }
  }
}

assert(
  goodCount >= 3,
  `Expected >= 3 files using British/Indian spellings (Analysing/Recognising/Categorising); found ${goodCount}. Bulk migration to American spelling?`,
);

// ---------------------------------------------------------------------------
// Self-test the regexes.
// ---------------------------------------------------------------------------

const POS = `"Analyzing…"`;
assert(
  /\bAnalyzing\b/.test(POS),
  "self-test: regex catches 'Analyzing' as a word",
);

const NEG_GOOD = `"Analysing…"`;
assert(
  !/\bAnalyzing\b/.test(NEG_GOOD),
  "self-test: regex doesn't false-positive on 'Analysing'",
);

const NEG_SUBSTR = `"reAnalyzingPipeline"`;
assert(
  /\bAnalyzing\b/.test(NEG_SUBSTR) === false,
  "self-test: regex doesn't match 'Analyzing' inside identifier-like substring (word boundary)",
);

// ---------------------------------------------------------------------------
// Aggregator-friendly summary.
// ---------------------------------------------------------------------------

const total = passed + failed;
console.log(`spelling-uk-in: ${passed} passed, ${failed} failed (of ${total})`);
if (failed > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
process.exit(0);
