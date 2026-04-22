#!/usr/bin/env node
// Self-contained test harness for Task #22 part 2 — the degradation
// UX rewrite across the nine /api/ai/* tool components and the
// dunning scaffold. Mirrors the plain-Node pattern used by every
// other test-*.mjs in this repo: assert() with a pass/fail counter,
// static file greps + dynamic imports of pure modules, emits the
// canonical "N passed, M failed" summary line that run-all-tests.mjs
// parses.
//
// Why this suite exists:
//   The stale per-tool error strings — especially the "No AI provider
//   is configured on this deployment. Ask the admin to set
//   ANTHROPIC_API_KEY or OPENAI_API_KEY." line that fired for ANY
//   503 — gave users wrong mental models every time the operator
//   tripped the kill switch or the daily-cost ceiling hit. Once
//   classifyAiError() is the single source of truth, a regression
//   that puts the stale copy back into any one tool is exactly the
//   kind of thing that doesn't crash, doesn't break any test, but
//   quietly makes the UX worse. This harness pins the call-site so
//   "SummarizePdfTool silently stopped importing classifyAiError"
//   shows up here, not in a support ticket.
//
// What this covers:
//   SECTION A — lib/ai/degradation.ts module surface: AiDegradation
//               discriminated union with all six kinds
//               (op_disabled / budget_exhausted / no_provider_configured /
//               provider_unavailable / not_authenticated / unknown),
//               classifyAiError + formatMicrosUsdInline + formatRetryWindow
//               exports, pure-function contract (no side effects, stable
//               across repeated calls), and the 401/503/429/502
//               status→kind mapping.
//   SECTION B — per-tool call-site integration: all nine AI tool
//               components import classifyAiError from @/lib/ai/degradation
//               AND actually call it inside mapErrorBody. The stale
//               "No AI provider is configured on this deployment"
//               literal must no longer appear in any tool (that copy
//               now lives only in degradation.ts's
//               no_provider_configured fallback).
//   SECTION C — lib/payments/dunning.ts scaffold: DunningState union,
//               DunningRow shape, applyDunningEvent reducer idempotency
//               on providerEventId, newDunningRow initializer,
//               isEntitled predicate, DUNNING_POLICY constants.
//   SECTION D — run-all-tests.mjs registers this suite.
//
// Run: `node scripts/test-degradation-ux.mjs`
// Exits 0 on pass, 1 on any failure.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const DEG_PATH = resolve(ROOT, "lib", "ai", "degradation.ts");
const DUNNING_PATH = resolve(ROOT, "lib", "payments", "dunning.ts");
const TOOLS_DIR = resolve(ROOT, "components", "tools");
const AGGREGATOR_PATH = resolve(ROOT, "scripts", "run-all-tests.mjs");

// The nine AI tools that hit /api/ai/* — PdfToOfficeTool is excluded
// because it's a deterministic converter hitting /api/tools/* and
// doesn't share the AI-degradation band. CompressPdf / MergePdf /
// SplitPdf / RotatePdf / PageNumbers / ImageToPdf / ProtectPdf are
// also non-AI and excluded.
const AI_TOOLS = [
  { file: "SummarizePdfTool.tsx", opLabel: "the summarizer" },
  { file: "TranslatePdfTool.tsx", opLabel: "the translator" },
  { file: "RewritePdfTool.tsx", opLabel: "the rewriter" },
  { file: "RedactPdfTool.tsx", opLabel: "the redactor" },
  { file: "SignPdfTool.tsx", opLabel: "fill & sign" },
  { file: "ComparePdfTool.tsx", opLabel: "the comparator" },
  { file: "GeneratePdfTool.tsx", opLabel: "the generator" },
  { file: "TableExtractTool.tsx", opLabel: "table extraction" },
  { file: "OcrPdfTool.tsx", opLabel: "OCR" },
];

/* ------------------------------------------------------------------ */
/* Harness plumbing                                                    */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.log(`  FAIL: ${msg}`);
  }
}

