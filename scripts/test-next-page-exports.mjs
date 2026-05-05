#!/usr/bin/env node
/**
 * 2026-05-05 — Next.js Page export-allowlist guard.
 *
 * Closes the validation gap exposed by commit `a849c91` (feature-
 * flags foundation): I added `export { FEATURE_FLAGS }` at the
 * bottom of a page.tsx file with a misleading comment about
 * "preserving the import." `npx tsc --noEmit` happily compiled it,
 * the aggregator passed (5338/0), but `next build` rejected it:
 *
 *   Type error: Page "app/admin/feature-flags/page.tsx" does not
 *   match the required types of a Next.js Page.
 *   "FEATURE_FLAGS" is not a valid Page export field.
 *
 * Hostinger atomically swaps last-source.tmp → last-source only on
 * build success, so the failed build never reached production
 * (queue stayed on 830e03b). No user impact, but a stale deploy
 * window of ~2 hours, plus operator confusion.
 *
 * Root cause for missed validation:
 *   - `tsc --noEmit` validates TypeScript types only.
 *   - Page-export contract enforcement is a `next build` step.
 *   - I don't run `next build` in the aggregator — too slow (~60s+).
 *
 * Fix: this static-parse guard scans every `page.tsx` / `page.ts`
 * under `app/` for named exports outside the Next.js allowlist.
 * Runs in well under a second and catches the bug class at commit
 * time rather than at deploy time.
 *
 * Allowlist (Next.js 14 App Router page contract):
 *   - default (the page component)
 *   - metadata (static metadata)
 *   - generateMetadata (dynamic metadata)
 *   - viewport (static viewport)
 *   - generateViewport (dynamic viewport)
 *   - generateStaticParams (SSG params)
 *   - revalidate, dynamic, dynamicParams, fetchCache, runtime,
 *     preferredRegion, maxDuration (route segment config)
 *
 * Source: https://nextjs.org/docs/app/api-reference/file-conventions/page
 *
 * What this guard does NOT catch:
 *   - Layout file exports (app/**\/layout.tsx) — same allowlist
 *     applies but slightly different shape; could extend later.
 *   - route.ts handler exports (HTTP method names like GET, POST).
 *     Different contract — already enforced by Next.js's own
 *     handler-name discovery.
 *   - Server Actions exported with "use server" directive — those
 *     ARE valid named exports from page files. This guard accepts
 *     them via the file-level "use server" check.
 *
 * Output line conforms to aggregator regex:
 *   `${name}: ${pass} passed, ${fail} failed`.
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

// Next.js 14 App Router Page export allowlist. Any export NOT in this
// set fails `next build` at the type-check phase. Keep this list in
// sync with https://nextjs.org/docs/app/api-reference/file-conventions/page
// and the Route Segment Config docs.
const ALLOWED_PAGE_EXPORTS = new Set([
  "default",
  "metadata",
  "generateMetadata",
  "viewport",
  "generateViewport",
  "generateStaticParams",
  // Route Segment Config exports
  "revalidate",
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
]);

// Recursively find every `page.tsx` / `page.ts` under `app/`. Skip
// node_modules + .next + any nested test directories.
function findPageFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!fs.existsSync(cur)) continue;
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        stack.push(full);
      } else if (entry.name === "page.tsx" || entry.name === "page.ts") {
        out.push(full);
      }
    }
  }
  return out;
}

// Extract every named export from a TS source file. Handles four
// common forms:
//
//   export const NAME = ...
//   export function NAME(...)
//   export async function NAME(...)
//   export class NAME ...
//   export { NAME, OTHER }
//   export type NAME = ...   ← TYPE-ONLY, ignored (not runtime export)
//   export interface NAME    ← TYPE-ONLY, ignored
//
// Type-only exports are fine in page files — they don't reach the
// runtime, so Next.js doesn't see them. This guard ignores them.
//
// `export default` is also ignored — that's the page component
// (always required, always allowed).
function extractNamedExports(src) {
  const exports = new Set();

  // export const / let / var NAME
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+(\w+)/gm)) {
    exports.add(m[1]);
  }

  // export function / async function NAME
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    exports.add(m[1]);
  }

  // export class NAME
  for (const m of src.matchAll(/^export\s+class\s+(\w+)/gm)) {
    exports.add(m[1]);
  }

  // export { NAME, NAME2 } — possibly with `as` aliases
  for (const m of src.matchAll(/^export\s+\{([^}]+)\}/gm)) {
    const names = m[1].split(",");
    for (const raw of names) {
      // "Foo as Bar" → "Bar" (the externally-visible name)
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const asMatch = trimmed.match(/\s+as\s+(\w+)\s*$/);
      const name = asMatch ? asMatch[1] : trimmed.replace(/\s.*$/, "");
      if (name) exports.add(name);
    }
  }

  // Drop type-only exports (they don't surface at runtime).
  // export type NAME = ...
  // export interface NAME ...
  for (const m of src.matchAll(/^export\s+(?:type|interface)\s+(\w+)/gm)) {
    exports.delete(m[1]);
  }

  return exports;
}

// Server Actions exported from a page file are allowed if the file
// (or function) is marked "use server". Our codebase doesn't yet use
// inline server actions, but the guard handles the case so a future
// addition doesn't trip a false positive.
function hasUseServerDirective(src) {
  return /^["']use server["'];?\s*$/m.test(src);
}

// ============================================================================
// Run the scan
// ============================================================================

const APP_ROOT = path.join(ROOT, "app");
const pageFiles = findPageFiles(APP_ROOT);

assert(pageFiles.length > 0, "A1: at least one page.tsx file found under app/");

let scannedCount = 0;
let violationsByFile = new Map();

for (const file of pageFiles) {
  const src = fs.readFileSync(file, "utf8");
  const named = extractNamedExports(src);
  const useServer = hasUseServerDirective(src);

  // Per-file: every named export must be in the allowlist OR the
  // file is a server-action page.
  const violations = [];
  for (const name of named) {
    if (ALLOWED_PAGE_EXPORTS.has(name)) continue;
    if (useServer) continue; // Server Action page — any export OK.
    violations.push(name);
  }

  if (violations.length > 0) {
    violationsByFile.set(file, violations);
  }
  scannedCount++;
}

assert(scannedCount === pageFiles.length, `A2: scanned all ${pageFiles.length} page files`);

// Report violations as individual failed assertions so the failure
// message tells the operator exactly which file + which export.
if (violationsByFile.size === 0) {
  // One umbrella pass-assertion when zero violations — visible signal
  // in the aggregator output that the guard ran against real data
  // and accepted it.
  passed++;
} else {
  for (const [file, violations] of violationsByFile) {
    const rel = path.relative(ROOT, file);
    for (const violation of violations) {
      failed++;
      failures.push(
        `${rel}: invalid Page export "${violation}" — Next.js App Router pages only allow [${[...ALLOWED_PAGE_EXPORTS].join(", ")}]. ` +
          `Move the export to a non-page file (e.g. a sibling components/ or lib/ module) and import it where needed.`,
      );
    }
  }
}

// ============================================================================
// Self-test the extractor: pin the four common export forms via
// inline strings so a future regex bug surfaces as a clear failure.
// ============================================================================

{
  const sample = `
export const FOO = 1;
export let BAR = 2;
export var BAZ = 3;
export function helperOne() {}
export async function helperTwo() {}
export class MyClass {}
export { renamed as exposed, plain };
export default function Page() {}
export type SomeType = string;
export interface SomeInterface {}
`;
  const got = extractNamedExports(sample);
  for (const expected of ["FOO", "BAR", "BAZ", "helperOne", "helperTwo", "MyClass", "exposed", "plain"]) {
    assert(got.has(expected), `B.${expected}: extractor finds "${expected}"`);
  }
  // Type-only exports must NOT surface (they don't reach runtime).
  assert(
    !got.has("SomeType"),
    "B.types: extractor drops `export type` (TS-only, not runtime export)",
  );
  assert(
    !got.has("SomeInterface"),
    "B.interface: extractor drops `export interface` (TS-only)",
  );
}

// ============================================================================
// Output
// ============================================================================

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`next-page-exports: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
