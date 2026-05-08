#!/usr/bin/env node
/**
 * 2026-05-08 — Item #3 from the improvement analysis: empty
 * states sweep. Each ToolDropzone consumer must pass a tool-
 * specific `prompt` prop instead of falling back to the generic
 * "Drop a PDF here or click to browse." Generic copy is the
 * brick-wall UX where users land on a tool without confirmation
 * they're in the right place.
 *
 * This guard scans every component file that imports
 * `./ToolDropzone` and asserts each `<ToolDropzone ...>` JSX
 * usage includes a `prompt=` prop (literal string OR expression
 * — both are acceptable; what matters is that SOME tool-specific
 * value flows through).
 *
 * Two bypasses are explicitly allowed via name-allowlist:
 *   - ToolDropzone.tsx itself (the consumer test target)
 *   - ImagesToPdfTool.tsx (uses an image-typed dropzone, doesn't
 *     consume ToolDropzone — false positive on the import scan)
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

const TOOLS_DIR = path.join(ROOT, "components/tools");

// Files that import ToolDropzone but don't actually mount it (the
// component file itself, plus any consumer that re-exports without
// using). Update this list if a new file gets added that the
// import scan picks up but doesn't actually render <ToolDropzone>.
const ALLOWED_NO_PROMPT = new Set([
  // self-reference; ToolDropzone.tsx imports its own props/types
  "ToolDropzone.tsx",
  // ImagesToPdfTool uses an inline image-typed dropzone, not the
  // PDF-typed ToolDropzone (mentions ToolDropzone only in a
  // comment).
  "ImagesToPdfTool.tsx",
]);

const allFiles = fs
  .readdirSync(TOOLS_DIR)
  .filter((f) => f.endsWith(".tsx"));

const consumers = allFiles.filter((f) => {
  if (ALLOWED_NO_PROMPT.has(f)) return false;
  const src = fs.readFileSync(path.join(TOOLS_DIR, f), "utf8");
  return /from\s+["']\.\/ToolDropzone["']/.test(src);
});

assert(
  consumers.length > 0,
  "Expected at least one ToolDropzone consumer in components/tools/. " +
    "Either the import path changed or the audit's regex no longer " +
    "matches the canonical form.",
);

for (const fname of consumers) {
  const src = fs.readFileSync(path.join(TOOLS_DIR, fname), "utf8");

  // Find every <ToolDropzone ...> JSX opener. Match the opening tag
  // up to the closing `>` or `/>`. Multi-line tolerant.
  const opens = src.match(/<ToolDropzone\b[^>]*\/?>/gms) || [];
  // `<ToolDropzone` followed by props on subsequent lines until
  // self-close or end-tag — broader regex for multi-line props.
  const multiline = src.match(/<ToolDropzone\b[\s\S]*?(?:\/>|>)/g) || [];

  // Use the broader multiline match if the inline match missed
  // anything. Both should agree most of the time; multiline catches
  // the prop-per-line layout that's idiomatic in this codebase.
  const usages = multiline.length >= opens.length ? multiline : opens;

  if (usages.length === 0) {
    // Imported but not used — odd but not a violation. Skip.
    continue;
  }

  for (const usage of usages) {
    // Each usage must include a `prompt=` prop. Accept both literal
    // (`prompt="..."`) and expression (`prompt={...}`) forms — both
    // are tool-specific by definition (the consumer is choosing the
    // value, not falling back to the dropzone default).
    const hasPrompt = /\bprompt\s*=/.test(usage);
    assert(
      hasPrompt,
      `${fname}: <ToolDropzone> missing required \`prompt\` prop. ` +
        "Tool-specific drop copy ('Drop a PDF to summarize', 'Drop " +
        "two PDFs to compare', etc.) replaces the generic 'Drop a " +
        "PDF here or click to browse.' default — closes the empty-" +
        "state brick-wall UX. If this consumer genuinely shouldn't " +
        "have a prompt, add it to ALLOWED_NO_PROMPT in this guard " +
        "with a comment explaining why.",
    );
  }
}

// Coverage report — informational, doesn't gate the run. Useful
// signal that the audit is actually scanning the expected breadth.
console.log(
  `[info] scanned ${consumers.length} ToolDropzone consumers in components/tools/`,
);

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
}

console.log(`tool-dropzone-prompt: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
