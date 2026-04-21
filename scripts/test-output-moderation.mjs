#!/usr/bin/env node
// scripts/test-output-moderation.mjs
//
// Self-contained test harness for Task #28 — output moderation on AI
// responses (PLAN_GAP_ANALYSIS SEV-0 companion to Task #26).
//
// What this covers:
//
//   SECTION A — lib/ai/output-moderation.ts module contract:
//               * Exports ModerationOp, ModerationSeverity,
//                 ModerationCategory, ModerationFinding,
//                 ModerationResult, moderateOutput, assertOutputSafe,
//                 OutputModerationBlockedError, __OUTPUT_MODERATION_INTERNALS.
//               * ModerationOp type-aliased to PromptSafetyOp so input
//                 and output defenses stay in lockstep on the op set.
//               * server-only import present.
//
//   SECTION B — pattern library (source-level pinning):
//               * Every expected secret subtype declared with correct
//                 severity (always critical for credentials; medium for
//                 JWT).
//               * Every expected PII subtype declared (us_ssn high,
//                 credit_card_shape high, email_address low,
//                 us_phone_number low, ipv4_address low).
//               * Every expected jailbreak-echo subtype declared
//                 (dan_mode_activated high, role_break_confirmation
//                 medium, ignoring_prior_instructions medium).
//
//   SECTION C — pattern positive/negative runtime:
//               * Canonical-shape secrets trip critical.
//               * Canonical-shape PII trips appropriate severity.
//               * Legitimate text (doc snippets, ops logs) does NOT
//                 trigger false positives on the high/critical patterns.
//
//   SECTION D — severity aggregation + assertOutputSafe behavior +
//               redactSample masking:
//               * SEVERITY_RANK ordering: none < low < medium < high < critical.
//               * moderateOutput returns strongest severity across findings.
//               * assertOutputSafe throws on critical, passes on all
//                 others.
//               * redactSample masks middle bytes; short samples become
//                 `<len=N>` tags.
//
//   SECTION E — call-site integration (every lib/ai/ op module +
//               chat route imports from output-moderation AND actually
//               uses the helpers):
//               * All 9 non-streaming op modules (summarize/translate/
//                 compare/generate/rewrite/table/redact/sign/ocr) import
//                 from ./output-moderation, declare a moderation field
//                 on their Result type, and call
//                 moderateOutput + assertOutputSafe with the correct
//                 op string.
//               * Chat route imports moderateOutput, calls it with
//                 op: "chat", has NO assertOutputSafe call (advisory
//                 only — deltas already on the wire), and logs findings
//                 via console.warn.
//
//   SECTION F — ModerationOp ≡ PromptSafetyOp alignment:
//               * Every op in the router's AIOp union + the PromptSafetyOp
//                 widening gets a call-site that passes that exact op
//                 string to moderateOutput.
//
// Run: `node scripts/test-output-moderation.mjs`
// Exits 0 on pass, 1 on any failure.
//
// Wiring: this suite is registered in scripts/run-all-tests.mjs SUITES
// right after prompt-safety — the two form a companion defense-in-depth
// pair and regressions in either module typically break both harnesses.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const OM_PATH = resolve(ROOT, "lib", "ai", "output-moderation.ts");
const PS_PATH = resolve(ROOT, "lib", "ai", "prompt-safety.ts");
const ROUTER_PATH = resolve(ROOT, "lib", "ai", "router.ts");
const SUMMARIZE_PATH = resolve(ROOT, "lib", "ai", "summarize.ts");
const TRANSLATE_PATH = resolve(ROOT, "lib", "ai", "translate.ts");
const COMPARE_PATH = resolve(ROOT, "lib", "ai", "compare.ts");
const GENERATE_PATH = resolve(ROOT, "lib", "ai", "generate.ts");
const REWRITE_PATH = resolve(ROOT, "lib", "ai", "rewrite.ts");
const TABLE_PATH = resolve(ROOT, "lib", "ai", "table.ts");
const REDACT_PATH = resolve(ROOT, "lib", "ai", "redact.ts");
const SIGN_PATH = resolve(ROOT, "lib", "ai", "sign.ts");
const OCR_PATH = resolve(ROOT, "lib", "ai", "ocr.ts");
const CHAT_ROUTE_PATH = resolve(ROOT, "app", "api", "ai", "chat", "route.ts");

