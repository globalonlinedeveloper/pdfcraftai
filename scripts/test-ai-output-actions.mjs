#!/usr/bin/env node
/**
 * 2026-05-08 — AI artifact copy / download actions regression guard.
 *
 * Background: /app/files/[id]/preview gained Copy markdown +
 * Download .md buttons in this commit so users can take their AI
 * output to Slack / Notion / disk. Without these, the page is view-
 * only — clipboard / file-save are essential exit ramps.
 *
 * What this guard catches:
 *   - Component file deleted or relocated (preview page would crash
 *     at import resolution, but TS catches that — what TS DOESN'T
 *     catch is a "let's simplify" refactor that drops one of the
 *     two buttons or swaps for a hostile API)
 *   - Copy switched to legacy `document.execCommand("copy")` which
 *     is deprecated, async-fails on cross-origin iframes, and won't
 *     work in some sandboxed-tab contexts. `navigator.clipboard` is
 *     the only correct API.
 *   - Download forgot to revoke the object URL (M6 invariant, asserted
 *     by scripts/test-objecturl-revocation.mjs at the audit level —
 *     this guard pins the local-shape invariant tighter)
 *   - Page stops passing one of the four required props (kind /
 *     contentMd / sourceName / generatedAtIso) — TS catches missing
 *     props but not, e.g., `contentMd={row.toolId}` swap-bug
 *   - "use client" directive accidentally dropped (would crash at
 *     hydration with "useState can only be called in client comp")
 *
 * Pure static parse. Sub-second. Output line conforms to the
 * aggregator regex `${name}: ${pass} passed, ${fail} failed`.
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

const COMP_PATH = path.join(ROOT, "components/app/files/AiOutputActions.tsx");
const PAGE_PATH = path.join(ROOT, "app/app/files/[id]/preview/page.tsx");

assert(fs.existsSync(COMP_PATH), `Component missing at ${COMP_PATH}`);
assert(fs.existsSync(PAGE_PATH), `Preview page missing at ${PAGE_PATH}`);

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  console.log(`ai-output-actions: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

const COMP_SRC = fs.readFileSync(COMP_PATH, "utf8");
const PAGE_SRC = fs.readFileSync(PAGE_PATH, "utf8");

// ---------------------------------------------------------------------
// Section A — component is a client component with the right exports.
// ---------------------------------------------------------------------

assert(
  /^"use client"\s*;/m.test(COMP_SRC),
  "Component must start with `\"use client\";` directive — uses " +
    "useState, navigator.clipboard, URL.createObjectURL all of which " +
    "are client-only. Without this directive Next.js throws at " +
    "hydration with 'useState can only be called inside a Client Component'.",
);

assert(
  /export\s+function\s+AiOutputActions\s*\(/.test(COMP_SRC),
  "Named export `AiOutputActions` not found. The preview page imports " +
    "it as a named export.",
);

assert(
  /contentMd\s*:\s*string;[\s\S]*?kind\s*:\s*string;[\s\S]*?sourceName\?\s*:\s*string;[\s\S]*?generatedAtIso\s*:\s*string;/.test(
    COMP_SRC,
  ),
  "Props type missing one of contentMd/kind/sourceName?/generatedAtIso. " +
    "All four are required (sourceName is optional because generation " +
    "kind has no PDF source). Removing any of these breaks the call site.",
);

// ---------------------------------------------------------------------
// Section B — copy uses navigator.clipboard, not legacy execCommand.
// ---------------------------------------------------------------------

assert(
  /copyText\s*\(/.test(COMP_SRC),
  "Copy must use the shared copyText() helper (lib/client/copy-text.ts) — " +
    "Clipboard API first, execCommand fallback, surfaces failure. Calling " +
    "navigator.clipboard.writeText directly skips the fallback.",
);

assert(
  !/document\.execCommand\s*\(\s*["']copy["']/.test(COMP_SRC),
  "Found `document.execCommand('copy')` — deprecated. Use " +
    "`navigator.clipboard.writeText(...)` instead.",
);

// ---------------------------------------------------------------------
// Section C — download revokes the object URL.
// ---------------------------------------------------------------------
//
// M6 invariant codified in scripts/test-objecturl-revocation.mjs at
// the global audit level — pinned locally here too because the
// download path is the most common place the leak slips back in
// (someone removes the try/finally to "simplify").

assert(
  /URL\.createObjectURL\s*\(/.test(COMP_SRC),
  "Download path must call `URL.createObjectURL(blob)`. Without it " +
    "the anchor href has nothing to point at.",
);

assert(
  /URL\.revokeObjectURL\s*\(\s*url\s*\)/.test(COMP_SRC),
  "Download path must call `URL.revokeObjectURL(url)`. Forgetting " +
    "this leaks memory across long-lived tabs — every download " +
    "compounds. M6 audit catches this globally; this guard pins it locally.",
);

assert(
  /try\s*\{[\s\S]*?\}\s*finally\s*\{[\s\S]*?URL\.revokeObjectURL/.test(COMP_SRC),
  "Revoke must run in a `finally` block. If `a.click()` throws " +
    "(rare but possible on detached anchors in some sandboxed " +
    "browsers), a non-finally revoke leaks the URL. The only " +
    "leak-proof shape is try/finally with revoke in the finally.",
);

// ---------------------------------------------------------------------
// Section D — preview page mounts the component with all 4 props.
// ---------------------------------------------------------------------

assert(
  /import\s*\{\s*AiOutputActions\s*\}\s*from\s*"@\/components\/app\/files\/AiOutputActions"/.test(
    PAGE_SRC,
  ),
  "Preview page must import AiOutputActions from " +
    "`@/components/app/files/AiOutputActions`. Without the import the " +
    "JSX usage below fails at compile time.",
);

assert(
  /<AiOutputActions[\s\S]*?contentMd\s*=\s*\{\s*row\.contentMd\s*\}/.test(PAGE_SRC),
  "<AiOutputActions> must receive `contentMd={row.contentMd}` — the " +
    "raw markdown from ai_outputs. Anything else (e.g. row.toolId) is " +
    "the silent swap-bug that ships a download with the wrong content.",
);

assert(
  /<AiOutputActions[\s\S]*?kind\s*=\s*\{\s*kind\s*\}/.test(PAGE_SRC),
  "<AiOutputActions> must receive `kind={kind}` for filename derivation.",
);

assert(
  /<AiOutputActions[\s\S]*?sourceName\s*=\s*\{\s*meta\.sourceName\s*\}/.test(
    PAGE_SRC,
  ),
  "<AiOutputActions> must receive `sourceName={meta.sourceName}`. " +
    "The component uses it to build the download filename and " +
    "special-cases the literal string \"prompt\" for generation kind.",
);

assert(
  /<AiOutputActions[\s\S]*?generatedAtIso\s*=\s*\{\s*new\s+Date\(\s*row\.outputCreatedAt\s*\)\.toISOString\(\)\s*\}/.test(
    PAGE_SRC,
  ),
  "<AiOutputActions> must receive `generatedAtIso={new Date(row.outputCreatedAt).toISOString()}`. " +
    "ISO 8601 string keeps the YYYY-MM-DD slice deterministic across " +
    "the server/client boundary; passing a Date object directly serializes " +
    "via Next.js's RSC serializer which preserves the type but the " +
    "component's slice(0,10) expects an ISO string.",
);

// ---------------------------------------------------------------------
// Section E — filename sanitizer guards.
// ---------------------------------------------------------------------

assert(
  /function\s+sanitizeBaseName\s*\(/.test(COMP_SRC),
  "sanitizeBaseName helper not found. Without it, source filenames " +
    "with `/` or other path separators would land in the download " +
    "filename and either crash the browser's download dialog or " +
    "(worse) write to an unexpected path.",
);

assert(
  /\.replace\(\s*\/\[\^A-Za-z0-9._-\]\+\/g\s*,\s*"-"\s*\)/.test(COMP_SRC),
  "sanitizeBaseName must use the conservative allowlist " +
    "`/[^A-Za-z0-9._-]+/g`. Anything looser lets unsafe filesystem " +
    "chars through.",
);

assert(
  /sourceName\s*===\s*"prompt"/.test(COMP_SRC),
  "Filename builder must special-case `sourceName === \"prompt\"` — " +
    "generation kind's sourceName is the literal string \"prompt\", and " +
    "the unfiltered output would be `generation-of-prompt-2026-05-08.md` " +
    "which reads like nonsense.",
);

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
}

console.log(`ai-output-actions: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
