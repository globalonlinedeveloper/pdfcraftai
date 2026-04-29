#!/usr/bin/env node
// scripts/test-tool-runner-coverage.mjs
//
// M24 follow-up (2026-04-29): catch tool-dispatcher drift at CI time.
//
// After the M24 code-split, the per-tool dispatch lives in
// components/tools/ToolRunner.tsx as a `switch (id)` returning
// dynamic-imported components. Three places hold related state:
//
//   1. lib/tools.ts — TOOLS array ({ id, name, ... } registry)
//   2. app/tool/[id]/page.tsx — LIVE_TOOL_IDS Set (which ids skip
//      the "Coming Soon" placeholder)
//   3. components/tools/ToolRunner.tsx — switch cases (which ids
//      actually render a runner component)
//
// The bug pattern: a tool gets registered in (1) and added to (2),
// but the developer forgets the case in (3). Result: the page
// renders all the chrome (header, longform, FAQ, related tools) but
// the runner area is BLANK because <ToolRunner /> falls through to
// `default: return null`. Worse than the "Coming Soon" placeholder
// because it looks like the tool just broke.
//
// This test pins the invariant:
//   For every id in TOOLS that's also in LIVE_TOOL_IDS, ToolRunner
//   must have `case "<id>": return <ComponentName />;`.
//
// It also reports two harmless-but-cleanable conditions:
//   a) LIVE_TOOL_IDS entries not in TOOLS — dead zombies that the
//      page never reaches (toolById() returns undefined → notFound()
//      fires before LIVE_TOOL_IDS is consulted). Test passes but
//      flags them as warnings.
//   b) TOOLS entries not in LIVE_TOOL_IDS — these are intentional
//      "Coming Soon" tools. Test passes silently.
//
// Run: `node scripts/test-tool-runner-coverage.mjs`
// Exits 0 on pass, 1 on any failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const TOOLS_SRC = readFileSync(resolve(ROOT, "lib", "tools.ts"), "utf8");
const PAGE_SRC = readFileSync(
  resolve(ROOT, "app", "tool", "[id]", "page.tsx"),
  "utf8",
);
const RUNNER_SRC = readFileSync(
  resolve(ROOT, "components", "tools", "ToolRunner.tsx"),
  "utf8",
);

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail) {
  if (cond) pass += 1;
  else {
    fail += 1;
    failures.push({ label, detail: detail ?? "" });
  }
}

// --------------------------------------------------------------------
// Extract tool ids from each source.
// --------------------------------------------------------------------

// TOOLS array — match `{ id: "..." ` at start of an entry.
const toolsIds = new Set(
  [...TOOLS_SRC.matchAll(/^\s*\{\s*id:\s*"([a-z0-9-]+)"/gm)].map((m) => m[1]),
);

// LIVE_TOOL_IDS — pull every quoted id between the Set opening and `])`.
const liveBlockMatch = PAGE_SRC.match(
  /LIVE_TOOL_IDS\s*=\s*new\s+Set<string>\(\[([\s\S]*?)\]\)/,
);
if (!liveBlockMatch) {
  console.error("FATAL: LIVE_TOOL_IDS block not found in page.tsx");
  process.exit(2);
}
const liveIds = new Set(
  [...liveBlockMatch[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]),
);

// ToolRunner switch cases.
const switchIds = new Set(
  [...RUNNER_SRC.matchAll(/case\s+"([a-z0-9-]+)"\s*:/g)].map((m) => m[1]),
);

assert(
  "TOOLS array parses non-empty",
  toolsIds.size > 50,
  `Expected >50 tools registered; found ${toolsIds.size}. The regex may have broken if tools.ts shape changed.`,
);
assert(
  "LIVE_TOOL_IDS parses non-empty",
  liveIds.size > 50,
  `Expected >50 live ids; found ${liveIds.size}. Either the Set shape changed or the test regex needs updating.`,
);
assert(
  "ToolRunner switch parses non-empty",
  switchIds.size > 50,
  `Expected >50 switch cases; found ${switchIds.size}. Either the dispatcher was deleted or the case-extraction regex is wrong.`,
);

// --------------------------------------------------------------------
// Core invariant: every TOOLS id ∩ LIVE_TOOL_IDS must have a
// switch case.
// --------------------------------------------------------------------

const liveRegistered = new Set(
  [...toolsIds].filter((id) => liveIds.has(id)),
);
const missingFromSwitch = [...liveRegistered].filter(
  (id) => !switchIds.has(id),
);

assert(
  "Every live registered tool has a ToolRunner switch case",
  missingFromSwitch.length === 0,
  missingFromSwitch.length === 0
    ? ""
    : `These tools are registered in TOOLS and in LIVE_TOOL_IDS but ` +
        `have no case in components/tools/ToolRunner.tsx — visiting ` +
        `their /tool/{id} page will render a blank tool body (the ` +
        `dispatcher falls through to default: return null). Either ` +
        `add a switch case mapping the id to a component, or remove ` +
        `the id from LIVE_TOOL_IDS so the page renders the "Coming ` +
        `Soon" placeholder instead.\n\n  Missing: ${missingFromSwitch.join(", ")}`,
);

// --------------------------------------------------------------------
// Soft cleanup signals (warnings — pass test, surface in output).
// --------------------------------------------------------------------

// LIVE_TOOL_IDS entries that aren't in TOOLS — dead orphans. Harmless
// (toolById() returns undefined → notFound() before LIVE check) but
// stale.
const liveOrphans = [...liveIds].filter((id) => !toolsIds.has(id));
if (liveOrphans.length > 0) {
  console.log("");
  console.log(
    `WARNING: ${liveOrphans.length} ids in LIVE_TOOL_IDS are not in TOOLS:`,
  );
  for (const id of liveOrphans.sort()) console.log(`  - "${id}"`);
  console.log(
    `  These never affect rendering (toolById() returns undefined → notFound() ` +
      `\n  fires before the LIVE check). They're stale entries safe to remove from ` +
      `\n  LIVE_TOOL_IDS in app/tool/[id]/page.tsx.`,
  );
}

// Switch cases not in LIVE_TOOL_IDS — would render "Coming Soon" instead
// of the wired runner. Looks like a bug only if the tool exists in TOOLS.
const switchOnlyInRegistered = [...switchIds].filter(
  (id) => toolsIds.has(id) && !liveIds.has(id),
);
if (switchOnlyInRegistered.length > 0) {
  console.log("");
  console.log(
    `WARNING: ${switchOnlyInRegistered.length} switch cases handle ids ` +
      `that ARE in TOOLS but NOT in LIVE_TOOL_IDS:`,
  );
  for (const id of switchOnlyInRegistered.sort()) console.log(`  - "${id}"`);
  console.log(
    `  These tools have a runner wired up but the page renders "Coming Soon" ` +
      `\n  because LIVE_TOOL_IDS gates the runner area. Either add to ` +
      `\n  LIVE_TOOL_IDS or remove the switch case.`,
  );
}

// --------------------------------------------------------------------
// Report
// --------------------------------------------------------------------

const total = pass + fail;
console.log("");
if (fail > 0) {
  console.log("FAILURES:");
  for (const f of failures) {
    console.log(`  ✗ ${f.label}`);
    if (f.detail) {
      for (const line of f.detail.split("\n")) console.log(`      ${line}`);
    }
  }
  console.log("");
}
// Final line MUST match the aggregator's tail parser.
console.log(
  `test-tool-runner-coverage: ${pass} passed, ${fail} failed (of ${total})`,
);
process.exit(fail > 0 ? 1 : 0);
