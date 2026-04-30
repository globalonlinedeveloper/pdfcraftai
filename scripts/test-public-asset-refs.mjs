#!/usr/bin/env node
/**
 * 2026-04-30 public-asset reference guard: every literal `src="/..."`
 * or `href="/..."` pointing at a file extension under /public/ must
 * resolve to a real file.
 *
 * Background: components like the og:image meta, link rel="preload",
 * and the occasional inline <img> hardcode `/foo.png` paths. If the
 * file is renamed or removed from /public, the reference silently
 * 404s — bad UX, broken og previews, wasted preload bandwidth.
 *
 * Real catch from the first run: app/tool/[id]/page.tsx had
 * `<link rel="preload" href="/pdfium.wasm">` even after the WASM
 * fix (commit 7395e02) moved the runtime fetch path to
 * /api/pdfium-wasm. The preload was both pointing at the wrong URL
 * AND would have hit the Content-Type: text/plain bug if it
 * resolved — fully wasted.
 *
 * Audit scope:
 *   - Literal `src="/..."` and `href="/..."` strings in .tsx files.
 *   - File extensions: .png, .jpg, .jpeg, .gif, .svg, .webp, .ico,
 *     .wasm, .mjs, .js (anything that's served as a static asset).
 *   - "/" → /public/index implicit (skipped — that's the homepage).
 *   - Dynamic href={...} → skipped (would need a JS evaluator).
 *
 * Output line conforms to the aggregator regex
 * `${name}: ${pass} passed, ${fail} failed`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_ROOT = path.join(ROOT, "public");

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

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name.startsWith(".")
      ) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const APP_DIR = path.join(ROOT, "app");
const COMP_DIR = path.join(ROOT, "components");
const tsxFiles = [...walk(APP_DIR), ...walk(COMP_DIR)];

// ---------------------------------------------------------------------------
// Asset references — match `src="/foo.ext"` or `href="/foo.ext"` for
// known static extensions.
// ---------------------------------------------------------------------------

const ASSET_RE =
  /\b(?:src|href)=["'](\/[^"'\s]*\.(?:png|jpg|jpeg|gif|svg|webp|ico|wasm|mjs|js))["']/g;

const SPECIAL_PATHS = new Set([
  // Files that aren't on disk at /public but are routed via an API
  // handler. Keep this set tight — adding entries silences the guard.
  "/api/pdfium-wasm",
]);

const dead = [];
for (const file of tsxFiles) {
  const text = fs.readFileSync(file, "utf8");
  let m;
  while ((m = ASSET_RE.exec(text)) !== null) {
    const ref = m[1];
    if (SPECIAL_PATHS.has(ref)) continue;
    // Skip Next.js internal paths like /_next/static/...
    if (ref.startsWith("/_next/")) continue;
    const filePath = path.join(PUBLIC_ROOT, ref);
    if (fs.existsSync(filePath)) continue;
    // Compute line number for failure context.
    const before = text.slice(0, m.index);
    const lineNo = before.split("\n").length;
    dead.push({
      file: path.relative(ROOT, file),
      line: lineNo,
      ref,
    });
  }
}

assert(
  dead.length === 0,
  `Found ${dead.length} dead public-asset reference(s).\n` +
    `Each is a literal src/href to /<file>.ext that doesn't exist under /public/.\n\n` +
    `Locations:\n` +
    dead
      .slice(0, 20)
      .map((d) => `  ${d.file}:${d.line}\n    ref="${d.ref}"`)
      .join("\n") +
    (dead.length > 20 ? `\n  ... and ${dead.length - 20} more` : ""),
);

// ---------------------------------------------------------------------------
// Inverse check: critical /public files must exist (catches the
// "someone deleted og.png and now every share preview breaks" class
// of bug).
// ---------------------------------------------------------------------------

const REQUIRED_PUBLIC_FILES = [
  // Open Graph share preview — referenced by every page's og:image
  // via app/layout.tsx metadata. Removing this breaks every social
  // share preview across the site.
  "og.png",
  // PDFium WASM — copied at prebuild from @hyzyla/pdfium. Served via
  // /api/pdfium-wasm route handler, but the route reads from
  // /public/pdfium.wasm — without this file, every PDFium-backed
  // tool fails to initialize.
  "pdfium.wasm",
  // PDFium service worker — caches the WASM client-side for
  // returning visitors.
  "pdfium-sw.js",
  // pdf.js worker — used by tools that rely on pdf.js (some
  // inspectors).
  "pdfjs-worker.min.mjs",
];

for (const f of REQUIRED_PUBLIC_FILES) {
  assert(
    fs.existsSync(path.join(PUBLIC_ROOT, f)),
    `CRITICAL: required public file missing: /public/${f}. Removing breaks live functionality (see comment in this file for impact details).`,
  );
}

// ---------------------------------------------------------------------------
// Self-tests on the regex.
// ---------------------------------------------------------------------------

const POS = '<img src="/og.png" />';
const reCheck =
  /\b(?:src|href)=["'](\/[^"'\s]*\.(?:png|jpg|jpeg|gif|svg|webp|ico|wasm|mjs|js))["']/;
assert(reCheck.test(POS), "regex catches the canonical src=\"/x.png\" form");
const NEG_DYNAMIC = "<img src={url} />";
assert(!reCheck.test(NEG_DYNAMIC), "regex skips dynamic src={...} attrs");
const NEG_EXTERNAL = '<img src="https://example.com/x.png" />';
assert(!reCheck.test(NEG_EXTERNAL), "regex skips external https URLs");
const NEG_NO_EXT = '<a href="/about">';
assert(!reCheck.test(NEG_NO_EXT), "regex skips href without file extension");

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------

const total = passed + failed;
console.log(
  `public-asset-refs: ${passed} passed, ${failed} failed (of ${total})`,
);
if (failed > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
process.exit(0);
