#!/usr/bin/env node
/**
 * M18 (2026-05-02): every AI tool that accepts a PDF input must
 * render the page-1 thumbnail via UploadedFilePreview.
 *
 * Background: M-series M18 was the spec to extend the upload-card
 * thumbnail (already shipped on free tools via useFirstPagePreview /
 * UploadedFilePreview) across the AI tool fleet. Comprehensive audit
 * on 2026-05-02 confirmed all 51 AI tools that accept a file input
 * now render UploadedFilePreview — 32 directly via per-tool
 * components, 19 via the SummarizeVariantTool shared base, 2 via
 * the StructuredVariantTool shared base. The 2 that don't render it
 * are intentional carve-outs: ai-generate (no PDF input — pure text
 * prompt) and ai-chat (separate streaming surface at /chat-with-pdf,
 * not in the ToolRunner dispatcher at all).
 *
 * This guard pins the floor. The pattern is easy to forget when
 * adding a new AI tool — pick the wrong base, skip the import, and
 * the tool ships without page-1 reassurance for the user. CI catches
 * it sub-second, before deploy.
 *
 * Approach:
 *   1. Parse components/tools/ToolRunner.tsx to map every `ai-*`
 *      switch case → its component name → its source file.
 *   2. For each AI tool id, the source file MUST contain an import
 *      from "./UploadedFilePreview" (or be in the explicit
 *      no-file-input allowlist).
 *   3. Self-test the parser against synthetic strings so future
 *      ToolRunner refactors fail loud.
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

const RUNNER_SRC = fs.readFileSync(
  path.join(ROOT, "components/tools/ToolRunner.tsx"),
  "utf8",
);

// ---------------------------------------------------------------------------
// AI tools without a PDF input — explicit allowlist. These tools either
// (a) take only text input (ai-generate) or (b) route to a different
// surface entirely outside the ToolRunner (ai-chat → /chat-with-pdf).
// Adding a new entry here is a deliberate decision; the comment must
// explain WHY no preview applies.
// ---------------------------------------------------------------------------
const NO_FILE_INPUT = new Set([
  // 2026-04-22 — pure text-prompt-to-PDF generator. No file attachment;
  // input is a typed prompt + length/tone selectors. UploadedFilePreview
  // would be misleading (there's nothing to preview).
  "ai-generate",
  // 2026-04-29 (Option B) — ai-chat doesn't ship as a /tool/* runner at
  // all. It redirects to /chat-with-pdf (public landing) for anon users
  // and /app/chat (streaming Anthropic conversational surface) for
  // signed-in users. Conversations span multiple files; the chat
  // surface has its own per-message file-attach UI.
  "ai-chat",
]);

// ---------------------------------------------------------------------------
// Section A — extract ai-* switch case → component name from ToolRunner.
//
// Match shape:
//   case "ai-summarize":
//     return <SummarizePdfTool />;
//
// Allow whitespace between the case label and the JSX so future
// reformatting (e.g. prettier wrapping) doesn't break the parser.
// ---------------------------------------------------------------------------

const AI_CASE_RE =
  /case\s+"(ai-[a-z0-9-]+)":\s*\n\s*return\s+<([A-Za-z][A-Za-z0-9]*)\s*\/>/g;
const aiToolToComponent = new Map();
let m;
while ((m = AI_CASE_RE.exec(RUNNER_SRC)) !== null) {
  aiToolToComponent.set(m[1], m[2]);
}
assert(
  aiToolToComponent.size >= 50,
  `expected >= 50 ai-* dispatch cases in ToolRunner.tsx, got ${aiToolToComponent.size} (regex drift?)`,
);

// ---------------------------------------------------------------------------
// Section B — extract component name → source file path. Two shapes:
//
//   Shape 1 — direct dynamic import:
//     const PdfXTool = dyn(() =>
//       import("@/components/tools/PdfXTool").then((m) => ({
//         default: m.PdfXTool,
//       })),
//     );
//
//   Shape 2 — variant helper:
//     const KeyPointsPdfTool = summarizeVariant("KeyPointsPdfTool");
//     const FlashcardsPdfTool = dyn(() =>
//       import("@/components/tools/StructuredVariantTool").then((m) => ({
//         default: m.FlashcardsPdfTool,
//       })),
//     );
//
//   summarizeVariant() bakes in the SummarizeVariantTool source path,
//   so we resolve those names via a synthetic mapping.
// ---------------------------------------------------------------------------

const componentToFile = new Map();

// Shape 1 — multiline regex tolerates the formatted-on-3-lines form.
const DYN_RE =
  /const\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*dyn\(\(\)\s*=>\s*\n?\s*import\(\s*"@\/components\/tools\/([A-Za-z][A-Za-z0-9]*)"\s*\)\.then/g;
let d;
while ((d = DYN_RE.exec(RUNNER_SRC)) !== null) {
  // d[1] = local const name (e.g. PdfXTool); d[2] = file basename
  // without .tsx (e.g. PdfXTool, or SummarizeVariantTool when shared).
  componentToFile.set(d[1], `components/tools/${d[2]}.tsx`);
}

// Shape 2 — summarizeVariant("Foo") → file is SummarizeVariantTool.tsx.
const VARIANT_RE = /const\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*summarizeVariant\(/g;
let v;
while ((v = VARIANT_RE.exec(RUNNER_SRC)) !== null) {
  componentToFile.set(v[1], "components/tools/SummarizeVariantTool.tsx");
}

assert(
  componentToFile.size >= 50,
  `expected >= 50 component-to-file mappings in ToolRunner.tsx, got ${componentToFile.size} (regex drift?)`,
);

// ---------------------------------------------------------------------------
// Section C — for every ai-* tool, the resolved source file must import
// UploadedFilePreview, OR the tool must be on the no-file-input
// allowlist.
// ---------------------------------------------------------------------------

const fileImportsPreview = new Map(); // file → boolean

function checkFileImportsPreview(filePath) {
  if (fileImportsPreview.has(filePath)) return fileImportsPreview.get(filePath);
  const abs = path.join(ROOT, filePath);
  if (!fs.existsSync(abs)) {
    fileImportsPreview.set(filePath, null); // missing
    return null;
  }
  const src = fs.readFileSync(abs, "utf8");
  // Match `import { UploadedFilePreview }` OR `import { ... UploadedFilePreview ... }`.
  // Anchored on the symbol name, not the full import shape, so future
  // ESLint reformatting (extra braces, line wrap) doesn't break.
  const ok = /UploadedFilePreview/.test(src) && /from\s+"\.\/UploadedFilePreview"/.test(src);
  fileImportsPreview.set(filePath, ok);
  return ok;
}

const missing = [];
for (const [toolId, componentName] of aiToolToComponent) {
  if (NO_FILE_INPUT.has(toolId)) continue;
  const file = componentToFile.get(componentName);
  if (!file) {
    missing.push(
      `${toolId} → component "${componentName}" not found in dynamic-import block`,
    );
    continue;
  }
  const ok = checkFileImportsPreview(file);
  if (ok === null) {
    missing.push(`${toolId} → ${file} not on disk`);
    continue;
  }
  if (!ok) {
    missing.push(
      `${toolId} → ${file} does NOT import UploadedFilePreview (M18 regression)`,
    );
  }
}

assert(
  missing.length === 0,
  `Found ${missing.length} AI tool(s) missing the page-1 preview thumbnail.\n` +
    `Either (a) add the import + render in the resolved source file, or (b) if the tool genuinely doesn't accept a PDF input, add it to NO_FILE_INPUT in this file with a comment explaining why.\n\n` +
    missing.map((s) => `  - ${s}`).join("\n"),
);

// ---------------------------------------------------------------------------
// Section D — sanity: shared bases REALLY ARE shared. If
// SummarizeVariantTool ever stops importing UploadedFilePreview,
// every variant tool silently regresses. Pin it explicitly even
// though it's covered transitively above.
// ---------------------------------------------------------------------------

const SHARED_BASES = [
  "components/tools/SummarizeVariantTool.tsx",
  "components/tools/StructuredVariantTool.tsx",
];
for (const base of SHARED_BASES) {
  assert(
    checkFileImportsPreview(base) === true,
    `shared base ${base} must import UploadedFilePreview — many AI tools depend on it`,
  );
}

// ---------------------------------------------------------------------------
// Section E — sanity: NO_FILE_INPUT shouldn't grow without thought.
// ---------------------------------------------------------------------------

assert(
  NO_FILE_INPUT.size <= 5,
  `NO_FILE_INPUT has ${NO_FILE_INPUT.size} entries — over the 5-item soft cap. AI tools that don't accept a PDF input are rare; if this list keeps growing, the M18 contract may need rethinking.`,
);

// Each entry must actually appear in the dispatch (or in the case of
// ai-chat, must NOT — that one is intentionally absent because it
// routes to a different surface).
for (const id of NO_FILE_INPUT) {
  if (id === "ai-chat") {
    assert(
      !aiToolToComponent.has(id),
      `ai-chat should NOT appear in ToolRunner.tsx switch — it routes to /chat-with-pdf via the redirect map`,
    );
  } else {
    assert(
      aiToolToComponent.has(id),
      `NO_FILE_INPUT entry "${id}" doesn't appear in ToolRunner.tsx switch — stale allowlist?`,
    );
  }
}

// ---------------------------------------------------------------------------
// Section F — self-test the parsers so future refactors fail loud.
// ---------------------------------------------------------------------------

const POS_AI_CASE = `case "ai-foo":
      return <FooTool />;`;
assert(
  /case\s+"(ai-[a-z0-9-]+)":\s*\n\s*return\s+<([A-Za-z][A-Za-z0-9]*)\s*\/>/.test(
    POS_AI_CASE,
  ),
  "self-test: AI_CASE_RE matches the canonical case shape",
);

const POS_DYN = `const PdfXTool = dyn(() =>
  import("@/components/tools/PdfXTool").then((m) => ({`;
assert(
  /const\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*dyn\(\(\)\s*=>\s*\n?\s*import\(\s*"@\/components\/tools\/([A-Za-z][A-Za-z0-9]*)"\s*\)\.then/.test(
    POS_DYN,
  ),
  "self-test: DYN_RE matches the canonical multi-line dyn() shape",
);

const POS_VARIANT = `const KeyPointsPdfTool = summarizeVariant("KeyPointsPdfTool");`;
assert(
  /const\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*summarizeVariant\(/.test(POS_VARIANT),
  "self-test: VARIANT_RE matches summarizeVariant() shape",
);

// ---------------------------------------------------------------------------
// Aggregator-friendly summary line.
// ---------------------------------------------------------------------------

const total = passed + failed;
console.log(`ai-tool-preview: ${passed} passed, ${failed} failed (of ${total})`);
if (failed > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
process.exit(0);
