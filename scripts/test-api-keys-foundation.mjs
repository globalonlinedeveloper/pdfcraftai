#!/usr/bin/env node
/**
 * 2026-05-08 — API keys foundation guard (Tier 1 #1).
 *
 * Pins the mint / revoke / list / verify pipeline that productizes
 * the api_keys table. Schema was already shipped earlier; this
 * guard locks in:
 *   - lib/api-keys/index.ts public surface (mintKey, verifyKey,
 *     revokeKey, listKeys, activeKeyCount, ACTIVE_KEY_LIMIT)
 *   - Token format invariants (pck_ prefix, SHA-256 hash, 68-char
 *     raw, 12-char display prefix)
 *   - Server actions on /app/api-keys (anti-impersonation pattern)
 *   - Manager UI shape (mint form + active list + revoked-audit list
 *     + one-time fresh-key reveal)
 *
 * Pure static parse, sub-second.
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

const HELPER = path.join(ROOT, "lib/api-keys/index.ts");
const ACTIONS = path.join(ROOT, "app/app/api-keys/actions.ts");
const MANAGER = path.join(ROOT, "app/app/api-keys/ApiKeyManager.tsx");
const PAGE = path.join(ROOT, "app/app/api-keys/page.tsx");
const SCHEMA = path.join(ROOT, "db/schema/app.ts");

// ---------------------------------------------------------------------------
// Section A: helper module public surface
// ---------------------------------------------------------------------------

assert(fs.existsSync(HELPER), "A1: lib/api-keys/index.ts exists");
const helperSrc = fs.existsSync(HELPER) ? fs.readFileSync(HELPER, "utf8") : "";

assert(
  /export\s+async\s+function\s+mintKey\b/.test(helperSrc),
  "A2: mintKey exported async",
);
assert(
  /export\s+async\s+function\s+verifyKey\b/.test(helperSrc),
  "A3: verifyKey exported async",
);
assert(
  /export\s+async\s+function\s+revokeKey\b/.test(helperSrc),
  "A4: revokeKey exported async",
);
assert(
  /export\s+async\s+function\s+listKeys\b/.test(helperSrc),
  "A5: listKeys exported async",
);
assert(
  /export\s+async\s+function\s+activeKeyCount\b/.test(helperSrc),
  "A6: activeKeyCount exported async",
);
assert(
  /export\s+const\s+ACTIVE_KEY_LIMIT\s*=\s*5\b/.test(helperSrc),
  "A7: ACTIVE_KEY_LIMIT = 5 exported (per-user cap)",
);

// ---------------------------------------------------------------------------
// Section B: token format invariants
// ---------------------------------------------------------------------------

assert(
  /KEY_PREFIX\s*=\s*"pck_"/.test(helperSrc),
  "B1: KEY_PREFIX = 'pck_' (greppable + distinguishable from user input)",
);
assert(
  /RANDOM_BYTES\s*=\s*32\b/.test(helperSrc),
  "B2: RANDOM_BYTES = 32 (256 bits entropy — collision-free)",
);
assert(
  /createHash\(\s*"sha256"\s*\)/.test(helperSrc),
  "B3: hashKey uses SHA-256 (matches api_keys.key_hash varchar(128))",
);
// Defensive shape check — verifyKey must reject inputs that don't
// match the expected length + prefix BEFORE hitting the DB
assert(
  /raw\.length\s*!==\s*68/.test(helperSrc),
  "B4: verifyKey rejects raw not exactly 68 chars (4 prefix + 64 hex)",
);
assert(
  /raw\.startsWith\(KEY_PREFIX\)/.test(helperSrc),
  "B5: verifyKey rejects raw without 'pck_' prefix",
);

// ---------------------------------------------------------------------------
// Section C: anti-DB-leak posture
// ---------------------------------------------------------------------------

// Raw key NEVER stored — only key_hash. The mintKey writes
// keyHash: hashKey(rawKey), never raw.
assert(
  /keyHash:\s*hashKey\(rawKey\)/.test(helperSrc),
  "C1: mintKey persists key_hash (NEVER raw key — DB leak doesn't expose live keys)",
);

// Display prefix is the first 12 chars (pck_ + 8 hex) — UI shows
// this so users can distinguish keys without revealing the rest
assert(
  /raw\.slice\(\s*0,\s*12\s*\)/.test(helperSrc),
  "C2: displayPrefix = first 12 chars (pck_ + 8 hex) — UI distinguish without leaking",
);

// ---------------------------------------------------------------------------
// Section D: revoke semantics
// ---------------------------------------------------------------------------

// Soft-delete: sets revoked_at, leaves row in place (audit trail)
assert(
  /set\(\{\s*revokedAt:\s*new Date\(\)\s*\}\)/.test(helperSrc),
  "D1: revokeKey sets revoked_at (soft-delete; row stays for audit)",
);
// Owner check — a user can only revoke their own keys
assert(
  /row\.userId\s*!==\s*byUserId/.test(helperSrc),
  "D2: revokeKey enforces row.userId === byUserId (own-keys-only)",
);
// Verify rejects revoked keys
assert(
  /row\.revokedAt\s*!==\s*null/.test(helperSrc),
  "D3: verifyKey rejects when revoked_at !== null",
);

// ---------------------------------------------------------------------------
// Section E: telemetry
// ---------------------------------------------------------------------------

// last_used_at update on verify hit — best-effort, fire-and-forget
assert(
  /set\(\{\s*lastUsedAt:\s*new Date\(\)\s*\}\)/.test(helperSrc),
  "E1: verifyKey updates last_used_at on hit (telemetry)",
);
// Fire-and-forget — `void db.update(...).catch(...)` so verify
// latency stays minimal
assert(
  /void\s+db\s*\n?\s*\.update/.test(helperSrc) ||
    /void db\.update/.test(helperSrc),
  "E2: last_used_at update is fire-and-forget (verify latency unaffected on telemetry write fail)",
);

// ---------------------------------------------------------------------------
// Section F: server actions (anti-impersonation)
// ---------------------------------------------------------------------------

assert(fs.existsSync(ACTIONS), "F1: app/app/api-keys/actions.ts exists");
const actionsSrc = fs.existsSync(ACTIONS)
  ? fs.readFileSync(ACTIONS, "utf8")
  : "";

assert(
  /^"use server"/m.test(actionsSrc),
  "F2: actions.ts is a server-action module",
);
assert(
  /export\s+async\s+function\s+mintKeyAction\b/.test(actionsSrc),
  "F3: mintKeyAction exported",
);
assert(
  /export\s+async\s+function\s+revokeKeyAction\b/.test(actionsSrc),
  "F4: revokeKeyAction exported",
);

// userId from session, NEVER from input
assert(
  /userId:\s*userId/.test(actionsSrc) ||
    /mintKey\(\s*\{\s*userId,/.test(actionsSrc),
  "F5: mintKeyAction passes userId from session (anti-impersonation)",
);
assert(
  /byUserId:\s*userId/.test(actionsSrc),
  "F6: revokeKeyAction passes byUserId from session (anti-impersonation)",
);
// Negative — input must NOT carry userId
assert(
  !/userId:\s*input\.userId/.test(actionsSrc) &&
    !/byUserId:\s*input\.byUserId/.test(actionsSrc),
  "F7: actions do NOT read userId/byUserId from input (would allow impersonation)",
);

// ACTIVE_KEY_LIMIT enforced at action layer
assert(
  /active\s*>=\s*ACTIVE_KEY_LIMIT/.test(actionsSrc),
  "F8: mintKeyAction enforces ACTIVE_KEY_LIMIT cap (prevents accidental key explosion)",
);

// Anti-enumeration on revoke — not_owner returns "not_found" copy
assert(
  /not_owner[\s\S]{0,200}?Key not found/.test(actionsSrc) ||
    /reason\s*===\s*"not_owner"[\s\S]{0,300}?Key not found/.test(actionsSrc),
  "F9: revokeKeyAction returns generic 'Key not found' on not_owner (no key-existence enumeration)",
);

// ---------------------------------------------------------------------------
// Section G: page + manager UI
// ---------------------------------------------------------------------------

assert(fs.existsSync(PAGE), "G1: app/app/api-keys/page.tsx exists");
const pageSrc = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, "utf8") : "";

// Page is auth-gated
assert(
  /redirect\(\s*"\/login\?callbackUrl=\/app\/api-keys"\s*\)/.test(pageSrc),
  "G2: page redirects unauthenticated visitors to /login with callbackUrl preserved",
);
// Page no longer shows "API access is coming soon" placeholder
// (skip comment lines via line-based scan)
{
  const placeholderInUserFacing = pageSrc
    .split("\n")
    .some(
      (line) =>
        line.includes("API access is coming soon") &&
        !line.trim().startsWith("//"),
    );
  assert(
    !placeholderInUserFacing,
    "G3: placeholder copy removed from user-facing markup (real management UI now ships)",
  );
}
// Date columns serialized to ISO string (Server→Client must be
// JSON-serializable; Date doesn't survive the boundary)
assert(
  /toISOString\(\)/.test(pageSrc),
  "G4: page serializes dates to ISO strings before passing to client (Server→Client serializable)",
);

assert(
  fs.existsSync(MANAGER),
  "G5: app/app/api-keys/ApiKeyManager.tsx exists",
);
const managerSrc = fs.existsSync(MANAGER)
  ? fs.readFileSync(MANAGER, "utf8")
  : "";

assert(
  /^"use client"/m.test(managerSrc),
  "G6: ApiKeyManager is a client component",
);

// Mint flow + raw-key reveal
assert(
  /mintKeyAction\(/.test(managerSrc),
  "G7: ApiKeyManager calls mintKeyAction",
);
assert(
  /freshKey/.test(managerSrc) && /rawKey/.test(managerSrc),
  "G8: ApiKeyManager surfaces raw key in a one-time reveal block (freshKey state)",
);

// Copy-to-clipboard for the freshly minted key
assert(
  /copyText\s*\(/.test(managerSrc),
  "G9: ApiKeyManager copies raw key via the shared copyText() helper (one-time reveal UX)",
);

// "Have you copied it?" confirmation before dismissing the reveal —
// guards against losing the key
assert(
  /confirm\(/.test(managerSrc),
  "G10: ApiKeyManager confirm()-gates the dismiss action (prevents accidental key loss)",
);

// Active + revoked sections separately rendered (audit trail)
assert(
  /activeKeys/.test(managerSrc) && /revokedKeys/.test(managerSrc),
  "G11: ApiKeyManager separates active + revoked keys (audit trail)",
);

// Revoke calls revokeKeyAction
assert(
  /revokeKeyAction\(/.test(managerSrc),
  "G12: ApiKeyManager calls revokeKeyAction",
);

// ---------------------------------------------------------------------------
// Section H: schema parity (api_keys table — already shipped, pin it)
// ---------------------------------------------------------------------------

const schemaSrc = fs.readFileSync(SCHEMA, "utf8");
assert(
  /export\s+const\s+apiKeys\s*=\s*mysqlTable\(/.test(schemaSrc),
  "H1: apiKeys Drizzle table exported",
);
assert(
  /keyHash:\s*varchar\("key_hash",\s*\{\s*length:\s*128\s*\}\)\.notNull\(\)\.unique\(\)/.test(
    schemaSrc,
  ),
  "H2: api_keys.key_hash is varchar(128) NOT NULL UNIQUE (matches SHA-256 hex 64 chars + headroom)",
);
assert(
  /revokedAt:\s*timestamp\("revoked_at"/.test(schemaSrc),
  "H3: api_keys.revoked_at column exists (soft-delete pin)",
);

// ---------------------------------------------------------------------------
// Section I: resolveUser middleware + AI route wiring (Tier 1 #1
// follow-on, 2026-05-08). Threads x-api-key header → userId
// resolution into all 11 AI op routes via lib/auth/resolve-user.ts.
// ---------------------------------------------------------------------------

const RESOLVE_USER = path.join(ROOT, "lib/auth/resolve-user.ts");

assert(fs.existsSync(RESOLVE_USER), "I1: lib/auth/resolve-user.ts exists");
const resolveSrc = fs.existsSync(RESOLVE_USER)
  ? fs.readFileSync(RESOLVE_USER, "utf8")
  : "";

assert(
  /export\s+async\s+function\s+resolveUser\b/.test(resolveSrc),
  "I2: resolveUser exported async",
);
// Reads x-api-key header (NOT Authorization: Bearer — that's reserved
// for cron secret per the comment in the file)
assert(
  /req\.headers\.get\("x-api-key"\)/.test(resolveSrc),
  "I3: resolveUser reads x-api-key header (NOT Authorization: Bearer)",
);
// Calls verifyKey from lib/api-keys
assert(
  /verifyKey\(/.test(resolveSrc) &&
    /from\s+"@\/lib\/api-keys"/.test(resolveSrc),
  "I4: resolveUser calls verifyKey from lib/api-keys",
);
// Anti-downgrade: if header is sent but doesn't verify, return null
// (do NOT fall through to session-fallback)
assert(
  /Header was sent but didn't verify[\s\S]{0,200}?return null/.test(
    resolveSrc,
  ) ||
    /\/\/ Don't[\s\S]{0,200}?return null/.test(resolveSrc),
  "I5: resolveUser does NOT fall through to session when x-api-key is set but invalid (anti-downgrade)",
);
// Source discriminator on the return shape
assert(
  /source:\s*"(api_key|session)"/.test(resolveSrc),
  "I6: resolveUser returns source: 'api_key' | 'session' discriminator",
);

// ----- AI route wiring -----
const AI_OPS = [
  "summarize",
  "chat",
  "translate",
  "ocr",
  "rewrite",
  "table",
  "compare",
  "sign",
  "redact",
  "generate",
  "estimate",
];

for (const op of AI_OPS) {
  const routePath = path.join(ROOT, `app/api/ai/${op}/route.ts`);
  if (!fs.existsSync(routePath)) {
    assert(false, `I7-${op}: app/api/ai/${op}/route.ts exists`);
    continue;
  }
  const src = fs.readFileSync(routePath, "utf8");

  // Imports resolveUser (replaces the old `import { auth } from "@/auth"`)
  assert(
    /import\s+\{\s+resolveUser\s+\}\s+from\s+"@\/lib\/auth\/resolve-user"/.test(
      src,
    ),
    `I7-${op}: imports resolveUser from "@/lib/auth/resolve-user"`,
  );
  // Calls it inside the handler with req
  assert(
    /resolveUser\(req\)/.test(src),
    `I8-${op}: calls resolveUser(req) in the route handler`,
  );
  // No leftover `auth()` calls (would mean the replacement missed
  // somewhere)
  assert(
    !/const session = await auth\(\)/.test(src),
    `I9-${op}: no leftover 'const session = await auth()' (replacement complete)`,
  );
  // userId is still extracted
  assert(
    /const userId = resolved\.userId/.test(src),
    `I10-${op}: extracts userId from resolved.userId`,
  );
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`api-keys-foundation: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
