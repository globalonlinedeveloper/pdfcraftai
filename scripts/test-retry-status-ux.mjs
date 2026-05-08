#!/usr/bin/env node
/**
 * 2026-05-08 — Item #5 from the improvement analysis: loading state
 * polish. Specifically — wire `fetchAiWithRetry`'s `onAttempt`
 * callback into the AI tool runners' busy-state UI so a transient
 * 5xx that triggers a retry doesn't read as a frozen
 * "Summarizing…" button for 7 seconds (1s + 2s + 4s backoff).
 *
 * SummarizePdfTool ships as the canary; other 9 AI tool runners
 * follow the same pattern in a follow-up sweep.
 *
 * What this guard catches:
 *   - retryAttempt + retryMax state stripped out (would silence
 *     the retry indicator)
 *   - onAttempt wiring removed from the fetchAiWithRetry call
 *     (would leave the state always 0)
 *   - Reset-in-finally dropped (state would persist after
 *     completion, showing stale "Retrying… (3/3)" forever)
 *   - Button label conditional reverted to busy-only (would lose
 *     the "Retrying… (n/m)" affordance)
 *   - aria-busy attribute dropped (assistive tech wouldn't
 *     announce the in-flight state)
 *
 * Pure static parse. Sub-second.
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

const TOOL_PATH = path.join(ROOT, "components/tools/SummarizePdfTool.tsx");
assert(fs.existsSync(TOOL_PATH), `SummarizePdfTool missing at ${TOOL_PATH}`);

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  console.log(`retry-status-ux: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

const SRC = fs.readFileSync(TOOL_PATH, "utf8");

// ---------------------------------------------------------------------
// Section A — retryAttempt + retryMax state declared.
// ---------------------------------------------------------------------

assert(
  /const\s+\[retryAttempt\s*,\s*setRetryAttempt\]\s*=\s*useState\(\s*0\s*\)/.test(
    SRC,
  ),
  "retryAttempt state must be declared as `useState(0)`. The 0 " +
    "default is what makes the button label show 'Summarize' on the " +
    "normal first-attempt path (only flips to 'Retrying…' when " +
    "attempt > 1).",
);

assert(
  /const\s+\[retryMax\s*,\s*setRetryMax\]\s*=\s*useState\(\s*0\s*\)/.test(SRC),
  "retryMax state must be declared as `useState(0)`. Used to render " +
    "the denominator in 'Retrying… (n/m)'.",
);

// ---------------------------------------------------------------------
// Section B — onAttempt wired into fetchAiWithRetry.
// ---------------------------------------------------------------------

assert(
  /onAttempt:\s*\(attempt\s*,\s*max\)\s*=>/.test(SRC),
  "fetchAiWithRetry call must include `onAttempt: (attempt, max) => ...`. " +
    "Without this, the retry happens silently and the button stays " +
    "frozen at 'Summarizing…' for the full backoff window.",
);

assert(
  /if\s*\(\s*attempt\s*>\s*1\s*\)\s*\{[\s\S]{0,120}setRetryAttempt\(attempt\)/.test(
    SRC,
  ),
  "onAttempt callback must gate setRetryAttempt on `attempt > 1`. " +
    "The first attempt is the normal path; setting state on attempt=1 " +
    "would briefly show 'Retrying… (1/3)' which is confusing.",
);

// ---------------------------------------------------------------------
// Section C — reset in finally block.
// ---------------------------------------------------------------------

assert(
  /finally\s*\{[\s\S]*?setBusy\(false\);[\s\S]*?setRetryAttempt\(0\);[\s\S]*?setRetryMax\(0\);[\s\S]*?\}/.test(
    SRC,
  ),
  "finally block must reset BOTH retryAttempt AND retryMax to 0 " +
    "alongside setBusy(false). Without the reset, the button keeps " +
    "showing the last 'Retrying… (3/3)' label even after the op " +
    "completes.",
);

// ---------------------------------------------------------------------
// Section D — button label uses the conditional ladder.
// ---------------------------------------------------------------------
//
// Required ladder: retryAttempt > 0 → "Retrying… (n/m)"; busy → "Summarizing…";
// idle → "Summarize". Order matters: retry takes priority over busy
// because the user needs the more-specific signal during a retry.

assert(
  /retryAttempt\s*>\s*0\s*\?\s*`Retrying… \(\$\{retryAttempt\}\/\$\{retryMax\}\)`\s*:\s*busy\s*\?\s*"Summarizing…"\s*:\s*"Summarize"/.test(
    SRC,
  ),
  "Button label must use the ladder " +
    "`retryAttempt > 0 ? \\`Retrying… (\\${retryAttempt}/\\${retryMax})\\` " +
    ": busy ? \"Summarizing…\" : \"Summarize\"`. The retry branch " +
    "comes FIRST because during a retry the user needs the more-" +
    "specific signal — busy alone would just show 'Summarizing…'.",
);

// ---------------------------------------------------------------------
// Section E — aria-busy attribute on the button.
// ---------------------------------------------------------------------

assert(
  /aria-busy=\{busy\}/.test(SRC),
  "Button must include `aria-busy={busy}` so assistive tech " +
    "announces the in-flight state. Without it, screen-reader users " +
    "have no signal that the click did anything.",
);

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
}

console.log(`retry-status-ux: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
