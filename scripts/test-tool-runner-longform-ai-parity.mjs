#!/usr/bin/env node
/**
 * 2026-05-01 — ToolRunnerLongform AI/free differentiator parity guard.
 *
 * Background: ToolRunnerLongform is the shared longform component that
 * every tool runner page (free + AI) renders below the runner UI. It
 * contains a "What makes pdfcraft ai different" block and a how-it-works
 * subtitle. Until commit add9175, both blocks were hardcoded for free
 * tools — they claimed "100% local processing... never touches our
 * infrastructure" and "no signup, no daily limit," both flatly false
 * for AI tools (which POST the file to OpenAI/Anthropic via /api/ai/*
 * and require auth + credits).
 *
 * The fix branches both blocks on an `isAI` prop. The calling page
 * passes `isAI={!tool.free}`. AI tools render AI_DIFFERENTIATORS +
 * AI-aware subtitle; free tools render FREE_DIFFERENTIATORS + the
 * existing PDFium-local subtitle.
 *
 * What this guard catches: a future contributor introducing a new
 * shared content block in ToolRunnerLongform without wiring an AI
 * variant — the same class of bug that produced the original false
 * "100% local" claim on every AI tool runner.
 *
 * Approach: pure static parse of the source file (sub-second, no
 * runtime needed). Asserts:
 *   - Both FREE_DIFFERENTIATORS + AI_DIFFERENTIATORS exist
 *   - Each array has >= 4 entries (catches "I deleted the AI version")
 *   - isAI is in the prop signature with a default
 *   - isAI is consumed in the component body (catches dead-prop bug)
 *   - The two differentiator arrays share NO titles (no copy drift)
 *   - The hardcoded "no signup, no uploads" subtitle was branched
 *
 * Plus a parity check on the call site (app/tool/[id]/page.tsx): the
 * <ToolRunnerLongform> JSX element must pass `isAI=` so AI tools
 * actually receive the right variant. A component fix that wasn't
 * wired through the call site would silently regress to the old
 * dishonest behaviour.
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

const COMPONENT_PATH = path.join(
  ROOT,
  "components/marketing/ToolRunnerLongform.tsx",
);
const PAGE_PATH = path.join(ROOT, "app/tool/[id]/page.tsx");

assert(
  fs.existsSync(COMPONENT_PATH),
  `ToolRunnerLongform.tsx missing at ${COMPONENT_PATH}`,
);
assert(
  fs.existsSync(PAGE_PATH),
  `app/tool/[id]/page.tsx missing at ${PAGE_PATH}`,
);

// Bail early if the component file is gone — every other assertion
// would cascade-fail and obscure the real signal.
if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  console.log(
    `tool-runner-longform-ai-parity: ${passed} passed, ${failed} failed`,
  );
  process.exit(1);
}

const COMPONENT_SRC = fs.readFileSync(COMPONENT_PATH, "utf8");
const PAGE_SRC = fs.readFileSync(PAGE_PATH, "utf8");

// ---------------------------------------------------------------------
// Section A — both differentiator arrays exist and are non-trivial.
// ---------------------------------------------------------------------

assert(
  /const\s+FREE_DIFFERENTIATORS\s*:\s*Array<\[string,\s*string\]>\s*=\s*\[/.test(
    COMPONENT_SRC,
  ),
  "FREE_DIFFERENTIATORS const not found with expected signature " +
    "`const FREE_DIFFERENTIATORS: Array<[string, string]> = [...]`",
);

assert(
  /const\s+AI_DIFFERENTIATORS\s*:\s*Array<\[string,\s*string\]>\s*=\s*\[/.test(
    COMPONENT_SRC,
  ),
  "AI_DIFFERENTIATORS const not found with expected signature " +
    "`const AI_DIFFERENTIATORS: Array<[string, string]> = [...]`",
);

// Extract each array body so we can count + cross-check.
function extractArrayEntries(src, constName) {
  const startRe = new RegExp(
    `const\\s+${constName}\\s*:\\s*Array<\\[string,\\s*string\\]>\\s*=\\s*\\[`,
  );
  const m = startRe.exec(src);
  if (!m) return null;
  // Walk forward, balancing brackets, until the matching ] at depth 0.
  let depth = 1;
  let i = m.index + m[0].length;
  let body = "";
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) break;
    }
    body += c;
    i++;
  }
  // Each entry is `[ "title", "body..." ],`. Match the title strings.
  const titleRe = /\[\s*"((?:[^"\\]|\\.)*)"\s*,/g;
  const titles = [];
  let tm;
  while ((tm = titleRe.exec(body)) !== null) {
    titles.push(tm[1]);
  }
  return titles;
}

const freeTitles = extractArrayEntries(COMPONENT_SRC, "FREE_DIFFERENTIATORS");
const aiTitles = extractArrayEntries(COMPONENT_SRC, "AI_DIFFERENTIATORS");

assert(
  freeTitles && freeTitles.length >= 4,
  `FREE_DIFFERENTIATORS needs >= 4 entries; got ${freeTitles ? freeTitles.length : "null"}.`,
);
assert(
  aiTitles && aiTitles.length >= 4,
  `AI_DIFFERENTIATORS needs >= 4 entries; got ${aiTitles ? aiTitles.length : "null"}. ` +
    "Don't ship the AI suite with fewer differentiators than the free suite — it reads as a downgrade.",
);

// ---------------------------------------------------------------------
// Section B — no overlap between the two title lists.
// ---------------------------------------------------------------------
//
// The whole point of this fix is that AI and free tools differentiate
// on different things. Sharing a title across both lists would either
// re-introduce dishonesty (if a free-only claim sneaks back into AI)
// or signal that the lists have drifted into vague generic copy.

if (freeTitles && aiTitles) {
  const overlap = freeTitles.filter((t) => aiTitles.includes(t));
  assert(
    overlap.length === 0,
    `FREE_DIFFERENTIATORS and AI_DIFFERENTIATORS share ${overlap.length} title(s): ${JSON.stringify(overlap)}. ` +
      "These should NOT overlap — free vs AI tools differentiate on different things, " +
      "and shared titles indicate either copy drift or a free-only claim leaking back into AI.",
  );
}

// ---------------------------------------------------------------------
// Section C — isAI prop is in the component signature with a default.
// ---------------------------------------------------------------------

assert(
  /isAI\s*\?\s*:\s*boolean/.test(COMPONENT_SRC),
  "isAI prop missing or not optional. Expected `isAI?: boolean` in the " +
    "component prop type so existing free-tool call sites that don't pass it keep working.",
);

assert(
  /isAI\s*=\s*false/.test(COMPONENT_SRC),
  "isAI default value not found. Expected `isAI = false` in the " +
    "destructured props so omitting the prop renders the free-tool variant.",
);

// ---------------------------------------------------------------------
// Section D — isAI is actually consumed in the render body.
// ---------------------------------------------------------------------
//
// Catches the "added the prop, forgot to use it" dead-prop bug. The
// branch should produce both `differentiators` (used for the bullet
// list) and a how-works subtitle. We assert the conditional expressions
// reference isAI directly.

assert(
  /isAI\s*\?\s*AI_DIFFERENTIATORS\s*:\s*FREE_DIFFERENTIATORS/.test(
    COMPONENT_SRC,
  ),
  "Differentiator branch not found. Expected `isAI ? AI_DIFFERENTIATORS : FREE_DIFFERENTIATORS` " +
    "to select which list renders.",
);

// 2026-05-08: original required "deleted in 60 minutes" copy. Updated
// this session to "zero retention — files never persisted on our
// servers" which is more accurate (per ground truth: AI files are
// processed in memory, never persisted). The invariant being tested
// is "AI subtitle is branched + differs from free + accurately
// describes the AI flow." Accept either the legacy 60-minutes copy
// OR the new zero-retention copy.
assert(
  /isAI\s*\n?\s*\?\s*"[^"]*(deleted in 60 minutes|zero retention|never persisted)[^"]*"/.test(
    COMPONENT_SRC,
  ),
  "How-it-works subtitle isn't branched on isAI. The original copy " +
    "'Three steps, no signup, no uploads.' is false for AI tools. Expected " +
    "an `isAI ? '...60 minutes... | zero retention | never persisted...' : " +
    "'...no signup, no uploads...'` ternary.",
);

// ---------------------------------------------------------------------
// Section E — the false-on-AI subtitle is no longer rendered unconditionally.
// ---------------------------------------------------------------------
//
// If the subtitle is still hardcoded as the JSX child, the branch above
// might exist but be unused. Confirm the JSX uses a variable, not the
// literal string.

const literalUnconditional =
  /\{\/\*[^*]*\*\/\}\s*Three steps, no signup, no uploads\./;
assert(
  !literalUnconditional.test(COMPONENT_SRC) &&
    /\{howWorksSubtitle\}/.test(COMPONENT_SRC),
  "Found the literal 'Three steps, no signup, no uploads.' rendered " +
    "unconditionally in JSX. The branch should produce a variable " +
    "(e.g. `howWorksSubtitle`) consumed via `{howWorksSubtitle}`. " +
    "If the literal is anywhere outside a comment or string assignment, the AI variant is dead code.",
);

// ---------------------------------------------------------------------
// Section F — the call site passes isAI to ToolRunnerLongform.
// ---------------------------------------------------------------------
//
// A perfect component fix is useless if the page renders
// `<ToolRunnerLongform data={...} />` without passing isAI — every
// AI tool would silently fall back to the (free-only) default.

assert(
  /<ToolRunnerLongform[^>]*isAI=\{!tool\.free\}/.test(PAGE_SRC),
  "app/tool/[id]/page.tsx doesn't pass `isAI={!tool.free}` to <ToolRunnerLongform>. " +
    "Without this, every AI tool runner falls back to the free-tool default and " +
    "re-introduces the false '100% local processing' / 'no signup' claims.",
);

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
}

console.log(
  `tool-runner-longform-ai-parity: ${passed} passed, ${failed} failed`,
);
process.exit(failed > 0 ? 1 : 0);
