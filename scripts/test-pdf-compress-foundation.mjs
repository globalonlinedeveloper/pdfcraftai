#!/usr/bin/env node
/**
 * 2026-05-05 — PDF Compress foundation guard (PENDING §5a).
 *
 * Locks the storage + helper + route surface for the Ghostscript-
 * backed compression foundation. Same shape as the §3e referrals
 * guard: pure static parse, no DB, no spawn, sub-second.
 *
 * What it catches
 * ---------------
 * - Ghostscript level mapping drifts (e.g. someone re-points "strong"
 *   at /printer instead of /screen, silently making the strongest
 *   level the lightest)
 * - Helper public surface drifts (rename / drop)
 * - Route loses its feature-flag gate (would expose the route to all
 *   logged-in users before the UI is ready)
 * - Route loses its auth check (anonymous compression = unbounded
 *   abuse surface)
 * - Route loses its size cap (would let unbounded uploads through to
 *   the gs spawn and exhaust /tmp)
 * - Magic-header check removed (would let non-PDFs feed gs and
 *   produce garbage output)
 * - Bypass guard threshold drifts below 5% (the noise floor below
 *   which compression isn't perceptually worth it)
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

const HELPER = path.join(ROOT, "lib/tools/ghostscript/compress.ts");
const ROUTE = path.join(ROOT, "app/api/tools/compress/route.ts");
const FLAGS = path.join(ROOT, "lib/flags.ts");

// ---------------------------------------------------------------------------
// Section A: helper public surface + Ghostscript invariants
// ---------------------------------------------------------------------------

assert(
  fs.existsSync(HELPER),
  "A1: lib/tools/ghostscript/compress.ts exists",
);
const helperSrc = fs.readFileSync(HELPER, "utf8");

assert(
  /export\s+type\s+CompressLevel\s*=\s*"light"\s*\|\s*"balanced"\s*\|\s*"strong"/.test(
    helperSrc,
  ),
  "A2: CompressLevel union has all three levels in order",
);

assert(
  /export\s+const\s+COMPRESS_MAX_INPUT_BYTES\s*=\s*50\s*\*\s*1024\s*\*\s*1024/.test(
    helperSrc,
  ),
  "A3: COMPRESS_MAX_INPUT_BYTES = 50MB",
);

assert(
  /export\s+const\s+COMPRESS_TIMEOUT_MS\s*=\s*60_?000/.test(helperSrc),
  "A4: COMPRESS_TIMEOUT_MS = 60s",
);

assert(
  /export\s+const\s+COMPRESS_MIN_SAVINGS_RATIO\s*=\s*0\.05/.test(helperSrc),
  "A5: COMPRESS_MIN_SAVINGS_RATIO = 0.05 (5% noise floor)",
);

assert(
  /export\s+async\s+function\s+compressPdf\b/.test(helperSrc),
  "A6: compressPdf is exported async",
);

assert(
  /export\s+class\s+GhostscriptError\s+extends\s+Error\b/.test(helperSrc),
  "A7: GhostscriptError class is exported",
);

// Level → preset mapping. The /printer ←→ light, /ebook ←→ balanced,
// /screen ←→ strong order is from PDF preset semantics. Reordering
// would silently misroute the user's choice.
const PRESET_PINS = [
  ["light", "/printer"],
  ["balanced", "/ebook"],
  ["strong", "/screen"],
];
for (const [level, preset] of PRESET_PINS) {
  assert(
    new RegExp(`${level}:\\s*"${preset.replace(/\//g, "\\/")}"`).test(helperSrc),
    `A8.${level}: maps to ${preset}`,
  );
}

// Ghostscript invocation invariants. These are the flags that make
// the spawn safe + non-interactive + linearized. Dropping any of
// them changes runtime behavior in subtle ways — e.g. without
// -dQUIET, gs writes to stderr; without -dBATCH, it can hang on
// unrecoverable input; without -dFastWebView, output isn't
// linearized for progressive display.
const REQUIRED_GS_FLAGS = [
  "-sDEVICE=pdfwrite",
  "-dNOPAUSE",
  "-dQUIET",
  "-dBATCH",
  "-dFastWebView=true",
];
for (const flag of REQUIRED_GS_FLAGS) {
  assert(
    helperSrc.includes(`"${flag}"`),
    `A9.${flag}: helper passes ${flag} to gs`,
  );
}

// Temp-file discipline. mkdtemp creates a unique dir per call;
// rm in finally{} guarantees cleanup.
assert(
  /mkdtemp\s*\(/.test(helperSrc),
  "A10: helper uses mkdtemp for isolated temp dir per call",
);
assert(
  /finally\s*\{[\s\S]*?rm\s*\(/.test(helperSrc),
  "A11: helper cleans up temp dir in finally{} (always, even on throw)",
);

// Timeout → SIGKILL discipline. SIGKILL specifically (not SIGTERM)
// because Ghostscript can ignore SIGTERM mid-compression — see
// 2026-04-30 zombie-cleanup runbook in CLAUDE.md §5.
assert(
  /child\.kill\(\s*"SIGKILL"\s*\)/.test(helperSrc),
  "A12: timeout sends SIGKILL (not SIGTERM — gs can ignore SIGTERM)",
);

// Bypass branch returns ORIGINAL bytes when savings < threshold.
assert(
  /savingsRatio\s*<\s*COMPRESS_MIN_SAVINGS_RATIO/.test(helperSrc),
  "A13: helper compares savingsRatio against COMPRESS_MIN_SAVINGS_RATIO",
);
assert(
  /outputBytes:\s*inputBytes,\s*\n\s*bypassed:\s*true/.test(helperSrc),
  "A14: bypass branch returns inputBytes (the ORIGINAL) with bypassed=true",
);

// ---------------------------------------------------------------------------
// Section B: route handler invariants
// ---------------------------------------------------------------------------

assert(fs.existsSync(ROUTE), "B1: app/api/tools/compress/route.ts exists");
const routeSrc = fs.readFileSync(ROUTE, "utf8");

assert(
  /export\s+async\s+function\s+POST\b/.test(routeSrc),
  "B2: POST handler is exported",
);
assert(
  /export\s+const\s+runtime\s*=\s*"nodejs"/.test(routeSrc),
  "B3: runtime = nodejs (Ghostscript spawn requires Node, not Edge)",
);
assert(
  /export\s+const\s+dynamic\s*=\s*"force-dynamic"/.test(routeSrc),
  "B4: dynamic = force-dynamic (multipart upload, can't be cached)",
);

// Auth gate
assert(
  /const\s+session\s*=\s*await\s+auth\(\)/.test(routeSrc),
  "B5: route awaits auth() before any work",
);
assert(
  /not_authenticated/.test(routeSrc),
  "B6: route returns not_authenticated 401 on missing session",
);

// Feature flag gate. This is the foundation invariant — without it
// the route would leak to all users on first deploy.
assert(
  /isFeatureEnabled\(\s*FEATURE_FLAGS\.PDF_COMPRESS/.test(routeSrc),
  "B7: route checks PDF_COMPRESS feature flag",
);
assert(
  /feature_disabled/.test(routeSrc),
  "B8: route returns feature_disabled error code when flag is off",
);

// Pre-spawn size check (cheap rejection before reading bytes into RAM)
assert(
  /pdfFile\.size\s*>\s*COMPRESS_MAX_INPUT_BYTES/.test(routeSrc),
  "B9: route checks file size before buffering bytes",
);
assert(
  /payload_too_large/.test(routeSrc),
  "B10: route returns payload_too_large error code on oversize input",
);

// Magic-header check. Without this, gs can be fed arbitrary bytes
// (HTML, images, executables) and will produce garbage or crash.
// We use multiline regex with [\s\S] to span the multi-line check
// against inputBytes[0..3] (each on its own line in the route).
assert(
  /inputBytes\[0\][\s\S]*?0x25[\s\S]*?inputBytes\[1\][\s\S]*?0x50[\s\S]*?inputBytes\[2\][\s\S]*?0x44[\s\S]*?inputBytes\[3\][\s\S]*?0x46/.test(
    routeSrc,
  ),
  "B11: route checks %PDF magic header bytes on inputBytes[0..3] (0x25/0x50/0x44/0x46)",
);

// Level validation. Without VALID_LEVELS gate, an attacker could
// pass arbitrary strings that defeat the type check at runtime.
assert(
  /VALID_LEVELS\s*:\s*ReadonlySet/.test(routeSrc),
  "B12: route validates `level` against a whitelist Set",
);

// Mime-type guard
assert(
  /application\/pdf/.test(routeSrc),
  "B13: route accepts application/pdf mime type",
);
assert(
  /application\/octet-stream/.test(routeSrc),
  "B14: route also accepts application/octet-stream (some browsers send this)",
);

// Default level fallback
assert(
  /\?\s*\(levelRaw\s+as\s+CompressLevel\)\s*\n?\s*:\s*"balanced"/.test(routeSrc) ||
    /:\s*"balanced"/.test(routeSrc),
  "B15: route defaults to 'balanced' when level is missing or invalid",
);

// Error categorization in catch block
assert(
  /err\s+instanceof\s+GhostscriptError/.test(routeSrc),
  "B16: route catches GhostscriptError specifically",
);
assert(
  /compress_failed/.test(routeSrc),
  "B17: route returns compress_failed error code on gs error",
);

// ---------------------------------------------------------------------------
// Section C: feature flag registration
// ---------------------------------------------------------------------------

assert(fs.existsSync(FLAGS), "C1: lib/flags.ts exists");
const flagsSrc = fs.readFileSync(FLAGS, "utf8");

assert(
  /PDF_COMPRESS:\s*"pdf_compress"/.test(flagsSrc),
  "C2: FEATURE_FLAGS.PDF_COMPRESS is registered with value 'pdf_compress'",
);

// Flag is in the registry literal type — ensures the type union
// covers it. The route imports FEATURE_FLAGS.PDF_COMPRESS by value;
// without this the type would error at the call site.
assert(
  /FEATURE_FLAGS\s*=\s*\{[\s\S]*?PDF_COMPRESS[\s\S]*?\}\s*as\s+const/m.test(
    flagsSrc,
  ),
  "C3: PDF_COMPRESS appears inside the FEATURE_FLAGS `as const` literal",
);

// ---------------------------------------------------------------------------
// Section D: dynamic execution — preset map produces correct argv shape
// ---------------------------------------------------------------------------

// Extract PDF_SETTINGS_MAP literal + verify each level resolves.
// We don't compile the whole helper (it imports node:fs/promises etc.
// which `new Function` can't resolve), but the preset map is a pure
// const literal we can extract.
const presetMapMatch = helperSrc.match(
  /const\s+PDF_SETTINGS_MAP\s*:\s*Record<CompressLevel,\s*string>\s*=\s*\{([\s\S]*?)\};/,
);
assert(
  presetMapMatch !== null,
  "D1: extracted PDF_SETTINGS_MAP for dynamic eval",
);
if (presetMapMatch) {
  // Build a JS object literal from the TS body: just strip type
  // syntax (already string-only here, no types embedded in values).
  const body = presetMapMatch[1];
  let mapObj;
  try {
    mapObj = new Function(`return {${body}};`)();
  } catch (err) {
    failed++;
    failures.push(
      `D2: failed to eval PDF_SETTINGS_MAP body: ${err instanceof Error ? err.message : err}`,
    );
  }
  if (mapObj) {
    assert(mapObj.light === "/printer", "D3: light → /printer at runtime");
    assert(mapObj.balanced === "/ebook", "D4: balanced → /ebook at runtime");
    assert(mapObj.strong === "/screen", "D5: strong → /screen at runtime");
    assert(
      Object.keys(mapObj).length === 3,
      `D6: PDF_SETTINGS_MAP has exactly 3 entries (got ${Object.keys(mapObj).length})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`pdf-compress-foundation: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
