#!/usr/bin/env node
// Lighthouse CI budget contract guard (2026-06-07, upgrade plan #9). Ensures
// the perf run actually GATES on regression (budgets exist + are wired), not
// just prints scores. Static parse.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0; const failures = [];
const assert = (c, m) => { if (c) passed++; else { failed++; failures.push(m); console.error(`  ✗ ${m}`); } };

console.log("lighthouserc.json — budget assertions:");
const rcRaw = fs.readFileSync(path.join(ROOT, "lighthouserc.json"), "utf8");
let rc;
try { rc = JSON.parse(rcRaw); assert(true, "lighthouserc.json is valid JSON"); }
catch { assert(false, "lighthouserc.json is valid JSON"); rc = {}; }
const a = (rc.ci && rc.ci.assert && rc.ci.assert.assertions) || {};
assert(Object.keys(a).length >= 4, `has budget assertions (${Object.keys(a).length})`);
for (const key of ["categories:accessibility", "categories:seo", "categories:best-practices", "cumulative-layout-shift"]) {
  assert(Array.isArray(a[key]) && a[key][0] === "error", `${key} is an ERROR-level gate (fails on regression)`);
}
assert(a["cumulative-layout-shift"] && a["cumulative-layout-shift"][1] && typeof a["cumulative-layout-shift"][1].maxNumericValue === "number", "CLS has a numeric cap");
assert(Array.isArray(a["categories:performance"]), "performance score is asserted (warn-level OK)");

console.log("perf.yml — wired to the budget:");
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/perf.yml"), "utf8");
assert(/configPath:\s*\.\/lighthouserc\.json/.test(wf), "perf.yml passes configPath: ./lighthouserc.json");
assert(/treosh\/lighthouse-ci-action/.test(wf), "uses the lighthouse-ci action (runs the assertions)");

console.log("");
if (failed === 0) { console.log(`PASS — ${passed} assertions`); console.log(`${passed} passed, 0 failed`); process.exit(0); }
else { console.error("FAIL:"); for (const m of failures) console.error(`  ${m}`); console.log(`${passed} passed, ${failed} failed`); process.exit(1); }
