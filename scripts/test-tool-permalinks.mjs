#!/usr/bin/env node
/**
 * 2026-05-08 — Item #17 from the improvement analysis: tool sharing
 * permalinks. SummarizePdfTool ships as the canary — depth state
 * syncs bidirectionally with `?depth=` in the URL, so users can
 * share `/tool/ai-summarize?depth=detailed` and a collaborator
 * lands on the right preset.
 *
 * What this guard catches:
 *   - URL → state sync removed (URL becomes informational, not
 *     bidirectional — link sharing breaks)
 *   - State → URL sync removed (UI clicks don't update the URL,
 *     defeating the share affordance)
 *   - history.replaceState swapped for pushState (would create a
 *     history entry per click — Back-button hell)
 *   - URL allowlist loosened (would let unsafe values into the
 *     `?depth=` filter — TS would catch a string-literal type
 *     error today, but the run-time guard is belt-and-braces)
 *   - Default value "standard" leaks into URL ("?depth=standard"
 *     bloats the bare path for the most common case)
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
  console.log(`tool-permalinks: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

const SRC = fs.readFileSync(TOOL_PATH, "utf8");

// ---------------------------------------------------------------------
// Section A — URL → state sync on mount.
// ---------------------------------------------------------------------

assert(
  /URLSearchParams\(window\.location\.search\)/.test(SRC),
  "URL → state sync must read `URLSearchParams(window.location.search)` " +
    "on mount. Without this, opening a `?depth=detailed` link lands on " +
    "the default state — link sharing is purely informational, not " +
    "actionable.",
);

assert(
  /params\.get\("depth"\)/.test(SRC),
  "Mount-effect must call `params.get(\"depth\")` to read the saved " +
    "depth from the URL.",
);

// Allowlist — exactly the three Depth literals. Loosening to a generic
// "if (raw)" branch would let URL-injected garbage flow into setDepth
// (TS would catch that today via the literal-typed Depth, but the
// run-time guard is belt-and-braces against future type drift).
assert(
  /raw\s*===\s*"tldr"\s*\|\|\s*raw\s*===\s*"standard"\s*\|\|\s*raw\s*===\s*"detailed"/.test(
    SRC,
  ),
  "URL parser must whitelist the three Depth values explicitly: " +
    "`raw === \"tldr\" || raw === \"standard\" || raw === \"detailed\"`. " +
    "Anything looser lets URL-injected garbage flow into setDepth.",
);

// ---------------------------------------------------------------------
// Section B — state → URL sync on change.
// ---------------------------------------------------------------------

assert(
  /useEffect\(\(\)\s*=>\s*\{[\s\S]*?history\.replaceState[\s\S]*?\},\s*\[depth\]\)/.test(
    SRC,
  ),
  "depth → URL sync must live in a `useEffect(() => { ... history." +
    "replaceState(...) }, [depth])` so URL updates whenever depth " +
    "changes via UI clicks. The [depth] dep is what makes it " +
    "reactive; an empty dep array (mount-only) would make the URL " +
    "stick at the initial value.",
);

assert(
  /history\.replaceState/.test(SRC),
  "URL sync must use `history.replaceState`. `pushState` would " +
    "create a back-stack entry per click — Back-button hell on a " +
    "tool runner.",
);

// Negative — must NOT use pushState for the URL sync. Check that
// pushState doesn't appear in the depth-sync useEffect block.
const depthEffectMatch = SRC.match(
  /useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[depth\]\)/,
);
if (depthEffectMatch) {
  assert(
    !/pushState/.test(depthEffectMatch[1]),
    "depth-sync effect uses pushState — would clutter back history " +
      "with one entry per click. Use replaceState.",
  );
}

// ---------------------------------------------------------------------
// Section C — default value omitted from URL.
// ---------------------------------------------------------------------
//
// Most users hit /tool/ai-summarize without any param and see the
// default ("standard"). Writing "?depth=standard" back into the URL
// for the default would bloat the bare path for the most common case
// — uglier share-able URLs and noisier bookmarks.

assert(
  /depth\s*===\s*"standard"\s*\)\s*\{\s*params\.delete\("depth"\)/.test(SRC),
  "Default value must be omitted from the URL: " +
    "`if (depth === \"standard\") params.delete(\"depth\")`. Without " +
    "the delete branch, the URL ends up with `?depth=standard` for " +
    "the most common case.",
);

// ---------------------------------------------------------------------
// Section D — SSR safety.
// ---------------------------------------------------------------------

assert(
  /typeof window === "undefined"/.test(SRC),
  "Permalink effects must guard `typeof window === \"undefined\"` so " +
    "they no-op during SSR. Without this, hydration crashes on " +
    "ReferenceError: window is not defined.",
);

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
}

console.log(`tool-permalinks: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
