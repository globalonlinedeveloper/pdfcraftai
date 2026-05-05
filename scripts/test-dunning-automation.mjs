#!/usr/bin/env node
/**
 * 2026-05-04 — dunning webhook automation guard (PENDING §4c).
 *
 * Follow-up to commit `76a0c82` (dunning persistence foundation).
 * The foundation shipped the schema + persist helpers + admin
 * viewer; this commit wires the webhook side of the loop:
 * `lib/payments/ledger.ts:handleSubscription` now calls
 * `persistDunningEvent` alongside the existing
 * `subscriptions.status` update, mapping the normalized
 * subscription state literal to a DunningEvent shape.
 *
 * Today the dispatch is dormant because no recurring SKUs exist
 * — `subscription_event` kind never reaches `applyPaymentEvent`.
 * When recurring SKUs ship in Phase E, the dispatch activates
 * without further code changes.
 *
 * This guard locks in:
 *   A. Imports — persistDunningEvent + DunningEvent type from
 *      lib/payments/dunning.
 *   B. Mapping helper — `mapSubscriptionStateToDunning` exists,
 *      handles all 5 normalized states (activated/renewed/cancelled/
 *      paused/failed), and returns null only for "paused".
 *   C. State-to-DunningEvent kind mapping correctness:
 *        activated → payment_succeeded
 *        renewed   → payment_succeeded
 *        failed    → payment_failed
 *        cancelled → subscription_cancelled
 *        paused    → null
 *   D. Call site invariants — handleSubscription invokes the
 *      mapper + persist helper AFTER the subscriptions.status
 *      update (status is canonical truth; dunning is observation
 *      log) AND wraps the persist call in try/catch (failure must
 *      NOT abort the status update).
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

const LEDGER_PATH = path.join(ROOT, "lib", "payments", "ledger.ts");
const LEDGER_SRC = fs.existsSync(LEDGER_PATH)
  ? fs.readFileSync(LEDGER_PATH, "utf8")
  : "";

assert(LEDGER_SRC.length > 0, "A0: lib/payments/ledger.ts file exists");

// ============================================================================
// SECTION A: Imports
// ============================================================================

assert(
  /import\s+\{\s*persistDunningEvent\s*\}\s+from\s+"\.\/dunning"/.test(
    LEDGER_SRC,
  ),
  "A1: imports persistDunningEvent from ./dunning",
);
assert(
  /import\s+type\s+\{\s*DunningEvent\s*\}\s+from\s+"\.\/dunning"/.test(
    LEDGER_SRC,
  ),
  "A2: imports type DunningEvent from ./dunning",
);

// ============================================================================
// SECTION B: Mapper helper exists + signature matches contract
// ============================================================================

assert(
  /function\s+mapSubscriptionStateToDunning\(/.test(LEDGER_SRC),
  "B1: mapSubscriptionStateToDunning function defined",
);

// Extract the function body for shape checks.
const MAPPER_MATCH = LEDGER_SRC.match(
  /function\s+mapSubscriptionStateToDunning\([\s\S]*?\n\}/,
);
const MAPPER_BODY = MAPPER_MATCH ? MAPPER_MATCH[0] : "";
assert(MAPPER_BODY.length > 0, "B2: mapper body extracted");

// Return type union — DunningEvent | null. Either form (` | null` or
// `null |`) is acceptable.
assert(
  /:\s*DunningEvent\s*\|\s*null/.test(MAPPER_BODY) ||
    /:\s*null\s*\|\s*DunningEvent/.test(MAPPER_BODY),
  "B3: mapper return type is DunningEvent | null",
);

// All 5 states are present in the switch.
const STATES = ["activated", "renewed", "cancelled", "paused", "failed"];
for (const state of STATES) {
  assert(
    new RegExp(`case\\s+"${state}"`).test(MAPPER_BODY),
    `B4.${state}: switch case for "${state}" present`,
  );
}

// ============================================================================
// SECTION C: State-to-kind mapping correctness
// ============================================================================

// activated + renewed both fall through to payment_succeeded — this
// is intentional (any successful charge clears dunning posture). The
// shared block must mention payment_succeeded somewhere between the
// `case "activated":` line and a return statement.
const ACTIVATED_BLOCK = MAPPER_BODY.match(
  /case\s+"activated":[\s\S]*?return[\s\S]*?\}/,
);
assert(
  ACTIVATED_BLOCK && /payment_succeeded/.test(ACTIVATED_BLOCK[0]),
  "C1: activated → payment_succeeded (DunningEvent kind)",
);
const RENEWED_REACH = MAPPER_BODY.match(
  /case\s+"renewed":[\s\S]*?return[\s\S]*?\}/,
);
assert(
  RENEWED_REACH && /payment_succeeded/.test(RENEWED_REACH[0]),
  "C2: renewed → payment_succeeded (DunningEvent kind, fall-through with activated)",
);

// failed → payment_failed
const FAILED_BLOCK = MAPPER_BODY.match(/case\s+"failed":[\s\S]*?return[\s\S]*?\}/);
assert(
  FAILED_BLOCK && /payment_failed/.test(FAILED_BLOCK[0]),
  "C3: failed → payment_failed (DunningEvent kind)",
);
// failed event must include failedAttempts (counter) — otherwise the
// reducer can't tell single vs. recurring failures apart.
assert(
  FAILED_BLOCK && /failedAttempts:/.test(FAILED_BLOCK[0]),
  "C4: failed event includes failedAttempts field",
);

// cancelled → subscription_cancelled
const CANCELLED_BLOCK = MAPPER_BODY.match(
  /case\s+"cancelled":[\s\S]*?return[\s\S]*?\}/,
);
assert(
  CANCELLED_BLOCK && /subscription_cancelled/.test(CANCELLED_BLOCK[0]),
  "C5: cancelled → subscription_cancelled (DunningEvent kind)",
);
// cancelled event must include reason (free-form cause).
assert(
  CANCELLED_BLOCK && /reason:/.test(CANCELLED_BLOCK[0]),
  "C6: cancelled event includes reason field",
);

// paused → null
const PAUSED_BLOCK = MAPPER_BODY.match(/case\s+"paused":[\s\S]*?return[\s\S]*?(?=case|\})/);
assert(
  PAUSED_BLOCK && /return\s+null/.test(PAUSED_BLOCK[0]),
  "C7: paused → null (no dunning event for user-initiated pauses)",
);

// Idempotency-replay invariant: every event MUST carry providerEventId
// + occurredAtMs (the reducer's replay guard reads providerEventId;
// the persist helper's stateSinceMs math reads occurredAtMs).
for (const blockMatch of [ACTIVATED_BLOCK, FAILED_BLOCK, CANCELLED_BLOCK]) {
  if (!blockMatch) continue;
  const block = blockMatch[0];
  assert(
    /providerEventId/.test(block),
    `C8.${block.slice(5, 25).trim()}: event includes providerEventId (reducer replay guard input)`,
  );
  assert(
    /occurredAtMs/.test(block),
    `C9.${block.slice(5, 25).trim()}: event includes occurredAtMs (reducer state-since input)`,
  );
}

// ============================================================================
// SECTION D: handleSubscription call site
// ============================================================================

const HANDLER_MATCH = LEDGER_SRC.match(
  /async\s+function\s+handleSubscription\([\s\S]*?(?=\nasync\s+function|\nfunction\s+\w|\n\/\/\s+---)/,
);
const HANDLER_BODY = HANDLER_MATCH ? HANDLER_MATCH[0] : "";
assert(HANDLER_BODY.length > 0, "D1: handleSubscription body extracted");

// Status update must happen BEFORE persistDunningEvent — status is
// canonical truth.
const statusUpdateIdx = HANDLER_BODY.indexOf(".update(schema.subscriptions)");
const persistIdx = HANDLER_BODY.indexOf("persistDunningEvent");
assert(
  statusUpdateIdx >= 0 && persistIdx >= 0 && statusUpdateIdx < persistIdx,
  "D2: subscriptions.status update precedes persistDunningEvent (status = canonical truth, dunning = observation log)",
);

// persistDunningEvent call MUST be wrapped in try/catch — dunning
// persistence failure must NOT abort subscription status update.
assert(
  /try\s*\{[\s\S]*?persistDunningEvent[\s\S]*?\}\s*catch/.test(HANDLER_BODY),
  "D3: persistDunningEvent call wrapped in try/catch (dunning failure must not abort status update)",
);

// The catch block must console.warn (not console.error / not throw).
// warn is the right severity because the failure is recoverable —
// the reconcile sweep can re-derive dunning posture from the
// providerEventId log if needed.
const PERSIST_CATCH = HANDLER_BODY.match(
  /persistDunningEvent[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?\}/,
);
assert(
  PERSIST_CATCH && /console\.warn/.test(PERSIST_CATCH[0]),
  "D4: persistDunningEvent catch logs via console.warn (not error / not re-throw)",
);
assert(
  PERSIST_CATCH && !/\bthrow\b/.test(PERSIST_CATCH[0]),
  "D5: persistDunningEvent catch does NOT re-throw (preserves status-update commit)",
);

// The mapper is invoked with the right arguments: (state,
// providerEventId, occurredAtMs). Anchor on the call signature.
assert(
  /mapSubscriptionStateToDunning\(\s*event\.state\s*,/.test(HANDLER_BODY),
  "D6: mapper invoked with event.state as first arg",
);
assert(
  /mapSubscriptionStateToDunning\([\s\S]{0,200}event\.providerRef/.test(
    HANDLER_BODY,
  ),
  "D7: mapper invoked with event.providerRef as providerEventId arg",
);
assert(
  /mapSubscriptionStateToDunning\([\s\S]{0,300}event\.occurredAt\.getTime\(\)/.test(
    HANDLER_BODY,
  ),
  "D8: mapper invoked with event.occurredAt.getTime() as occurredAtMs arg",
);

// Persist call MUST receive payment.subscriptionId as the first arg
// (not event.internalPaymentId — those are different concepts; the
// dunning row is keyed on the SUBSCRIPTION id, not the payment row id).
assert(
  /persistDunningEvent\(\s*payment\.subscriptionId\s*,/.test(HANDLER_BODY),
  "D9: persistDunningEvent called with payment.subscriptionId (not event.internalPaymentId)",
);

// ============================================================================
// SECTION E: Foundation contract still preserved
// ============================================================================

// The dunning module's exported surface this commit depends on must
// still exist. If a future refactor renames or removes any of these,
// the dispatch breaks at compile time but the call site here would
// also need to update.
const DUNNING_PATH = path.join(ROOT, "lib", "payments", "dunning.ts");
const DUNNING_SRC = fs.existsSync(DUNNING_PATH)
  ? fs.readFileSync(DUNNING_PATH, "utf8")
  : "";
assert(
  /export\s+async\s+function\s+persistDunningEvent\(/.test(DUNNING_SRC),
  "E1: lib/payments/dunning.ts still exports persistDunningEvent",
);
assert(
  /export\s+type\s+DunningEvent/.test(DUNNING_SRC),
  "E2: lib/payments/dunning.ts still exports DunningEvent type",
);
// All 3 DunningEvent kinds the mapper produces must exist in the union.
for (const kind of [
  "payment_succeeded",
  "payment_failed",
  "subscription_cancelled",
]) {
  assert(
    new RegExp(`kind:\\s*"${kind}"`).test(DUNNING_SRC),
    `E3.${kind}: DunningEvent union has kind "${kind}"`,
  );
}

// ============================================================================
// Output
// ============================================================================

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`dunning-automation: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