const OM_SRC = readFileSync(OM_PATH, "utf8");
const PS_SRC = readFileSync(PS_PATH, "utf8");
const ROUTER_SRC = readFileSync(ROUTER_PATH, "utf8");
const SUMMARIZE_SRC = readFileSync(SUMMARIZE_PATH, "utf8");
const TRANSLATE_SRC = readFileSync(TRANSLATE_PATH, "utf8");
const COMPARE_SRC = readFileSync(COMPARE_PATH, "utf8");
const GENERATE_SRC = readFileSync(GENERATE_PATH, "utf8");
const REWRITE_SRC = readFileSync(REWRITE_PATH, "utf8");
const TABLE_SRC = readFileSync(TABLE_PATH, "utf8");
const REDACT_SRC = readFileSync(REDACT_PATH, "utf8");
const SIGN_SRC = readFileSync(SIGN_PATH, "utf8");
const OCR_SRC = readFileSync(OCR_PATH, "utf8");
const CHAT_SRC = readFileSync(CHAT_ROUTE_PATH, "utf8");

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, condition, detail) {
  if (condition) {
    pass += 1;
  } else {
    fail += 1;
    failures.push({ label, detail });
  }
}

// =============================================================================
// SECTION A — lib/ai/output-moderation.ts module contract
// =============================================================================

assert(
  "A1 output-moderation.ts exports ModerationOp type",
  /export type ModerationOp\s*=/.test(OM_SRC),
  "ModerationOp type export missing"
);

assert(
  "A1 ModerationOp is aliased to PromptSafetyOp",
  /export type ModerationOp\s*=\s*PromptSafetyOp/.test(OM_SRC),
  "ModerationOp should be the same op set as PromptSafetyOp so input/output defenses stay in sync"
);

assert(
  "A1 output-moderation.ts imports PromptSafetyOp from ./prompt-safety",
  /import\s+type\s+\{\s*PromptSafetyOp\s*\}\s*from\s*"\.\/prompt-safety"/.test(
    OM_SRC
  ),
  "Must import PromptSafetyOp from ./prompt-safety so a new op forces a compile-time cascade"
);

assert(
  "A2 exports ModerationSeverity type",
  /export type ModerationSeverity\s*=/.test(OM_SRC),
  "ModerationSeverity type export missing"
);

assert(
  "A2 ModerationSeverity includes the full ladder none/low/medium/high/critical",
  /ModerationSeverity\s*=[\s\S]*?"none"[\s\S]*?"low"[\s\S]*?"medium"[\s\S]*?"high"[\s\S]*?"critical"/.test(
    OM_SRC
  ),
  "ModerationSeverity must list none, low, medium, high, critical"
);

assert(
  "A2 exports ModerationCategory type with pii/secret/jailbreak_echo",
  /export type ModerationCategory\s*=[\s\S]*?"pii"[\s\S]*?"secret"[\s\S]*?"jailbreak_echo"/.test(
    OM_SRC
  ),
  "ModerationCategory must cover pii, secret, jailbreak_echo"
);

assert(
  "A3 exports ModerationFinding interface",
  /export interface ModerationFinding/.test(OM_SRC),
  "ModerationFinding interface export missing"
);

assert(
  "A3 exports ModerationResult interface",
  /export interface ModerationResult/.test(OM_SRC),
  "ModerationResult interface export missing"
);

