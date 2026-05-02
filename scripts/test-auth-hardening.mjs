#!/usr/bin/env node
/**
 * 2026-05-02 Day 1.5b (plan §8a items 4-8) — auth-hardening invariants.
 *
 * Pure static-parse guard against regressions on five auth-security
 * properties:
 *   1. bcrypt cost factor ≥ 12 in lib/auth-actions.ts:registerAction
 *      (and any other bcrypt.hash call site).
 *   2. registerSchema enforces password strength: ≥ 10 chars + 3 of 4
 *      character classes via countCharClasses.
 *   3. registerAction does NOT confirm email-existence to the client —
 *      duplicate-email error must be the generic phrasing locked in
 *      this commit.
 *   4. auth.ts uses bcrypt.compare (constant-time) for credentials
 *      authorize. Plain-text equality would be a critical bug.
 *   5. No user-enumeration phrasing anywhere in lib/auth-actions.ts
 *      (no "already exists", "user not found", "wrong password",
 *      "incorrect password" — all attacker hints).
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

const AUTH_ACTIONS = fs.readFileSync(path.join(ROOT, "lib", "auth-actions.ts"), "utf8");
const AUTH_TS = fs.readFileSync(path.join(ROOT, "auth.ts"), "utf8");

// ============================================================================
// Section A — bcrypt cost factor (plan §8a item 4)
// ============================================================================

// Find all bcrypt.hash(_, N) calls and assert N >= 12.
const HASH_RE = /bcrypt\.hash\([^,]+,\s*(\d+)\)/g;
const hashCalls = [...AUTH_ACTIONS.matchAll(HASH_RE)];
assert(
  hashCalls.length >= 1,
  `A1: at least one bcrypt.hash() call in auth-actions.ts (found ${hashCalls.length})`
);
for (const m of hashCalls) {
  const cost = parseInt(m[1], 10);
  assert(cost >= 12, `A2: bcrypt.hash cost factor ${cost} >= 12 (line ${m.index})`);
}

// ============================================================================
// Section B — Password strength (plan §8a item 5)
// ============================================================================

assert(
  /\.min\(10/.test(AUTH_ACTIONS),
  "B1: password min length is at least 10"
);
assert(
  /countCharClasses/.test(AUTH_ACTIONS),
  "B2: password strength uses countCharClasses helper"
);
assert(
  /countCharClasses\(p\)\s*>=?\s*3/.test(AUTH_ACTIONS),
  "B3: password requires at least 3 of 4 character classes"
);
assert(
  /\[a-z\]/.test(AUTH_ACTIONS),
  "B4: countCharClasses checks lowercase"
);
assert(
  /\[A-Z\]/.test(AUTH_ACTIONS),
  "B5: countCharClasses checks uppercase"
);
assert(
  /\[0-9\]/.test(AUTH_ACTIONS),
  "B6: countCharClasses checks digits"
);
assert(
  /\[\^A-Za-z0-9\]/.test(AUTH_ACTIONS),
  "B7: countCharClasses checks symbols"
);

// ============================================================================
// Section C — No user enumeration (plan §8a item 7)
// ============================================================================

// Only enumeration-style phrases that confirm user existence. Format-
// validation messages like "Enter a valid email" are NOT enumeration —
// they fire on bad syntax regardless of database state.
const ENUM_PATTERNS = [
  /already\s+exists/i,
  /user\s+not\s+found/i,
  /wrong\s+password/i,
  /incorrect\s+password/i,
  /no\s+account.*found/i,
  /email\s+is\s+not\s+registered/i,
  /this\s+email\s+is\s+(?:in\s+use|taken|registered)/i,
];

for (const pat of ENUM_PATTERNS) {
  // We only check error strings (string literals). Comments are
  // stripped first.
  const stripped = AUTH_ACTIONS.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/gm, "");
  assert(
    !pat.test(stripped),
    `C: lib/auth-actions.ts contains user-enumeration phrase /${pat.source}/`
  );
}

// ============================================================================
// Section D — bcrypt.compare for credentials authorize (plan §8a item 6)
// ============================================================================

assert(
  /bcrypt\.compare\(/m.test(AUTH_TS),
  "D1: auth.ts uses bcrypt.compare for password verification"
);
// Make sure no plain `===` is being used to compare passwords.
assert(
  !/password\s*===/m.test(AUTH_TS),
  "D2: auth.ts does NOT use === to compare passwords"
);

// ============================================================================
// Section E — Schema sanity (plan §8a item 5 alt path)
// ============================================================================

assert(
  /registerSchema\s*=\s*z\.object/m.test(AUTH_ACTIONS),
  "E1: registerSchema present"
);
assert(
  /password:\s*z\s*\n?\s*\.string\(\)/m.test(AUTH_ACTIONS),
  "E2: password field uses z.string()"
);
assert(
  /\.refine\(/m.test(AUTH_ACTIONS),
  "E3: password schema applies a refine() check (the 3-of-4 rule)"
);

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`auth-hardening: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
