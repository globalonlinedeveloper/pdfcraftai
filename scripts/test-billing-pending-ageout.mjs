#!/usr/bin/env node
// scripts/test-billing-pending-ageout.mjs
//
// Pins the /app/billing pending-age-out UX — Razorpay doesn't fire
// webhooks for orders that never had a payment attempt (user opened
// the modal and walked away, OR never opened it at all), so the DB
// row stays status="pending" forever. Production audit (2026-04-24)
// found 12 pending rows, 10 older than 24h, ZERO with any
// webhook_events attached — pure abandoned carts that Razorpay
// already expired (~15 min TTL) on their side and never told us about.
//
// Showing "Pending" in /app/billing for such rows is misleading
// ("my cart from 2 days ago is still processing?") and can push
// users to re-attempt → duplicate orders. Fix: local age-out in the
// billing page. Rows > STALE_PENDING_THRESHOLD_MIN render as
// "Expired" with muted styling; DB row stays pending until the
// reconciliation cron (Task #24) resolves true order state via
// Razorpay's /orders/{id} API.
//
// This is a presentational invariant, so we static-analyse the
// billing page source for the structural pieces that make the UX
// work. Full integration coverage of the reconcile cron lands with
// Task #24 in a separate suite (test-reconcile-orders.mjs, TBD).
//
// Run: `node scripts/test-billing-pending-ageout.mjs`
// Exits 0 on pass, 1 on any failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const BILLING_PATH = resolve(ROOT, "app", "app", "billing", "page.tsx");
const BILLING_SRC = readFileSync(BILLING_PATH, "utf8");

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    failures.push({ label, detail: detail ?? "" });
  }
}

// =============================================================================
// SECTION A — the age-out helper exists and is wired up correctly
// =============================================================================

assert(
  "A1 STALE_PENDING_THRESHOLD_MIN constant defined and > 15",
  /const\s+STALE_PENDING_THRESHOLD_MIN\s*=\s*(\d+)/.test(BILLING_SRC) &&
    (() => {
      const m = BILLING_SRC.match(
        /const\s+STALE_PENDING_THRESHOLD_MIN\s*=\s*(\d+)/
      );
      return m && Number(m[1]) >= 15 && Number(m[1]) <= 120;
    })(),
  "Threshold must be at least 15 minutes (Razorpay's order TTL floor) and at most 2 hours (beyond this, UPI/netbanking flows are always done). The default ships as 30 minutes — safely past UPI 2FA hangs while still surfacing abandoned carts the same day."
);

assert(
  "A2 effectivePaymentStatus helper defined with (status, createdAt, nowMs) signature",
  /function\s+effectivePaymentStatus\s*\(\s*status\s*:\s*string\s*,\s*createdAt\s*:\s*Date\s*,\s*nowMs\s*:\s*number\s*\)\s*:\s*string/.test(
    BILLING_SRC
  ),
  "The helper takes the raw DB status, the row's createdAt (so we compare ages, not clock skew), and nowMs (so every row in one render uses the same reference — otherwise a slow render flips one row mid-loop from pending to expired)."
);

assert(
  "A3 effectivePaymentStatus returns non-pending statuses unchanged (early return)",
  /if\s*\(\s*status\s*!==\s*"pending"\s*\)\s*return\s*status\s*;/.test(
    BILLING_SRC
  ),
  "Only pending rows are subject to age-out — captured/failed/refunded/partial_refund/cancelled rows already have a terminal state from a webhook and must pass through untouched."
);

assert(
  "A4 effectivePaymentStatus returns \"expired\" for stale pending",
  /ageMin\s*>\s*STALE_PENDING_THRESHOLD_MIN\s*\?\s*"expired"\s*:\s*"pending"/.test(
    BILLING_SRC
  ),
  "The age-out branch must return the literal \"expired\" so the STATUS_LABEL/STATUS_COLOR maps can resolve it to \"Expired\" + muted color. Any other return value (e.g. \"stale\", \"timed_out\") would fall through the label map and render the raw string — ugly and inconsistent."
);

// =============================================================================
// SECTION B — STATUS_LABEL + STATUS_COLOR maps carry the "expired" entry
// =============================================================================

assert(
  "B1 STATUS_LABEL has expired → \"Expired\"",
  /STATUS_LABEL[\s\S]{0,400}?expired\s*:\s*"Expired"/.test(BILLING_SRC),
  "Without this entry the label lookup falls through to `?? effStatus`, which would render the lowercase string \"expired\" as-is — functional but inconsistent with the other title-cased labels (Pending, Paid, Failed, Refunded)."
);

