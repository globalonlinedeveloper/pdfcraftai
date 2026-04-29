#!/usr/bin/env node
/**
 * M6 (#193, 2026-04-29): Object URL revocation invariant.
 *
 * Walks every .ts/.tsx in components/, lib/, and app/ — counts
 * `createObjectURL` and `revokeObjectURL` references per file.
 * Fails the suite if any file creates more URLs than it revokes.
 *
 * The audit run on 2026-04-29 found 36 sites total, all clean
 * (28 have 1:1 pairs, 8 have defensive over-revoke patterns).
 * This test guards against regressions where someone adds a
 * `createObjectURL` without the matching cleanup.
 *
 * Why this matters: leaked object URLs hold the underlying Blob
 * in memory until the page reloads. On mobile Safari (1.5GB heap
 * cap) a stack of 50MB PDFs gets you killed in ~30 ops. On
 * desktop it's slower to trigger but still real.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_DIRS = ["components", "lib", "app"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);

let passed = 0;
let failed = 0;
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    const name = entry.name;
    if (!(name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".js"))) continue;
    const full = path.join(dir, name);
    const src = fs.readFileSync(full, "utf8");
    // Match \bcreateObjectURL\b — word boundaries so we don't
    // catch substrings.
    const created = (src.match(/\bcreateObjectURL\b/g) || []).length;
    const revoked = (src.match(/\brevokeObjectURL\b/g) || []).length;
    if (created === 0) continue;
    const rel = path.relative(ROOT, full);
    if (revoked < created) {
      failed++;
      failures.push({ file: rel, created, revoked });
    } else {
      passed++;
    }
  }
}

for (const d of SCAN_DIRS) {
  const full = path.join(ROOT, d);
  if (fs.existsSync(full)) walk(full);
}

if (failures.length === 0) {
  console.log(`  ${passed} files OK`);
  console.log(`PASS — every createObjectURL has a matching revokeObjectURL`);
  // Summary line matches the runner's regex: "N passed, M failed"
  console.log(`${passed} passed, 0 failed`);
  process.exit(0);
}

console.error(`FAIL — ${failures.length} file(s) leak Object URLs:`);
for (const { file, created, revoked } of failures) {
  console.error(`  ${file}: created=${created}, revoked=${revoked}`);
}
console.error("");
console.error("Each createObjectURL() needs a matching revokeObjectURL() —");
console.error("either inline (download flow) or in a useEffect cleanup.");
console.log(`${passed} passed, ${failed} failed`);
process.exit(1);
