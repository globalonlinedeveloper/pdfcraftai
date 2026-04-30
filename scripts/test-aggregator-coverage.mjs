#!/usr/bin/env node
/**
 * 2026-04-30 aggregator-coverage guard: every `scripts/test-*.mjs`
 * (and `scripts/test-*.ts`) MUST be wired into the SUITES array in
 * `scripts/run-all-tests.mjs`.
 *
 * Background: we have 50+ test files in scripts/. If someone adds a
 * new one but forgets to register it in SUITES, the test silently
 * never runs in `npm test`. Standalone runs work, but the
 * aggregator pretends the file doesn't exist — which is the worst
 * shape of failure: green local + green CI + actual coverage gap.
 *
 * This guard surfaced one real issue on first run: test-reverse-
 * sweep.mjs had been orphaned for an unknown duration, never picked
 * up by npm test. Wired in via this commit, output line aligned to
 * aggregator regex.
 *
 * Resolution rules:
 *   - Each `scripts/test-*.mjs` (or .ts) is mapped to a
 *     `file: "test-<name>.mjs"` field in SUITES.
 *   - Aliasing is allowed: `name: "ai-router", file: "test-router.mjs"`
 *     is OK because the SUITES file: field still references the
 *     real file.
 *
 * Out of scope:
 *   - Helper modules under scripts/ that aren't named `test-*`.
 *
 * Output line conforms to the aggregator regex
 * `${name}: ${pass} passed, ${fail} failed`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRIPTS_ROOT = path.join(ROOT, "scripts");

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

// ---------------------------------------------------------------------------
// Section A — list every test-<name>.mjs/.ts in scripts/.
// ---------------------------------------------------------------------------

const testFiles = fs
  .readdirSync(SCRIPTS_ROOT)
  .filter(
    (name) =>
      /^test-.*\.(mjs|ts)$/.test(name) &&
      // Exclude self (the guard itself).
      name !== "test-aggregator-coverage.mjs",
  );

assert(
  testFiles.length >= 40,
  `scripts/test-*.mjs|ts: expected >= 40 files, got ${testFiles.length}`,
);

// ---------------------------------------------------------------------------
// Section B — extract `file:` values from SUITES in run-all-tests.mjs.
// ---------------------------------------------------------------------------

const RUN_ALL_SRC = fs.readFileSync(
  path.join(SCRIPTS_ROOT, "run-all-tests.mjs"),
  "utf8",
);

const FILE_FIELD_RE = /file:\s*"([^"]+)"/g;
const registeredFiles = new Set();
let m;
while ((m = FILE_FIELD_RE.exec(RUN_ALL_SRC)) !== null) {
  registeredFiles.add(m[1]);
}

assert(
  registeredFiles.size >= 35,
  `SUITES file: count: expected >= 35, got ${registeredFiles.size}`,
);

// ---------------------------------------------------------------------------
// Section C — every test file must be referenced by at least one
// SUITES entry's `file:` field.
//
// Known orphans that are kept on purpose can be added to
// EXPECTED_ORPHANS — but the bar is high (e.g. test depends on
// network or live secrets we don't want in CI).
// ---------------------------------------------------------------------------

const EXPECTED_ORPHANS = new Set([
  // (none currently — orphans should be triaged into SUITES,
  // archived, or whitelisted here with a clear reason)
]);

const orphans = [];
for (const f of testFiles) {
  if (registeredFiles.has(f)) continue;
  if (EXPECTED_ORPHANS.has(f)) continue;
  orphans.push(f);
}

assert(
  orphans.length === 0,
  `Found ${orphans.length} orphan test file(s) — exist on disk but not registered in SUITES.\n` +
    `Each is silently uninvoked by \`npm test\`. Add to SUITES in scripts/run-all-tests.mjs OR (only if there's a strong reason) add to EXPECTED_ORPHANS in this file with a comment explaining why.\n\n` +
    `Orphans:\n` +
    orphans.map((f) => `  scripts/${f}`).join("\n"),
);

// ---------------------------------------------------------------------------
// Section D — every SUITES `file:` must point at a real file on
// disk. Catches typos that would silently fail the suite.
// ---------------------------------------------------------------------------

const dead = [];
for (const f of registeredFiles) {
  if (!fs.existsSync(path.join(SCRIPTS_ROOT, f))) {
    dead.push(f);
  }
}

assert(
  dead.length === 0,
  `Found ${dead.length} SUITES entries pointing at files that don't exist:\n` +
    dead.map((f) => `  scripts/${f}`).join("\n") +
    `\n\nFix: rename the file: field to match a real script, or remove the SUITES entry.`,
);

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------

const total = passed + failed;
console.log(
  `aggregator-coverage: ${passed} passed, ${failed} failed (of ${total})`,
);
if (failed > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
process.exit(0);
