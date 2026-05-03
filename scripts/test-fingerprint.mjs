#!/usr/bin/env node
/**
 * 2026-05-03 Day 5.5 layer 5 (plan §8) — device fingerprint contract.
 *
 * Static-parse guard for:
 *   1. lib/auth/fingerprint.ts — computeFingerprint() client helper
 *   2. components/auth/RegisterForm.tsx — useEffect + hidden field
 *   3. lib/auth-actions.ts — deviceFingerprint extracted + persisted
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

const HELPER = path.join(ROOT, "lib", "auth", "fingerprint.ts");
const helperSrc = fs.readFileSync(HELPER, "utf8");

const FORM = path.join(ROOT, "components", "auth", "RegisterForm.tsx");
const formSrc = fs.readFileSync(FORM, "utf8");

const ACTIONS = path.join(ROOT, "lib", "auth-actions.ts");
const actionsSrc = fs.readFileSync(ACTIONS, "utf8");

// ============================================================================
// Section A — Helper surface
// ============================================================================

assert(
  /export\s+async\s+function\s+computeFingerprint/m.test(helperSrc),
  "A1: computeFingerprint exported (async)"
);
assert(
  helperSrc.startsWith('"use client"'),
  "A2: marked as client component"
);
assert(
  /typeof\s+window\s*===\s*"undefined"/.test(helperSrc),
  "A3: SSR-safe — returns '' when window is undefined"
);

// ============================================================================
// Section B — Signal collection
// ============================================================================

assert(/navigator\.userAgent/.test(helperSrc), "B1: collects userAgent");
assert(/navigator\.language/.test(helperSrc), "B2: collects language");
assert(/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/.test(helperSrc), "B3: collects timezone");
assert(/screen\.width/.test(helperSrc), "B4: collects screen size");
assert(/screen\.colorDepth/.test(helperSrc), "B5: collects color depth");
assert(/devicePixelRatio/.test(helperSrc), "B6: collects DPR");
assert(/hardwareConcurrency/.test(helperSrc), "B7: collects CPU concurrency");

// ============================================================================
// Section C — Canvas + WebGL fingerprinting
// ============================================================================

assert(
  /canvas\.toDataURL\(\)/.test(helperSrc),
  "C1: canvas fingerprint via toDataURL"
);
assert(
  /WEBGL_debug_renderer_info/.test(helperSrc),
  "C2: WebGL debug renderer info extension"
);
assert(
  /UNMASKED_VENDOR_WEBGL/.test(helperSrc),
  "C3: WebGL unmasked vendor"
);
assert(
  /UNMASKED_RENDERER_WEBGL/.test(helperSrc),
  "C4: WebGL unmasked renderer"
);

// ============================================================================
// Section D — Hash output
// ============================================================================

assert(
  /crypto\.subtle\.digest\("SHA-256"/.test(helperSrc),
  "D1: SHA-256 via Web Crypto API"
);
assert(
  /\.padStart\(2,\s*"0"\)/.test(helperSrc),
  "D2: hex output zero-padded per byte"
);
assert(
  /padEnd\([\s\S]*?64[\s\S]*?"0"[\s\S]*?\)/.test(helperSrc),
  "D3: fallback path returns 64 chars (matches column width)"
);

// ============================================================================
// Section E — Client wire-in
// ============================================================================

assert(
  formSrc.includes("computeFingerprint"),
  "E1: RegisterForm imports computeFingerprint"
);
assert(
  /useRef<HTMLInputElement>/.test(formSrc),
  "E2: ref for hidden fingerprint input"
);
assert(
  /useEffect\(\(\)\s*=>\s*\{[\s\S]*computeFingerprint\(\)/.test(formSrc),
  "E3: useEffect calls computeFingerprint on mount"
);
assert(
  /name="deviceFingerprint"/.test(formSrc),
  "E4: hidden form field named deviceFingerprint"
);
assert(
  /ref=\{fingerprintRef\}/.test(formSrc),
  "E5: hidden input wired to ref"
);

// ============================================================================
// Section F — Server wire-in
// ============================================================================

assert(
  actionsSrc.includes('formData.get("deviceFingerprint")'),
  "F1: registerAction extracts deviceFingerprint from formData"
);
assert(
  /\.slice\(0,\s*64\)/.test(actionsSrc),
  "F2: server caps fingerprint at 64 chars (column width)"
);
assert(
  /deviceFingerprint:\s*deviceFingerprint\s*\|\|\s*null/.test(actionsSrc),
  "F3: empty string → null in users insert"
);

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`fingerprint: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
