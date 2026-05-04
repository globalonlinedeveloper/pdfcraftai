#!/usr/bin/env node
/**
 * 2026-05-04 — T2-5 capExceeded wire-up contract guard.
 *
 * Locks in the 4-layer chain shipped at commits 8d47400 + 9f8bf07
 * (post-Gap-#2-Option-A activation):
 *
 *   spendCredits → 402 response body → tool error string [trial-cap]
 *   marker → OutOfCreditsAlert capExceeded prop → friendlier heading.
 *
 * If any layer drops the capExceeded flag, free-trial users hitting
 * the per-op cap fall back to the misleading "Not enough credits /
 * you have 0" copy instead of the explanatory "Free trial cap reached
 * on this tool" copy. The bug is silent — the 402 still fires, the
 * upsell card still renders, the user just sees confusing wording.
 * This guard catches regressions at build time.
 *
 * 5 sections:
 *   A. OutOfCreditsAlert — exports the helper + accepts the prop
 *   B. AI route handlers — all 10 thread capExceeded into 402 body
 *   C. Tool components — all 9 import the helper + emit the marker
 *      + pass capExceeded={isCapExceededError(error ?? "")} prop
 *   D. spendCredits → SpendCreditsResult union still has capExceeded?
 *      (catches accidental removal upstream)
 *   E. Forward-compat — capExceeded is OPTIONAL everywhere, so
 *      existing consumers continue to type-check without changes
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

const ALERT_PATH = path.join(
  ROOT,
  "components",
  "upsell",
  "OutOfCreditsAlert.tsx",
);
const CREDITS_PATH = path.join(ROOT, "lib", "ai", "credits.ts");

const AI_ROUTES = [
  "summarize",
  "translate",
  "rewrite",
  "table",
  "compare",
  "generate",
  "sign",
  "redact",
  "ocr",
  "chat",
];

const TOOL_COMPONENTS = [
  "SummarizePdfTool",
  "TranslatePdfTool",
  "RewritePdfTool",
  "TableExtractTool",
  "ComparePdfTool",
  "GeneratePdfTool",
  "SignPdfTool",
  "RedactPdfTool",
  "OcrPdfTool",
];

// ============================================================================
// Section A — OutOfCreditsAlert exports helper + accepts prop
// ============================================================================

const alertSrc = fs.readFileSync(ALERT_PATH, "utf8");

assert(
  /export\s+function\s+isCapExceededError\s*\(/.test(alertSrc),
  "A1: isCapExceededError function exported from OutOfCreditsAlert",
);
assert(
  /\[trial-cap\]/.test(alertSrc),
  "A2: detector helper anchors on the [trial-cap] marker token",
);
assert(
  /capExceeded\?:\s*boolean/.test(alertSrc),
  "A3: OutOfCreditsAlertProps accepts optional capExceeded?: boolean",
);
assert(
  /Free trial cap reached on this tool/.test(alertSrc),
  "A4: friendlier heading copy 'Free trial cap reached on this tool' present",
);
// Match either plain apostrophe or HTML-entity apostrophe (&apos; or &#39;).
// The JSX renderer escapes literal "don't" → "don&apos;t" in the source.
assert(
  /paid credits don.{1,8}t have a per-tool cap/i.test(alertSrc),
  "A5: body explains paid credits bypass the cap (motivates upsell)",
);
// isInsufficientCreditsError must STILL match both standard + cap variants —
// otherwise the alert won't render when capExceeded fires.
assert(
  /isInsufficientCreditsError[\s\S]{0,400}\[trial-cap\]/.test(alertSrc),
  "A6: isInsufficientCreditsError matches BOTH standard 'not enough credits' AND [trial-cap] marker",
);

// ============================================================================
// Section B — All 10 AI route handlers thread capExceeded into 402 body
// ============================================================================

for (const op of AI_ROUTES) {
  const p = path.join(ROOT, "app", "api", "ai", op, "route.ts");
  assert(fs.existsSync(p), `B0.${op}: app/api/ai/${op}/route.ts exists`);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, "utf8");
  assert(
    /capExceeded:\s*spend\.capExceeded\s*\?\?\s*false/.test(src),
    `B1.${op}: 402 response threads 'capExceeded: spend.capExceeded ?? false' (drop this line and the friendlier copy disappears even when the cap fires)`,
  );
}

// ============================================================================
// Section C — Tool components import helper + emit [trial-cap] marker
// ============================================================================

for (const tool of TOOL_COMPONENTS) {
  const p = path.join(ROOT, "components", "tools", `${tool}.tsx`);
  assert(fs.existsSync(p), `C0.${tool}: ${tool}.tsx exists`);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, "utf8");
  assert(
    /isCapExceededError/.test(src),
    `C1.${tool}: imports isCapExceededError from OutOfCreditsAlert`,
  );
  assert(
    /\[trial-cap\]/.test(src),
    `C2.${tool}: 402 formatter embeds [trial-cap] marker token when body.capExceeded === true`,
  );
  assert(
    /capExceeded={isCapExceededError\(error\s*\?\?\s*""\)}/.test(src),
    `C3.${tool}: <OutOfCreditsAlert capExceeded={isCapExceededError(error ?? "")} /> prop wire-in (the ?? "" guards null-typed error)`,
  );
  assert(
    /body\.capExceeded\s*===\s*true/.test(src),
    `C4.${tool}: 402 formatter checks 'body.capExceeded === true' before emitting marker (strict-equals avoids accidental truthy match)`,
  );
}

// ============================================================================
// Section D — spendCredits result union still has capExceeded? marker
// ============================================================================

const creditsSrc = fs.readFileSync(CREDITS_PATH, "utf8");

assert(
  /capExceeded\?\:\s*true/.test(creditsSrc),
  "D1: SpendCreditsResult union still has 'capExceeded?: true' on insufficient variant — accidental removal would silently break the entire chain",
);
assert(
  /import\s*\{\s*checkPerOpBonusCap\s*\}/.test(creditsSrc),
  "D2: checkPerOpBonusCap still imported (Gap #2 helper that produces the flag)",
);
// The cap check must run BEFORE the balance probe — see Gap #2 commit
// 4f3a4c7. Already locked in by per-op-bonus-cap guard B6 but mirrored
// here for defense in depth.
const capCheckIdx = creditsSrc.search(
  /const\s+capCheck\s*=\s*await\s+checkPerOpBonusCap/,
);
const balanceProbeIdx = creditsSrc.search(
  /const\s+\[row\]\s*=\s*await\s+db\s*\.select\(\s*\{\s*balance/,
);
assert(
  capCheckIdx > 0 && balanceProbeIdx > 0 && capCheckIdx < balanceProbeIdx,
  "D3: cap check runs BEFORE balance probe (otherwise pool credits always satisfy the balance check and the cap never fires; mirrored from per-op-bonus-cap guard B6)",
);

// ============================================================================
// Section E — Forward-compat: capExceeded is OPTIONAL everywhere
// ============================================================================

assert(
  /capExceeded\?:/.test(alertSrc),
  "E1: OutOfCreditsAlert prop is OPTIONAL (existing callers without the prop continue to compile)",
);
assert(
  /capExceeded\?\:\s*true/.test(creditsSrc),
  "E2: SpendCreditsResult capExceeded is OPTIONAL (existing route handlers without the field continue to compile)",
);
// The error ?? "" pattern in tool components handles error: string | null.
// If anyone removes the ?? guard, TS catches it (caught during T2-5 itself
// via tsc — see commit message). This guard locks the pattern in.
assert(
  /isCapExceededError\(error\s*\?\?\s*""\)/.test(
    fs.readFileSync(
      path.join(ROOT, "components", "tools", "SummarizePdfTool.tsx"),
      "utf8",
    ),
  ),
  "E3: SummarizePdfTool uses 'isCapExceededError(error ?? \"\")' null-safe pattern as reference impl (sample check; C3 covers all 9 components)",
);

// ============================================================================
// Output
// ============================================================================

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`cap-exceeded-wireup: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
