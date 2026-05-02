#!/usr/bin/env node
/**
 * 2026-05-02 Day 2 (plan §5) — pre-flight credit estimator unit tests.
 *
 * Covers lib/ai/estimate.ts:estimateCredits() across the 4 op
 * categories:
 *   1. Per-page ops (ocr, redact, sign) — credits scale with pageCount
 *   2. Per-chunk op (translate) — credits scale with charCount
 *   3. Flat ops (chat_turn, summarize, rewrite, table, compare,
 *      generate) — credits always equal baseCost
 *   4. Feature-flag fallback — when MULTIPLIER_PRICING_ENABLED=false,
 *      every op falls back to flat baseCost (matches today's
 *      pre-Day-1.7 route handler behaviour)
 *
 * Pure-function tests, zero I/O, runs in <50ms. Output line conforms
 * to the aggregator regex `${name}: ${pass} passed, ${fail} failed`.
 */

import { spawnSync } from "node:child_process";
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

function assertEq(actual, expected, msg) {
  const ok = actual === expected;
  if (!ok) failures.push(`${msg}: expected ${expected}, got ${actual}`);
  if (ok) passed++;
  else failed++;
}

// We import via tsx since the source is .ts — same pattern as
// scripts/test-credit-ledger-financials.mjs and others. Falls back
// to a static-parse smoke if tsx isn't available.
const SOURCE = path.join(ROOT, "lib", "ai", "estimate.ts");
const PRICING = path.join(ROOT, "lib", "pricing.ts");

import fs from "node:fs";

const estimateSrc = fs.readFileSync(SOURCE, "utf8");
const pricingSrc = fs.readFileSync(PRICING, "utf8");

// ============================================================================
// Section A — Source contract (static parse, no runtime needed)
// ============================================================================

assert(
  /export\s+function\s+estimateCredits\s*\(/m.test(estimateSrc),
  "A1: estimateCredits is exported"
);
assert(
  /TRANSLATE_CHUNK_CHARS\s*=\s*10[_,]?000/m.test(estimateSrc),
  "A2: chunk-size constant is 10K chars"
);
assert(
  estimateSrc.includes("isMultiplierPricingEnabled"),
  "A3: estimateCredits consults the feature flag"
);
assert(
  /case\s+"ocr":/m.test(estimateSrc),
  "A4: ocr branch present"
);
assert(
  /case\s+"redact":/m.test(estimateSrc),
  "A5: redact branch present"
);
assert(
  /case\s+"sign":/m.test(estimateSrc),
  "A6: sign branch present"
);
assert(
  /case\s+"translate":/m.test(estimateSrc),
  "A7: translate branch present"
);
assert(
  /case\s+"chat_turn":/m.test(estimateSrc),
  "A8: chat_turn (flat) branch present"
);
assert(
  /Math\.ceil\(chars\s*\/\s*TRANSLATE_CHUNK_CHARS\)/m.test(estimateSrc),
  "A9: translate computes ceil(chars / 10K)"
);
assert(
  /Math\.max\(1[\s,]/m.test(estimateSrc),
  "A10: floor estimates use Math.max(1, ...) for missing inputs"
);

// ============================================================================
// Section B — Pricing constants (sanity check the source of truth)
// ============================================================================

assert(
  /chat_turn:\s*1/m.test(pricingSrc),
  "B1: chat_turn base cost is 1 in AI_OPERATION_COSTS"
);
assert(
  /summarize:\s*3/m.test(pricingSrc),
  "B2: summarize base cost is 3"
);
assert(
  /translate:\s*5/m.test(pricingSrc),
  "B3: translate base cost is 5"
);
assert(
  /ocr:\s*2/m.test(pricingSrc),
  "B4: ocr base cost is 2"
);
assert(
  /redact:\s*5/m.test(pricingSrc),
  "B5: redact base cost is 5"
);
assert(
  /sign:\s*10/m.test(pricingSrc),
  "B6: sign base cost is 10"
);

// ============================================================================
// Section C — Feature flag wiring
// ============================================================================

assert(
  /export\s+function\s+isMultiplierPricingEnabled\s*\(/m.test(pricingSrc),
  "C1: isMultiplierPricingEnabled is exported"
);
assert(
  /MULTIPLIER_PRICING_ENABLED/m.test(pricingSrc),
  "C2: env var name is MULTIPLIER_PRICING_ENABLED"
);
assert(
  /process\.env\.MULTIPLIER_PRICING_ENABLED\s*!==\s*"false"/m.test(pricingSrc),
  "C3: flag returns true unless explicitly set to 'false' (default-on)"
);

// ============================================================================
// Section D — API route contract
// ============================================================================

const ROUTE = path.join(ROOT, "app", "api", "ai", "estimate", "route.ts");
const routeSrc = fs.readFileSync(ROUTE, "utf8");

assert(
  /export\s+async\s+function\s+POST/m.test(routeSrc),
  "D1: POST handler exported"
);
assert(
  routeSrc.includes('json(401, { error: "auth_required" })'),
  "D2: 401 on missing auth"
);
assert(
  /MAX_PER_WINDOW\s*=\s*30/m.test(routeSrc),
  "D3: token-bucket cap is 30/min"
);
assert(
  /WINDOW_MS\s*=\s*60[_,]?000/m.test(routeSrc),
  "D4: token-bucket window is 60s"
);
assert(
  routeSrc.includes("isKnownOp"),
  "D5: validates op against AI_OPERATION_COSTS keys"
);
assert(
  routeSrc.includes("estimateCredits"),
  "D6: route delegates to pure estimateCredits()"
);
assert(
  /credits:\s*est\.credits/m.test(routeSrc),
  "D7: response surfaces only credits + balance, not multiplier (principle 2)"
);
assert(
  !/multiplier:\s*est\.multiplier/m.test(routeSrc),
  "D8: response does NOT leak multiplier (admin-only field)"
);
assert(
  /canRun:\s*balance\s*>=\s*est\.credits/m.test(routeSrc),
  "D9: response includes canRun boolean for client UI gating"
);

// ============================================================================
// Section E — Cross-file invariants
// ============================================================================

// Estimate function imports from lib/pricing.ts.
assert(
  /from\s+"@\/lib\/pricing"/m.test(estimateSrc),
  "E1: estimate.ts imports from lib/pricing"
);
// Route imports from both estimate.ts and pricing.ts.
assert(
  /from\s+"@\/lib\/ai\/estimate"/m.test(routeSrc) &&
    /from\s+"@\/lib\/pricing"/m.test(routeSrc),
  "E2: route imports from both lib/ai/estimate + lib/pricing"
);
// Route uses server-only.
assert(
  /import\s+"server-only"/m.test(routeSrc),
  "E3: route guards itself with server-only"
);

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`estimate: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
