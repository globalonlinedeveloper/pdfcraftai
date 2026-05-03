#!/usr/bin/env node
/**
 * 2026-05-03 plan §8 layer 6 / Gap #2 Option A — per-op signup-bonus cap.
 *
 * Static-parse contract guards for lib/payments/per-op-bonus-cap.ts +
 * its wire-in at lib/ai/credits.ts:spendCredits(). Confirms:
 *
 *   A. Helper module surface
 *      - feature flag BONUS_PER_OP_CAP_ENABLED present
 *      - flag is OFF by default (default constant DEFAULT_CAP=2)
 *      - both helpers exported
 *      - paid-probe filters reason LIKE "purchase%" / "subscription%"
 *      - manual_grant is NOT treated as paid (admin goodwill grants
 *        shouldn't lift the cap)
 *      - usage tally aggregates across all ai_usage rows for (userId, op)
 *      - returns { capped: true, cap, spent, remaining } with remaining
 *        clamped to >= 0
 *
 *   B. spendCredits wire-in
 *      - SpendCreditsResult union extended with capExceeded? flag
 *      - checkPerOpBonusCap called BEFORE the balance check (so the
 *        cap fires on free-trial users who still have pool credits)
 *      - cap-exceeded path returns { reason: "insufficient",
 *        capExceeded: true, balance: remaining, required: cost }
 *      - the cap path uses the SAME `reason: "insufficient"` so route
 *        handlers don't need to change (forward-compatible —
 *        per-route bespoke copy can check capExceeded later)
 *
 *   C. Forward-compat invariants
 *      - module is server-only (won't accidentally land in client bundle)
 *      - capExceeded is OPTIONAL on the union (not required) so existing
 *        consumers continue to type-check
 *      - feature is default OFF (BONUS_PER_OP_CAP_ENABLED!=="true")
 *
 * Output line conforms to aggregator regex `${name}: ${pass} passed,
 * ${fail} failed`.
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

const HELPER_PATH = path.join(
  ROOT,
  "lib",
  "payments",
  "per-op-bonus-cap.ts",
);
const CREDITS_PATH = path.join(ROOT, "lib", "ai", "credits.ts");

assert(fs.existsSync(HELPER_PATH), "A0: helper module exists");
assert(fs.existsSync(CREDITS_PATH), "B0: lib/ai/credits.ts exists");

const helperSrc = fs.readFileSync(HELPER_PATH, "utf8");
const creditsSrc = fs.readFileSync(CREDITS_PATH, "utf8");

// ============================================================================
// Section A — helper module surface
// ============================================================================

assert(
  /import\s+["']server-only["']/.test(helperSrc),
  "A1: server-only import (prevents accidental client bundle)",
);
assert(
  /BONUS_PER_OP_CAP_ENABLED/.test(helperSrc),
  "A2: feature flag BONUS_PER_OP_CAP_ENABLED present",
);
assert(
  /process\.env\.BONUS_PER_OP_CAP_ENABLED\s*===\s*["']true["']/.test(helperSrc),
  "A3: feature flag is OFF by default (only enabled when env === 'true')",
);
assert(
  /BONUS_PER_OP_CAP\b/.test(helperSrc),
  "A4: cap value env var BONUS_PER_OP_CAP present (overridable)",
);
assert(
  /DEFAULT_CAP\s*=\s*2\b/.test(helperSrc),
  "A5: default cap is 2 (Option A recommendation)",
);
assert(
  /export\s+function\s+isPerOpBonusCapEnabled/.test(helperSrc),
  "A6: isPerOpBonusCapEnabled() exported",
);
assert(
  /export\s+function\s+bonusPerOpCap/.test(helperSrc),
  "A7: bonusPerOpCap() exported",
);
assert(
  /export\s+async\s+function\s+checkPerOpBonusCap/.test(helperSrc),
  "A8: checkPerOpBonusCap() exported",
);
// Paid-probe semantics: reason LIKE "purchase%" OR "subscription%".
// manual_grant must NOT trigger the paid-exempt path.
assert(
  /like\(\s*schema\.creditLedger\.reason,\s*["']purchase%["']\s*\)/.test(
    helperSrc,
  ) ||
    /reason,\s*["']purchase%["']/.test(helperSrc),
  "A9a: paid-probe matches reason LIKE 'purchase%'",
);
assert(
  /like\(\s*schema\.creditLedger\.reason,\s*["']subscription%["']\s*\)/.test(
    helperSrc,
  ) ||
    /reason,\s*["']subscription%["']/.test(helperSrc),
  "A9b: paid-probe matches reason LIKE 'subscription%'",
);
assert(
  !/reason,\s*["']manual_grant["']/.test(helperSrc),
  "A10: manual_grant is NOT treated as paid (admin goodwill grants don't lift the cap — preserves the cap's defense semantic)",
);
// Usage tally — aggregates across all ai_usage rows for (userId, op).
assert(
  /eq\(\s*schema\.aiUsage\.userId/.test(helperSrc) &&
    /eq\(\s*schema\.aiUsage\.operation/.test(helperSrc),
  "A11: usage tally filters by (userId, operation)",
);
assert(
  /Math\.max\(0,\s*cap\s*-\s*spent\)/.test(helperSrc),
  "A12: remaining is clamped to >= 0 (never negative)",
);
// Result type shape.
assert(
  /capped:\s*true;\s*cap:\s*number;\s*spent:\s*number;\s*remaining:\s*number/.test(
    helperSrc,
  ),
  "A13: PerOpBonusCapResult union has { capped: true, cap, spent, remaining }",
);
assert(
  /exemptReason:\s*["']feature_disabled["']\s*\|\s*["']user_has_paid["']/.test(
    helperSrc,
  ),
  "A14: exempt reason discriminator covers feature_disabled + user_has_paid",
);

// ============================================================================
// Section B — spendCredits wire-in at lib/ai/credits.ts
// ============================================================================

assert(
  /import\s*\{\s*checkPerOpBonusCap\s*\}\s*from\s*["']@\/lib\/payments\/per-op-bonus-cap["']/.test(
    creditsSrc,
  ),
  "B1: lib/ai/credits.ts imports checkPerOpBonusCap from canonical path",
);
// SpendCreditsResult union extended with optional capExceeded flag.
assert(
  /capExceeded\?\:\s*true/.test(creditsSrc),
  "B2: SpendCreditsResult adds optional capExceeded?: true on the insufficient variant",
);
// The cap check is called inside spendCredits.
assert(
  /await\s+checkPerOpBonusCap\(\s*input\.userId,\s*input\.operation\s*\)/.test(
    creditsSrc,
  ),
  "B3: spendCredits awaits checkPerOpBonusCap(userId, operation)",
);
// The cap-exceeded branch returns { reason: "insufficient", capExceeded: true }.
assert(
  /capCheck\.capped\s*&&\s*capCheck\.remaining\s*<\s*cost/.test(creditsSrc),
  "B4: cap-exceeded gate compares remaining < cost",
);
assert(
  /reason:\s*["']insufficient["'][\s\S]{0,400}capExceeded:\s*true/.test(
    creditsSrc,
  ),
  "B5: cap-exceeded path returns { reason: 'insufficient', capExceeded: true } so route handlers see the same 402 path without changes",
);
// Critical placement invariant: cap check runs BEFORE the balance probe.
// If we ran the balance probe first, free-trial users with pool credits
// would always pass (balance > 0) and the cap would never fire.
const capCheckIdx = creditsSrc.search(
  /const\s+capCheck\s*=\s*await\s+checkPerOpBonusCap/,
);
const balanceProbeIdx = creditsSrc.search(
  /const\s+\[row\]\s*=\s*await\s+db\s*\.select\(\s*\{\s*balance/,
);
assert(
  capCheckIdx > 0 && balanceProbeIdx > 0 && capCheckIdx < balanceProbeIdx,
  "B6: cap check runs BEFORE the balance probe (placement invariant — otherwise free-trial pool credits would always satisfy the balance check and the cap would never fire)",
);

// ============================================================================
// Section C — forward-compat invariants
// ============================================================================

assert(
  /capExceeded\?:/.test(creditsSrc),
  "C1: capExceeded is OPTIONAL on the union (not required) — existing consumers continue to type-check without code changes",
);
// Feature is default OFF — verify the helper's enable check.
assert(
  /BONUS_PER_OP_CAP_ENABLED\s*===\s*["']true["']/.test(helperSrc) &&
    !/BONUS_PER_OP_CAP_ENABLED\s*!==\s*["']false["']/.test(helperSrc),
  "C2: feature is default OFF (env must be exactly 'true' to enable; absence/typos behave as disabled)",
);
// Helper accepts AIOperationId (typed) — prevents accidental string mismatch.
assert(
  /operation:\s*AIOperationId/.test(helperSrc),
  "C3: helper signature uses typed AIOperationId (catches typos at build time)",
);

// ============================================================================
// Output
// ============================================================================

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`per-op-bonus-cap: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
