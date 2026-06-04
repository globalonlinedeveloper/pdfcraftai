// scripts/test-clipboard-helper.mjs
//
// Guard: every "Copy" button goes through the shared copyText() helper
// (lib/client/copy-text.ts), never `navigator.clipboard.writeText`
// directly — so all 13 call sites keep the execCommand fallback + the
// "copy failed" surfacing instead of silently doing nothing when the
// async Clipboard API is blocked.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HELPER = "lib/client/copy-text.ts";
const SCAN_DIRS = ["components", "app"];
let passed = 0, failed = 0;
const failures = [];

// 1) helper exists + has both paths + throws on total failure
const help = fs.existsSync(path.join(ROOT, HELPER)) ? fs.readFileSync(path.join(ROOT, HELPER), "utf8") : "";
function check(cond, msg) { if (cond) passed++; else { failed++; failures.push(msg); } }
check(help.includes("navigator.clipboard"), "helper should try the async Clipboard API");
check(help.includes("execCommand"), "helper should have the execCommand fallback");
check(/throw\s+new\s+Error/.test(help), "helper should throw when both paths fail");
check(/export\s+async\s+function\s+copyText/.test(help), "helper should export async copyText()");

// 2) no direct navigator.clipboard.writeText anywhere except the helper
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) {
      const rel = path.relative(ROOT, fp).replace(/\\/g, "/");
      if (rel === HELPER) continue;
      const src = fs.readFileSync(fp, "utf8");
      if (src.includes("navigator.clipboard.writeText")) {
        failed++; failures.push(`${rel}: uses navigator.clipboard.writeText directly — import { copyText } from "@/lib/client/copy-text" instead`);
      } else passed++;
    }
  }
}
for (const d of SCAN_DIRS) { const f = path.join(ROOT, d); if (fs.existsSync(f)) walk(f); }

if (failed === 0) {
  console.log(`  copyText helper present + ${passed - 4} component files clean`);
  console.log(`PASS — all Copy buttons route through copyText()`);
  console.log(`${passed} passed, 0 failed`);
  process.exit(0);
}
console.error("FAIL — clipboard helper guard:");
for (const m of failures) console.error(`  ${m}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(1);