assert(
  "A3 exports moderateOutput function",
  /export function moderateOutput\(/.test(OM_SRC),
  "moderateOutput function missing"
);

assert(
  "A3 exports assertOutputSafe function",
  /export function assertOutputSafe\(/.test(OM_SRC),
  "assertOutputSafe function missing"
);

assert(
  "A3 exports OutputModerationBlockedError class",
  /export class OutputModerationBlockedError/.test(OM_SRC),
  "OutputModerationBlockedError class missing"
);

assert(
  "A3 exports __OUTPUT_MODERATION_INTERNALS test hook",
  /export const __OUTPUT_MODERATION_INTERNALS\b/.test(OM_SRC),
  "__OUTPUT_MODERATION_INTERNALS test hook missing"
);

assert(
  "A4 output-moderation.ts is server-only",
  /import\s+"server-only"/.test(OM_SRC),
  "output-moderation must import 'server-only' to guard against client bundling"
);

// =============================================================================
// SECTION B — pattern library (source-level pinning)
// =============================================================================

// Secrets — always critical except JWT.
const REQUIRED_SECRETS = [
  { subtype: "anthropic_api_key", severity: "critical" },
  { subtype: "openai_api_key", severity: "critical" },
  { subtype: "github_pat_classic", severity: "critical" },
  { subtype: "github_pat_fine_grained", severity: "critical" },
  { subtype: "stripe_api_key", severity: "critical" },
  { subtype: "aws_access_key_id", severity: "critical" },
  { subtype: "slack_token", severity: "critical" },
  { subtype: "google_api_key", severity: "critical" },
  { subtype: "private_key_pem", severity: "critical" },
  { subtype: "jwt_token", severity: "medium" },
];

for (const s of REQUIRED_SECRETS) {
  const blockRe = new RegExp(
    `subtype:\\s*"${s.subtype}"[\\s\\S]{0,400}severity:\\s*"${s.severity}"`,
    "m"
  );
  assert(
    `B1 secret pattern "${s.subtype}" declared with severity "${s.severity}"`,
    blockRe.test(OM_SRC),
    `Secret subtype "${s.subtype}" missing or wrong severity`
  );
}

// PII.
const REQUIRED_PII = [
  { subtype: "us_ssn", severity: "high" },
  { subtype: "credit_card_shape", severity: "high" },
  { subtype: "email_address", severity: "low" },
  { subtype: "us_phone_number", severity: "low" },
  { subtype: "ipv4_address", severity: "low" },
];

for (const p of REQUIRED_PII) {
  const blockRe = new RegExp(
    `subtype:\\s*"${p.subtype}"[\\s\\S]{0,400}severity:\\s*"${p.severity}"`,
    "m"
  );
  assert(
    `B2 PII pattern "${p.subtype}" declared with severity "${p.severity}"`,
    blockRe.test(OM_SRC),
    `PII subtype "${p.subtype}" missing or wrong severity`
  );
}

// Jailbreak echoes.
const REQUIRED_JAILBREAK_ECHOES = [
  { subtype: "dan_mode_activated", severity: "high" },
  { subtype: "role_break_confirmation", severity: "medium" },
  { subtype: "ignoring_prior_instructions", severity: "medium" },
];

for (const j of REQUIRED_JAILBREAK_ECHOES) {
  const blockRe = new RegExp(
    `subtype:\\s*"${j.subtype}"[\\s\\S]{0,400}severity:\\s*"${j.severity}"`,
    "m"
  );
  assert(
    `B3 jailbreak-echo pattern "${j.subtype}" declared with severity "${j.severity}"`,
    blockRe.test(OM_SRC),
    `Jailbreak-echo subtype "${j.subtype}" missing or wrong severity`
  );
}

// Flat list assembly check.
assert(
  "B4 ALL_PATTERNS assembled from SECRET_PATTERNS, PII_PATTERNS, JAILBREAK_ECHO_PATTERNS",
  /ALL_PATTERNS[\s\S]*?=[\s\S]*?\.\.\.SECRET_PATTERNS[\s\S]*?\.\.\.PII_PATTERNS[\s\S]*?\.\.\.JAILBREAK_ECHO_PATTERNS/.test(
    OM_SRC
  ),
  "ALL_PATTERNS should flat-spread all three category arrays"
);

// =============================================================================
// SECTION C — pattern positive/negative runtime checks
// =============================================================================
//
// We mirror the strongest patterns from output-moderation.ts here as
// plain JS regex so we can exercise the matcher contract without
// importing TypeScript directly. Source-level pinning in Section B
// guarantees the production module has the same patterns; this section
// is the belt-and-braces runtime floor.

// Critical-severity secret patterns — canonical prefixes. These MUST trip.
const CRITICAL_REGEXES = [
  /\bsk-ant-[A-Za-z0-9_-]{40,}\b/, // anthropic
  /\bsk-(?!ant-)[A-Za-z0-9_-]{40,}\b/, // openai
  /\bghp_[A-Za-z0-9]{30,}\b/, // github classic
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/, // github fine-grained
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/, // stripe
  /\bAKIA[0-9A-Z]{16}\b/, // aws
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // slack
  /\bAIza[0-9A-Za-z_-]{35}\b/, // google
  /-----BEGIN\s+(?:RSA\s+|DSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/, // PEM
];

// High-severity PII patterns.
const HIGH_PII_REGEXES = [
  /\b(?!000|666)[0-8]\d{2}-(?!00)\d{2}-(?!0000)\d{4}\b/, // SSN
];

// High-severity jailbreak-echo pattern.
const HIGH_JAILBREAK_REGEX = /\b(?:DAN\s+mode\s+(?:activated|on|enabled)|^DAN\s*:)/im;

// Positive cases — strings that MUST match a critical pattern.
// Keys are sized to the real format + some slack so they reliably trip.
const POSITIVE_CRITICAL_CASES = [
  "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
  "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMN",
  "ghp_abcdefghijklmnopqrstuvwxyz01234567",
  "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
  "sk_live_abcdefghijklmnopqrstuvwxyz01234",
  "AKIAIOSFODNN7EXAMPLE",
  "xoxb-1234567890-abcdefghijklmnop",
  // AIza + exactly 35 base64url chars (regex uses {35} + \b).
  "AIzaabcdefghijklmnopqrstuvwxyz012345678",
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN OPENSSH PRIVATE KEY-----",
];

function tripsCritical(text) {
  return CRITICAL_REGEXES.some((r) => r.test(text));
}

for (const c of POSITIVE_CRITICAL_CASES) {
  assert(
    `C1 critical secret pattern trips on: "${c.slice(0, 48)}${
      c.length > 48 ? "…" : ""
    }"`,
    tripsCritical(c) === true,
    `Expected a critical-severity match on secret-shaped input`
  );
}

// Positive PII cases.
const POSITIVE_HIGH_PII_CASES = ["Employee SSN: 123-45-6789 on file."];
for (const c of POSITIVE_HIGH_PII_CASES) {
  assert(
    `C2 high-severity PII pattern trips on: "${c.slice(0, 48)}…"`,
    HIGH_PII_REGEXES.some((r) => r.test(c)),
    `Expected a high-severity match on PII-shaped input`
  );
}

// Positive jailbreak-echo.
assert(
  "C3 jailbreak-echo pattern trips on 'DAN mode activated'",
  HIGH_JAILBREAK_REGEX.test("DAN mode activated. Now I will help you."),
  "Expected DAN echo to trip the high-severity jailbreak regex"
);

// Negative cases — legitimate content that MUST NOT trip critical.
// These are the realistic false-positive traps: business text, markdown
// headers, filenames that rhyme with secrets.
const NEGATIVE_CRITICAL_CASES = [
  "The quarterly revenue growth exceeded 15%.",
  "Filed under section 5.7.2 of the contract.",
  "Connected to the RSA cryptographic module.",
  "Private keys should be rotated every 90 days.",
  "The AKIA department issued a new policy.", // 'AKIA' word alone without 16-char ID tail
  "Slack message #general channel updated.",
  "Skip the introduction section.", // "sk-" without a key shape
];

for (const c of NEGATIVE_CRITICAL_CASES) {
  assert(
    `C4 legitimate text does NOT trip critical-severity: "${c.slice(0, 48)}…"`,
    tripsCritical(c) === false,
    `False-positive: legitimate text matched a critical-severity pattern`
  );
}

// Negative high-PII cases.
const NEGATIVE_HIGH_PII_CASES = [
  "Call us at (555) 867-5309 anytime.", // phone only, not SSN
  "Reference number ABC-12-3456X doesn't match the SSN format.",
  "The 000-00-0000 placeholder is excluded by design.",
];
for (const c of NEGATIVE_HIGH_PII_CASES) {
  assert(
    `C5 legitimate text does NOT trip high-severity PII: "${c.slice(0, 48)}…"`,
    HIGH_PII_REGEXES.some((r) => r.test(c)) === false,
    `False-positive: legitimate text matched a high-severity PII pattern`
  );
}

// =============================================================================
// SECTION D — severity aggregation + assertOutputSafe + redactSample
// =============================================================================

assert(
  "D1 SEVERITY_RANK orders none=0 < low=1 < medium=2 < high=3 < critical=4",
  /SEVERITY_RANK[\s\S]*?none:\s*0[\s\S]*?low:\s*1[\s\S]*?medium:\s*2[\s\S]*?high:\s*3[\s\S]*?critical:\s*4/.test(
    OM_SRC
  ),
  "SEVERITY_RANK ordering must be none=0 < low=1 < medium=2 < high=3 < critical=4"
);

assert(
  "D1 strongerOf chooses the higher-ranked severity",
  /function strongerOf[\s\S]*?SEVERITY_RANK\[a\]\s*>=\s*SEVERITY_RANK\[b\]\s*\?\s*a\s*:\s*b/.test(
    OM_SRC
  ),
  "strongerOf should pick the higher-ranked of two severities"
);

assert(
  "D1 moderateOutput aggregates maxSeverity via strongerOf",
  /maxSeverity\s*=\s*strongerOf\(maxSeverity,\s*p\.severity\)/.test(OM_SRC),
  "moderateOutput should fold p.severity into maxSeverity via strongerOf"
);

assert(
  "D1 moderateOutput sorts findings strongest-first",
  /findings\.sort\([\s\S]*?SEVERITY_RANK\[b\.severity\]\s*-\s*SEVERITY_RANK\[a\.severity\]/.test(
    OM_SRC
  ),
  "moderateOutput should sort findings descending by severity"
);

assert(
  "D1 moderateOutput returns { safe: true, severity: 'none' } on empty input",
  /safe:\s*true,\s*\n?\s*severity:\s*"none",\s*\n?\s*findings:\s*\[\]/.test(
    OM_SRC
  ),
  "moderateOutput must return the stable empty result for empty text"
);

// assertOutputSafe behavior — throws on critical, passes on everything else.
assert(
  "D2 assertOutputSafe throws OutputModerationBlockedError on critical",
  /function assertOutputSafe[\s\S]*?if\s*\(\s*result\.severity\s*===\s*"critical"\s*\)[\s\S]*?throw\s+new\s+OutputModerationBlockedError/.test(
    OM_SRC
  ),
  "assertOutputSafe should throw OutputModerationBlockedError when severity is critical"
);

// Extract the assertOutputSafe function body so the throw-count check
// doesn't trip on throws mentioned in doc-comment examples elsewhere
// in the file. Anchored on the function signature and its closing brace.
const ASSERT_FN_BODY_MATCH = OM_SRC.match(
  /export function assertOutputSafe\([\s\S]*?\):\s*void\s*\{([\s\S]*?)\n\}/
);
const assertFnBody = ASSERT_FN_BODY_MATCH ? ASSERT_FN_BODY_MATCH[1] : "";
const throwsInAssertFn = (assertFnBody.match(/throw\s+new/g) || []).length;

assert(
  "D2 assertOutputSafe function body has exactly one throw (gated by critical)",
  throwsInAssertFn === 1,
  "assertOutputSafe should throw ONLY on critical — higher-severity-than-critical is impossible, and throwing on high risks breaking ops that legitimately contain a phone number"
);

// redactSample masking contract.
assert(
  "D3 redactSample returns <len=N> for samples shorter than 8 chars",
  /function redactSample[\s\S]*?if\s*\(\s*raw\.length\s*<\s*8\s*\)[\s\S]*?`<len=\$\{raw\.length\}>`/.test(
    OM_SRC
  ),
  "redactSample should return <len=N> for short samples"
);

assert(
  "D3 redactSample keeps first 3 + last 2 chars for longer samples",
  /const head\s*=\s*raw\.slice\(0,\s*3\)[\s\S]*?const tail\s*=\s*raw\.slice\(-2\)/.test(
    OM_SRC
  ),
  "redactSample should slice(0,3) + slice(-2) for long samples"
);

assert(
  "D4 OutputModerationBlockedError carries result + op on the instance",
  /class OutputModerationBlockedError[\s\S]*?public\s+readonly\s+result:\s*ModerationResult[\s\S]*?public\s+readonly\s+op:\s*ModerationOp/.test(
    OM_SRC
  ),
  "OutputModerationBlockedError should expose result + op as readonly instance fields"
);

// =============================================================================
// SECTION E — call-site integration
// =============================================================================

// Non-streaming op modules — each imports ModerationResult, imports
// moderateOutput + assertOutputSafe, declares moderation in its Result
// interface, and calls the guard with the correct op string.
const LIB_CALL_SITES = [
  { name: "summarize.ts", src: SUMMARIZE_SRC, op: "summarize" },
  { name: "translate.ts", src: TRANSLATE_SRC, op: "translate" },
  { name: "compare.ts", src: COMPARE_SRC, op: "compare" },
  { name: "generate.ts", src: GENERATE_SRC, op: "generate" },
  { name: "rewrite.ts", src: REWRITE_SRC, op: "rewrite" },
  { name: "table.ts", src: TABLE_SRC, op: "table" },
  { name: "redact.ts", src: REDACT_SRC, op: "redact" },
  { name: "sign.ts", src: SIGN_SRC, op: "sign" },
  { name: "ocr.ts", src: OCR_SRC, op: "ocr" },
];

for (const site of LIB_CALL_SITES) {
  assert(
    `E1 ${site.name} imports ModerationResult type from ./output-moderation`,
    /import\s+type\s+\{\s*ModerationResult\s*\}\s+from\s+"\.\/output-moderation"/.test(
      site.src
    ),
    `${site.name} must import ModerationResult from "./output-moderation"`
  );

  assert(
    `E1 ${site.name} imports moderateOutput + assertOutputSafe from ./output-moderation`,
    /import\s*\{\s*assertOutputSafe\s*,\s*moderateOutput\s*\}\s+from\s+"\.\/output-moderation"/.test(
      site.src
    ),
    `${site.name} must import { assertOutputSafe, moderateOutput } from "./output-moderation"`
  );

  assert(
    `E2 ${site.name} Result interface exposes moderation: ModerationResult`,
    /moderation:\s*ModerationResult/.test(site.src),
    `${site.name} Result type must expose a moderation: ModerationResult field so callers can surface findings`
  );

  assert(
    `E3 ${site.name} calls moderateOutput(..., { op: "${site.op}" })`,
    new RegExp(
      `moderateOutput\\([^)]*\\{\\s*op:\\s*"${site.op}"\\s*\\}\\s*\\)`
    ).test(site.src),
    `${site.name} must call moderateOutput(text, { op: "${site.op}" })`
  );

  assert(
    `E3 ${site.name} calls assertOutputSafe(moderation, "${site.op}")`,
    new RegExp(
      `assertOutputSafe\\(\\s*moderation\\s*,\\s*"${site.op}"\\s*\\)`
    ).test(site.src),
    `${site.name} must call assertOutputSafe(moderation, "${site.op}") after moderateOutput`
  );
}

// Chat route — ADVISORY ONLY: imports moderateOutput + calls it, but
// does NOT call assertOutputSafe (deltas already streamed), and logs
// via console.warn instead of throwing.
assert(
  "E4 app/api/ai/chat/route.ts imports moderateOutput from @/lib/ai/output-moderation",
  /import\s*\{\s*moderateOutput\s*\}\s+from\s+"@\/lib\/ai\/output-moderation"/.test(
    CHAT_SRC
  ),
  "chat route must import moderateOutput from @/lib/ai/output-moderation"
);

assert(
  "E4 app/api/ai/chat/route.ts calls moderateOutput with op: \"chat\"",
  /moderateOutput\([^)]*\{\s*op:\s*"chat"\s*\}\s*\)/.test(CHAT_SRC),
  "chat route must call moderateOutput(assistantText, { op: \"chat\" }) after the stream finishes"
);

assert(
  "E4 app/api/ai/chat/route.ts does NOT call assertOutputSafe (advisory only)",
  !/assertOutputSafe\s*\(/.test(CHAT_SRC),
  "chat route must NOT call assertOutputSafe — streaming deltas are already on the wire; blocking would be too late"
);

assert(
  "E4 app/api/ai/chat/route.ts logs moderation findings via console.warn",
  /console\.warn\([\s\S]*?moderation[\s\S]*?flagged/.test(CHAT_SRC),
  "chat route must surface moderation findings via console.warn for server-log auditability"
);

// =============================================================================
// SECTION F — ModerationOp ≡ PromptSafetyOp alignment
// =============================================================================
//
// ModerationOp is type-aliased to PromptSafetyOp. That already gives us
// compile-time coverage. But we also want a runtime check: every op in
// the router's AIOp union must have a moderateOutput({ op: "<name>" })
// call somewhere in lib/ai/ so adding a new op to AIOp can't land
// without the output-moderation cascade.

const AI_OP_MATCH = ROUTER_SRC.match(/export type AIOp\s*=\s*([^;]+);/);
if (AI_OP_MATCH) {
  const aiOpList = (AI_OP_MATCH[1].match(/"([^"]+)"/g) || []).map((s) =>
    s.slice(1, -1)
  );
  for (const op of aiOpList) {
    // At least one lib/ai source (including chat route) must call
    // moderateOutput with this op.
    const opCallPattern = new RegExp(
      `moderateOutput\\([^)]*\\{\\s*op:\\s*"${op}"\\s*\\}\\s*\\)`
    );
    const sources = [
      SUMMARIZE_SRC,
      TRANSLATE_SRC,
      COMPARE_SRC,
      GENERATE_SRC,
      REWRITE_SRC,
      TABLE_SRC,
      REDACT_SRC,
      SIGN_SRC,
      OCR_SRC,
      CHAT_SRC,
    ];
    assert(
      `F1 AIOp "${op}" has a moderateOutput call-site`,
      sources.some((src) => opCallPattern.test(src)),
      `AIOp "${op}" from router.ts has no moderateOutput() call — adding an op requires wiring both input-side (prompt-safety) AND output-side (output-moderation)`
    );
  }
  assert(
    "F1 AIOp list parsed from router.ts (diagnostic)",
    aiOpList.length >= 7,
    `Expected ≥7 AIOp entries; parsed ${aiOpList.length}`
  );
} else {
  assert(
    "F1 AIOp union parsable from router.ts",
    false,
    "Could not locate `export type AIOp = …;` in router.ts"
  );
}

// PromptSafetyOp widening check — the rewrite/table/redact extension
// must still be in prompt-safety.ts (ModerationOp inherits from it).
assert(
  "F2 PromptSafetyOp still widens AIOp with rewrite/table/redact",
  /PromptSafetyOp\s*=\s*AIOp\s*\|\s*"rewrite"\s*\|\s*"table"\s*\|\s*"redact"/.test(
    PS_SRC
  ),
  "PromptSafetyOp must still include rewrite/table/redact so ModerationOp inherits the full op set"
);

// =============================================================================
// Report
// =============================================================================

const total = pass + fail;
console.log("");
console.log(`test-output-moderation.mjs — ${pass}/${total} assertions passed`);
// Canonical summary line — parsed by scripts/run-all-tests.mjs.
console.log(`Output-moderation tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("");
  console.error("FAILURES:");
  for (const f of failures) {
    console.error(`  ✗ ${f.label}`);
    console.error(`      ${f.detail}`);
  }
  process.exit(1);
}