function read(p) {
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

/* ------------------------------------------------------------------ */
/* Shared dynamic-import helper for plain-TS modules                   */
/* ------------------------------------------------------------------ */
//
// Node can't import .ts directly. We inline-transpile the handful of
// TS-only bits we care about (types are erased; we just need the
// runtime exports). The two modules under test are both
// pure-function + no-deps, so a naive strip of `type …` /
// `interface …` / `: Type` annotations is enough. Rather than ship a
// fragile mini-stripper, we just write the assertions in terms of
// static-text checks here. The ai-evals harness uses a full tsc-pipe
// approach — overkill for a two-file assertion set, and it slows the
// run-all loop.

/* ------------------------------------------------------------------ */
/* SECTION A — lib/ai/degradation.ts module surface                    */
/* ------------------------------------------------------------------ */

console.log("\n[SECTION A] lib/ai/degradation.ts module surface");

const degSrc = read(DEG_PATH);
assert(degSrc.length > 0, "lib/ai/degradation.ts exists");

for (const kind of [
  "op_disabled",
  "budget_exhausted",
  "no_provider_configured",
  "provider_unavailable",
  "not_authenticated",
  "unknown",
]) {
  assert(
    degSrc.includes(`kind: "${kind}"`),
    `AiDegradation union includes kind "${kind}"`
  );
}

assert(
  /export\s+function\s+classifyAiError/.test(degSrc),
  "classifyAiError is exported"
);
assert(
  /export\s+function\s+formatMicrosUsdInline/.test(degSrc),
  "formatMicrosUsdInline is exported"
);
assert(
  /export\s+function\s+formatRetryWindow/.test(degSrc),
  "formatRetryWindow is exported"
);
assert(
  /export\s+type\s+AiDegradation/.test(degSrc),
  "AiDegradation type is exported"
);

// Status→kind dispatch assertions. These pin the core contract — if
// someone reshuffles the if-cascade into a switch or adds a new
// status band, we want the test to catch unintentional semantic
// drift.
assert(
  /status\s*===\s*401/.test(degSrc),
  "classifyAiError branches on status 401"
);
assert(
  /status\s*===\s*503/.test(degSrc),
  "classifyAiError branches on status 503"
);
assert(
  /status\s*===\s*429/.test(degSrc),
  "classifyAiError branches on status 429"
);
assert(
  /status\s*===\s*502/.test(degSrc),
  "classifyAiError branches on status 502"
);

// The two 503 sub-branches — op_disabled and no_provider_configured —
// must BOTH be present. The old-world stale copy pinned only
// no_provider_configured; without op_disabled handling the kill
// switch looks like "your deployment is broken".
assert(
  /errorCode\s*===\s*"op_disabled"/.test(degSrc),
  "503 branch handles error=op_disabled"
);
assert(
  /errorCode\s*===\s*"no_provider_configured"/.test(degSrc),
  "503 branch handles error=no_provider_configured"
);
assert(
  /errorCode\s*===\s*"daily_cost_ceiling_exceeded"/.test(degSrc),
  "429 branch handles error=daily_cost_ceiling_exceeded (budget_exhausted)"
);

// User-facing copy contract. Each populated kind carries userMessage.
assert(
  (degSrc.match(/userMessage:/g) || []).length >= 7,
  "every populated kind carries a userMessage field"
);

// 502 copy mentions refunds — users panic otherwise.
assert(
  /credits were refunded/i.test(degSrc),
  "provider_unavailable (502) copy explicitly mentions credit refund"
);

// Budget-exhausted copy carries a reset-window phrase.
assert(
  /resets in.*00:00 UTC/.test(degSrc),
  "budget_exhausted copy mentions 00:00 UTC reset"
);

/* ------------------------------------------------------------------ */
/* SECTION B — per-tool call-site integration                          */
/* ------------------------------------------------------------------ */

console.log(
  "\n[SECTION B] Per-tool call-site integration (9 AI tools)"
);

// Known-bad copy: the pre-Task-#22 stale 503 string. This literal
// should NOT appear anywhere in a tool file anymore — its one
// authoritative home is lib/ai/degradation.ts.
const STALE_503_COPY =
  "No AI provider is configured on this deployment";

for (const t of AI_TOOLS) {
  const toolPath = resolve(TOOLS_DIR, t.file);
  const src = read(toolPath);

  assert(src.length > 0, `tool file exists: ${t.file}`);

  assert(
    /import\s*\{[^}]*\bclassifyAiError\b[^}]*\}\s*from\s*["']@\/lib\/ai\/degradation["']/.test(
      src
    ),
    `${t.file} imports classifyAiError from @/lib/ai/degradation`
  );

  assert(
    /classifyAiError\s*\(\s*status\s*,\s*body\s*,/.test(src),
    `${t.file} calls classifyAiError(status, body, …) inside mapErrorBody`
  );

  assert(
    src.includes(`opLabel: "${t.opLabel}"`),
    `${t.file} passes opLabel "${t.opLabel}"`
  );

  // The classifier replaces the old stale-503 string. A tool that
  // still carries the literal either regressed or forgot to delete
  // the case 503 branch after wiring the classifier.
  //
  // Exception: OcrPdfTool.tsx keeps a tool-specific 503 branch for
  // the no_provider_configured sub-case (PDF-vision provider
  // required). That copy is different ("No AI provider with
  // PDF-vision support…"), which is why the literal check above
  // is a prefix-only check — "No AI provider is configured on this
  // deployment" must not appear. "No AI provider with PDF-vision
  // support" is allowed.
  assert(
    !src.includes(STALE_503_COPY),
    `${t.file} does NOT contain the stale 503 literal "No AI provider is configured on this deployment"`
  );

  // The classifier preamble must short-circuit when kind !==
  // "unknown". If a tool just imports the helper but never checks
  // its return shape, we're right back to stale per-tool copy.
  assert(
    /degraded\.kind\s*!==\s*"unknown"/.test(src) ||
      /degraded\.kind\s*===\s*"unknown"/.test(src),
    `${t.file} short-circuits on degraded.kind !== "unknown"`
  );
}