assert(
  "B2 STATUS_COLOR has expired → var(--fg-subtle) (muted)",
  /STATUS_COLOR[\s\S]{0,400}?expired\s*:\s*"var\(--fg-subtle\)"/.test(
    BILLING_SRC
  ),
  "Expired rows must render muted (same treatment as refunded/cancelled — terminal states the user can't act on). Using var(--accent) or #c00 would draw the eye incorrectly: expired carts aren't errors to retry, they're closed accounting entries."
);

// =============================================================================
// SECTION C — render site uses effStatus (not p.status) for label + color
// =============================================================================

assert(
  "C1 render site computes const effStatus = effectivePaymentStatus(p.status, p.createdAt, nowMs)",
  /const\s+effStatus\s*=\s*effectivePaymentStatus\(\s*p\.status\s*,\s*p\.createdAt\s*,\s*nowMs\s*\)/.test(
    BILLING_SRC
  ),
  "The call site must pass `p.status`, `p.createdAt`, and `nowMs` in that order. A wrong order (e.g. new Date() in place of nowMs) would recompute per row and re-introduce the mid-loop jitter described in A2."
);

assert(
  "C2 STATUS_COLOR lookup uses effStatus",
  /STATUS_COLOR\[effStatus\]/.test(BILLING_SRC),
  "A regression here would silently make the color row still render as pending muted grey — visually identical to expired, so no visible difference. The label assertion C3 catches the visible half; this one pins the color alignment."
);

assert(
  "C3 STATUS_LABEL lookup uses effStatus",
  /STATUS_LABEL\[effStatus\]\s*\?\?\s*effStatus/.test(BILLING_SRC),
  "THE user-visible half of the fix. If a refactor changes this back to STATUS_LABEL[p.status], stale pending rows silently revert to showing \"Pending\" — the original bug."
);

// =============================================================================
// SECTION D — nowMs hoisted once per render (avoid mid-loop drift)
// =============================================================================

assert(
  "D1 nowMs captured via Date.now() once, outside payments.map()",
  (() => {
    // Find the payments.map callback scope and confirm Date.now() is
    // called OUTSIDE it (i.e. within the IIFE wrapper around map).
    const mapIdx = BILLING_SRC.indexOf("payments.map(");
    if (mapIdx < 0) return false;
    // Search backward from map( for the nearest Date.now() — must be
    // before the map call-site AND after the outer wrapping block.
    const before = BILLING_SRC.slice(0, mapIdx);
    const lastDateNow = before.lastIndexOf("Date.now()");
    const lastIIFE = before.lastIndexOf("(() =>");
    return lastDateNow > 0 && lastIIFE > 0 && lastDateNow > lastIIFE;
  })(),
  "nowMs MUST be captured ONCE before the map iteration. Computing it inside the callback per row would cause a slow render to flip one row mid-pass from pending (still in-flight when callback fired) to expired (aged out two rows later). Deterministic-render invariant."
);

// =============================================================================
// SECTION E — quoteRefund still uses raw p.status (not effStatus)
// =============================================================================

assert(
  "E1 quoteRefund receives the raw p.status, not effStatus",
  /quoteRefund\s*\(\s*\{\s*status\s*:\s*p\.status/.test(BILLING_SRC),
  "Refund eligibility is a trust decision — it must match the DB authority, not a presentational re-label. Passing effStatus would cause a stale pending row rendered as \"Expired\" to fall through the refund eligibility check, which is correct by coincidence (only captured rows refund), but the wrong mental model. Downstream the quoteRefund function explicitly gates on status === \"captured\" so the literal value must be what the DB has."
);

// =============================================================================
// Report
// =============================================================================

const total = pass + fail;
console.log("");
if (fail > 0) {
  console.log("FAILURES:");
  for (const f of failures) {
    console.log(`  ✗ ${f.label}`);
    if (f.detail) console.log(`      ${f.detail}`);
  }
  console.log("");
}
// Final line MUST match `N passed, M failed` — scripts/run-all-tests.mjs
// parses this tail.
console.log(
  `test-billing-pending-ageout: ${pass} passed, ${fail} failed (of ${total})`
);
process.exit(fail > 0 ? 1 : 0);
