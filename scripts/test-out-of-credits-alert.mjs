#!/usr/bin/env node
/**
 * 2026-05-03 Day 6.5 (plan §9) — out-of-credits alert contract.
 *
 * Static-parse + parser-helper unit tests for OutOfCreditsAlert.
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

function assertEq(actual, expected, msg) {
  const ok = actual === expected;
  if (ok) passed++;
  else {
    failed++;
    failures.push(`${msg}: expected ${expected}, got ${actual}`);
  }
}

const COMPONENT = path.join(
  ROOT,
  "components",
  "upsell",
  "OutOfCreditsAlert.tsx"
);
const componentSrc = fs.readFileSync(COMPONENT, "utf8");

// ============================================================================
// Section A — Component surface
// ============================================================================

assert(
  /export\s+function\s+OutOfCreditsAlert/m.test(componentSrc),
  "A1: OutOfCreditsAlert component exported"
);
assert(
  /export\s+function\s+isInsufficientCreditsError/m.test(componentSrc),
  "A2: isInsufficientCreditsError helper exported"
);
assert(
  /export\s+function\s+parseRequiredFromError/m.test(componentSrc),
  "A3: parseRequiredFromError helper exported"
);
assert(
  /export\s+function\s+parseBalanceFromError/m.test(componentSrc),
  "A4: parseBalanceFromError helper exported"
);
assert(
  /interface\s+OutOfCreditsAlertProps/m.test(componentSrc),
  "A5: props interface declared"
);
assert(
  componentSrc.startsWith('"use client"'),
  "A6: marked as client component"
);

// ============================================================================
// Section B — Plan §9 + principle 1 compliance
// ============================================================================

// No rupee/dollar mentions per call (principle 1: credits-only display).
const componentNoComments = componentSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/[^\n]*/gm, "");
assert(
  !/₹\d/.test(componentNoComments),
  "B1: no per-call rupee values (principle 1)"
);
assert(
  !/\$\d/.test(componentNoComments),
  "B2: no per-call dollar values (principle 1)"
);

// CTA links to /app/credits (the signed-in cash-register page) +
// /pricing (public catalog fallback). Both verified routes exist
// at app/app/credits/page.tsx and app/pricing/page.tsx.
assert(
  /href="\/app\/credits"/.test(componentSrc),
  "B3: primary CTA links to /app/credits"
);
assert(
  /href="\/pricing"/.test(componentSrc),
  "B4: secondary CTA links to /pricing"
);

// "Purchased credits never expire" honest framing (per §4.3 marketing
// copy sweep — Day 1 commit).
assert(
  /[Pp]urchased\s+credits\s+never\s+expire/.test(componentSrc),
  "B5: trust footer says 'Purchased credits never expire' (honest re: 7-day signup grant)"
);

// ============================================================================
// Section C — Parser helpers (string regex correctness)
// ============================================================================
//
// Inline-eval the parsers by running their regexes against fixture
// messages. The component file uses identical regex literals; we
// extract them from the source.

const requiredRe = (() => {
  const m = componentSrc.match(
    /parseRequiredFromError[\s\S]*?match\(\s*(\/[^/]+\/[gimsuy]*)/
  );
  return m ? eval(m[1]) : null;
})();

const balanceRe = (() => {
  const m = componentSrc.match(
    /parseBalanceFromError[\s\S]*?match\(\s*(\/[^/]+\/[gimsuy]*)/
  );
  return m ? eval(m[1]) : null;
})();

const insufRe = (() => {
  const m = componentSrc.match(
    /isInsufficientCreditsError[\s\S]*?return\s+(\/[^/]+\/[gimsuy]*)/
  );
  return m ? eval(m[1]) : null;
})();

assert(requiredRe !== null, "C1: extracted required regex");
assert(balanceRe !== null, "C2: extracted balance regex");
assert(insufRe !== null, "C3: extracted insufficient-detector regex");

// Real-world message format from mapErrorBody() (verified 2026-05-03):
//   "Not enough credits — this summary costs 3, you have 0. Top up on /app/billing."
const SAMPLE = "Not enough credits — this summary costs 3, you have 0. Top up on /app/billing.";

assert(insufRe?.test(SAMPLE), "C4: detector matches mapErrorBody 402 message");
const reqMatch = SAMPLE.match(requiredRe);
assertEq(
  reqMatch ? parseInt(reqMatch[1], 10) : null,
  3,
  "C5: required parser returns 3 from sample message"
);
const balMatch = SAMPLE.match(balanceRe);
assertEq(
  balMatch ? parseInt(balMatch[1], 10) : null,
  0,
  "C6: balance parser returns 0 from sample message"
);

// Multi-credit op (translate, redact, sign — multiplier-aware as of Day 1.7).
const MULT_SAMPLE =
  "Not enough credits — this translation costs 12, you have 5. Top up on /app/billing.";
assert(insufRe?.test(MULT_SAMPLE), "C7: detector matches multiplier op");
assertEq(
  parseInt(MULT_SAMPLE.match(requiredRe)?.[1] ?? "0", 10),
  12,
  "C8: required parser returns 12 (multiplier op)"
);
assertEq(
  parseInt(MULT_SAMPLE.match(balanceRe)?.[1] ?? "0", 10),
  5,
  "C9: balance parser returns 5 (partial balance)"
);

// Non-402 message must NOT match the detector.
const UNRELATED = "Translation failed — please retry.";
assert(
  !insufRe?.test(UNRELATED),
  "C10: detector does NOT match unrelated errors"
);

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`out-of-credits-alert: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
