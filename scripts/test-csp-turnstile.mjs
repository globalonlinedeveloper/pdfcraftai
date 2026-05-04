#!/usr/bin/env node
/**
 * 2026-05-04 — CSP guard for Cloudflare Turnstile (Plan §8 Layer 7).
 *
 * Background: discovered during the post-Hostinger-env-var-activation
 * E2E smoke test that the CSP was missing https://challenges.cloudflare.com
 * from script-src + frame-src. Result: the Turnstile widget script
 * couldn't load, the widget div rendered empty, and EVERY credentials
 * registration failed with "Captcha verification failed" because the
 * server-side verify hit Cloudflare with an empty token.
 *
 * The bug was cosmetic before today's activation (TURNSTILE_SECRET_KEY
 * was unset → server-side verify failed open). Activation of the secret
 * flipped it to fail-closed, exposing the gap as a release-blocking
 * outage.
 *
 * This guard locks in the fix so a future CSP refactor can't regress
 * the registration funnel silently.
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

const CONFIG = path.join(ROOT, "next.config.mjs");
const src = fs.readFileSync(CONFIG, "utf8");

// ============================================================================
// Section A — TURNSTILE_ORIGINS const exists
// ============================================================================

assert(
  /TURNSTILE_ORIGINS\s*=\s*\[\s*["']https:\/\/challenges\.cloudflare\.com["']/.test(
    src,
  ),
  "A1: TURNSTILE_ORIGINS const present with https://challenges.cloudflare.com",
);

// ============================================================================
// Section B — origin threaded into script-src + frame-src
// ============================================================================

// Find the script-src directive line and confirm Turnstile origins
// are joined in. Each CSP directive lives on its own template-literal
// line — the regex tolerates other origins (RAZORPAY, ANALYTICS) before
// TURNSTILE_ORIGINS by matching anything up to the closing backtick.
assert(
  /`script-src[^`]*\$\{TURNSTILE_ORIGINS\.join\("\s"\)\}/.test(src),
  "B1: TURNSTILE_ORIGINS spliced into script-src",
);
assert(
  /`frame-src[^`]*\$\{TURNSTILE_ORIGINS\.join\("\s"\)\}/.test(src),
  "B2: TURNSTILE_ORIGINS spliced into frame-src (Turnstile renders challenge in iframe)",
);

// ============================================================================
// Section C — defensive: domain literal not accidentally stripped
// ============================================================================

const turnstileOriginCount = (
  src.match(/https:\/\/challenges\.cloudflare\.com/g) ?? []
).length;
assert(
  turnstileOriginCount >= 1,
  `C1: at least one literal occurrence of https://challenges.cloudflare.com (got ${turnstileOriginCount})`,
);

// ============================================================================
// Output
// ============================================================================

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`csp-turnstile: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
