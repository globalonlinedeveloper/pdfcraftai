#!/usr/bin/env node
/**
 * 2026-05-08 — Item #8 from the improvement analysis: inline tool
 * explainers. SummarizePdfTool ships as the canary; other 30+
 * tool runners follow the same pattern in a follow-up sweep.
 *
 * What this guard catches:
 *   - ToolHowItWorks component file deleted/renamed
 *   - Component reverts to a non-<details> implementation (would
 *     lose default keyboard-accessibility + screen-reader behavior)
 *   - Component drops the steps prop (the 3-step structure is the
 *     canonical form across all SEO landing pages)
 *   - Canary mount removed from SummarizePdfTool
 *   - Canary mount drops the privacyNote (zero-retention messaging
 *     is the load-bearing differentiator on the AI surface)
 *   - Steps array reduced below 3 (loses the canonical 3-step
 *     parity with /summarize-pdf landing page)
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

const COMP_PATH = path.join(ROOT, "components/tools/ToolHowItWorks.tsx");
const TOOL_PATH = path.join(ROOT, "components/tools/SummarizePdfTool.tsx");

assert(fs.existsSync(COMP_PATH), `ToolHowItWorks missing at ${COMP_PATH}`);
assert(fs.existsSync(TOOL_PATH), `SummarizePdfTool missing at ${TOOL_PATH}`);

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  console.log(`tool-how-it-works: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

const COMP_SRC = fs.readFileSync(COMP_PATH, "utf8");
const TOOL_SRC = fs.readFileSync(TOOL_PATH, "utf8");

// ---------------------------------------------------------------------
// Section A — component shape.
// ---------------------------------------------------------------------

assert(
  /export\s+function\s+ToolHowItWorks\s*\(/.test(COMP_SRC),
  "Named export `ToolHowItWorks` not found.",
);

assert(
  /<details/.test(COMP_SRC),
  "Component must use a native <details> element. Reimplementing " +
    "the collapse with useState would lose default keyboard " +
    "accessibility (Enter/Space toggle, screen-reader 'expanded/" +
    "collapsed' announcements).",
);

assert(
  /<summary/.test(COMP_SRC),
  "Component must use a <summary> as the toggle. <details> without " +
    "<summary> renders nothing for the click target.",
);

assert(
  /steps\s*:\s*Array<\s*\{\s*title\s*:\s*string;\s*body\s*:\s*string\s*\}\s*>/.test(
    COMP_SRC,
  ),
  "Props type must include `steps: Array<{ title: string; body: string }>`. " +
    "The 3-step shape is canonical across the SEO landing pages — " +
    "loosening the shape would let tools drift into 1-step or 5-step " +
    "explainers and the design language fragments.",
);

assert(
  /privacyNote\?\s*:\s*string/.test(COMP_SRC),
  "Props type must include optional `privacyNote?: string`. Zero-" +
    "retention messaging is load-bearing on the AI surface (items " +
    "#4, #22) — the explainer needs a place to surface it.",
);

// ---------------------------------------------------------------------
// Section B — SummarizePdfTool wires the canary.
// ---------------------------------------------------------------------

assert(
  /import\s*\{\s*ToolHowItWorks\s*\}\s*from\s*"\.\/ToolHowItWorks"/.test(
    TOOL_SRC,
  ),
  "SummarizePdfTool must import ToolHowItWorks. Without the import, " +
    "the canary mount below fails at compile time.",
);

assert(
  /<ToolHowItWorks[\s\S]*?steps=\{\[[\s\S]*?\]\}/.test(TOOL_SRC),
  "SummarizePdfTool must mount <ToolHowItWorks steps={[...]} />. " +
    "Pass exactly the 3-step canonical structure for parity with " +
    "/summarize-pdf landing.",
);

// Count the step entries — each is `{ title: ... }`. There must be
// at least 3 (the canonical structure across landing pages).
const stepsBlock = TOOL_SRC.match(
  /<ToolHowItWorks[\s\S]*?steps=\{(\[[\s\S]*?\])\}/,
);
const stepTitleCount = stepsBlock
  ? (stepsBlock[1].match(/title\s*:/g) || []).length
  : 0;
assert(
  stepTitleCount >= 3,
  `SummarizePdfTool's <ToolHowItWorks steps={[...]}> has ${stepTitleCount} ` +
    "step(s); minimum 3 to match the canonical 3-step structure used " +
    "across all /tool-name SEO landing pages. Loosening this lets " +
    "individual tool explainers drift away from the design language.",
);

assert(
  /<ToolHowItWorks[\s\S]*?privacyNote=/.test(TOOL_SRC),
  "SummarizePdfTool must pass the privacyNote prop. The canary's " +
    "whole point is showing tool-specific privacy messaging — without " +
    "it, future tool migrations might forget the prop entirely.",
);

assert(
  /privacyNote=["'][^"']*never persisted[^"']*["']|privacyNote=["'][^"']*Zero retention[^"']*["']/i.test(
    TOOL_SRC,
  ),
  "SummarizePdfTool's privacyNote must reference 'never persisted' or " +
    "'Zero retention'. These are the canonical zero-retention phrases " +
    "introduced in items #4 + #22; using a different formulation here " +
    "fragments the privacy story.",
);

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
}

console.log(`tool-how-it-works: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