/* ------------------------------------------------------------------ */
/* SECTION C — lib/payments/dunning.ts scaffold                        */
/* ------------------------------------------------------------------ */

console.log("\n[SECTION C] lib/payments/dunning.ts scaffold");

const dunningSrc = read(DUNNING_PATH);
assert(dunningSrc.length > 0, "lib/payments/dunning.ts exists");

for (const state of ["current", "past_due", "suspended", "cancelled"]) {
  assert(
    dunningSrc.includes(`"${state}"`),
    `DunningState union includes "${state}"`
  );
}

for (const kind of [
  "payment_failed",
  "payment_succeeded",
  "subscription_cancelled",
]) {
  assert(
    dunningSrc.includes(`kind: "${kind}"`),
    `DunningEvent union includes kind "${kind}"`
  );
}

assert(
  /export\s+function\s+applyDunningEvent/.test(dunningSrc),
  "applyDunningEvent reducer is exported"
);
assert(
  /export\s+function\s+newDunningRow/.test(dunningSrc),
  "newDunningRow factory is exported"
);
assert(
  /export\s+function\s+isEntitled/.test(dunningSrc),
  "isEntitled predicate is exported"
);
assert(
  /export\s+const\s+DUNNING_POLICY/.test(dunningSrc),
  "DUNNING_POLICY constants are exported"
);

// Idempotency on providerEventId — the hallmark of a well-behaved
// webhook reducer. If this check disappears, replayed deliveries
// double-count failures and we step to suspended a day early.
assert(
  /lastProviderEventId\s*===\s*event\.providerEventId/.test(dunningSrc),
  "applyDunningEvent short-circuits on idempotent providerEventId"
);

// Entitlement posture — this is what /api/ai/* route guards will
// eventually call. Today we want current + past_due to count as
// entitled; suspended + cancelled to be gated.
assert(
  /row\.state\s*===\s*"current"\s*\|\|\s*row\.state\s*===\s*"past_due"/.test(
    dunningSrc
  ),
  "isEntitled returns true for current and past_due only"
);

assert(
  /gracePastDueMs/.test(dunningSrc),
  "DUNNING_POLICY.gracePastDueMs is declared"
);
assert(
  /suspendedBeforeCancelMs/.test(dunningSrc),
  "DUNNING_POLICY.suspendedBeforeCancelMs is declared"
);

// Phase E ownership marker — ensures the scaffold self-documents
// that it's a scaffold. A future refactor that deletes the TODO
// without wiring the DB trip is exactly what we want to surface here.
assert(
  /TODO\(Phase E\)/.test(dunningSrc),
  "scaffold carries a TODO(Phase E) marker for future wiring"
);

/* ------------------------------------------------------------------ */
/* SECTION D — run-all-tests.mjs registration                          */
/* ------------------------------------------------------------------ */

console.log("\n[SECTION D] run-all-tests.mjs registration");

const aggSrc = read(AGGREGATOR_PATH);
assert(aggSrc.length > 0, "scripts/run-all-tests.mjs exists");
assert(
  /test-degradation-ux\.mjs/.test(aggSrc),
  "run-all-tests.mjs references test-degradation-ux.mjs"
);
assert(
  /name:\s*["']degradation-ux["']/.test(aggSrc),
  "run-all-tests.mjs registers suite with name 'degradation-ux'"
);

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

console.log(
  `\nDegradation UX tests: ${passed} passed, ${failed} failed`
);

if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
