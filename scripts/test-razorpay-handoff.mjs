#!/usr/bin/env node
// scripts/test-razorpay-handoff.mjs
//
// Pins the contract between the Razorpay adapter and the client-side
// CheckoutButton modal launch. Why this exists:
//
// On 2026-04-22 a paying user hit "Buy pack" and Razorpay's hosted
// modal threw "Payment Failed because of a configuration error.
// Authentication key was missing during initialization." The order
// was created server-side (Razorpay's POST /orders returned a fresh
// order id), so the API credentials were correct — the breakage was
// a property-name drift between the adapter and the client:
//
//   adapter:  publicConfig: { keyId: this.config.keyId, ... }
//   client:   new Razorpay({ key: session.publicConfig.key, ... })
//
// `publicConfig` is typed as `Record<string, string>` (the union shape
// has to absorb Paddle's `clientToken/environment/sellerId` too), so
// TypeScript can't see this kind of drift. These regex pins make the
// contract explicit:
//
//   1. Adapter writes `key:` (not `keyId:`)        — what Razorpay's SDK reads
//   2. CheckoutButton reads `.key` (not `.keyId`)  — same name, both sides
//   3. Adapter sources the value from `this.config.keyId` — the env-fed
//      RAZORPAY_KEY_ID still drives it; we only renamed the wire field.
//
// If anyone re-introduces the keyId/key drift, this file fails before
// it can ship to a paying customer again.
//
// Run: `node scripts/test-razorpay-handoff.mjs`
// Exits 0 on pass, 1 on any failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const ADAPTER_PATH = resolve(ROOT, "lib", "payments", "adapters", "razorpay.ts");
const BUTTON_PATH = resolve(ROOT, "components", "billing", "CheckoutButton.tsx");

const ADAPTER_SRC = readFileSync(ADAPTER_PATH, "utf8");
const BUTTON_SRC = readFileSync(BUTTON_PATH, "utf8");

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push({ label, detail });
    console.log(`  ✗ ${label}`);
    if (detail) console.log(`      ${detail}`);
  }
}

// =============================================================================
// SECTION A — adapter publicConfig field names
// =============================================================================

assert(
  "A1 razorpay adapter writes `key:` in publicConfig (not keyId)",
  /publicConfig\s*:\s*\{[\s\S]{0,400}?\bkey\s*:\s*this\.config\.keyId/.test(
    ADAPTER_SRC
  ),
  "createOrder must populate publicConfig.key from this.config.keyId — Razorpay's checkout.js SDK reads `new Razorpay({ key })`. Shipping `keyId:` here causes the SDK to throw 'Authentication key was missing during initialization' on the browser."
);

assert(
  "A2 razorpay adapter does NOT write the legacy `keyId:` field",
  !/publicConfig\s*:\s*\{[\s\S]{0,400}?\bkeyId\s*:/.test(ADAPTER_SRC),
  "publicConfig.keyId was the original (broken) shape — the client reads `.key`, so leaving keyId here either creates a dead field or signals a regression. Remove it."
);

assert(
  "A3 razorpay adapter still sources value from process.env.RAZORPAY_KEY_ID via this.config.keyId",
  /this\.config\.keyId/.test(ADAPTER_SRC) &&
    /keyId\s*:\s*process\.env\.RAZORPAY_KEY_ID/.test(
      readFileSync(resolve(ROOT, "lib", "payments", "registry.ts"), "utf8")
    ),
  "The wire-field rename (keyId→key) must NOT change where the value comes from — registry.ts wires keyId from process.env.RAZORPAY_KEY_ID and the adapter still reads this.config.keyId internally."
);

// =============================================================================
// SECTION B — client modal launch reads matching field names
// =============================================================================

assert(
  "B1 CheckoutButton reads session.publicConfig.key for the Razorpay constructor",
  /new\s+window\.Razorpay\s*\(\s*\{[\s\S]{0,200}?key\s*:\s*session\.publicConfig\.key/.test(
    BUTTON_SRC
  ),
  "Modal launch must feed publicConfig.key into `new Razorpay({ key })`. If anyone renames it back to `.keyId`, the SDK init throws 'Authentication key was missing during initialization' — the same outage we shipped this test to prevent."
);

assert(
  "B2 CheckoutButton does NOT reach for session.publicConfig.keyId",
  !/session\.publicConfig\.keyId/.test(BUTTON_SRC),
  "A `.keyId` read on the client would silently match no field on the wire (publicConfig is Record<string,string>), surface as undefined, and re-create the Razorpay init failure."
);

// =============================================================================
// SECTION C — supporting fields used by the modal
// =============================================================================

assert(
  "C1 razorpay adapter populates publicConfig.name + publicConfig.description",
  /publicConfig\s*:\s*\{[\s\S]{0,400}?\bname\s*:/.test(ADAPTER_SRC) &&
    /publicConfig\s*:\s*\{[\s\S]{0,400}?\bdescription\s*:/.test(ADAPTER_SRC),
  "name + description show in the Razorpay modal header. The client falls back to defaults if missing, but populating server-side keeps the modal copy under product control (e.g. localized per pack)."
);

assert(
  "C2 CheckoutButton reads name + description with safe fallbacks",
  /session\.publicConfig\.name\s*\?\?/.test(BUTTON_SRC) &&
    /session\.publicConfig\.description\s*\?\?/.test(BUTTON_SRC),
  "Defensive fallbacks on the client mean a future adapter that omits these fields still launches a usable modal (just with generic copy)."
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
// parses this tail. Without it the aggregator reports "(summary
// unparseable)" and marks the suite as failed even when every assertion
// passed.
console.log(`test-razorpay-handoff: ${pass} passed, ${fail} failed (of ${total})`);
process.exit(fail > 0 ? 1 : 0);
