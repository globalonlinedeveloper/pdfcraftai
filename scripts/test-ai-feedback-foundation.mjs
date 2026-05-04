#!/usr/bin/env node
/**
 * 2026-05-04 — AI feedback foundation guard.
 *
 * PENDING_WORK_ANALYSIS.md §6b ships in two stages:
 *
 *   Stage 1 (this commit): schema + persist endpoint + admin viewer.
 *     The data flywheel foundation. UI integration deferred to a
 *     follow-up commit so the UI cascade can be reviewed
 *     independently of the data pipeline.
 *
 *   Stage 2 (next commit): FeedbackChip component on AI tool result
 *     cards. Wires real users to the ai_feedback table.
 *
 * This guard locks in stage 1's contract:
 *   A. Migration 0022 has the right shape (additive-only, 12 cols,
 *      4 secondary indexes + 1 unique, FKs to users + ai_usage)
 *   B. Drizzle schema matches migration column-for-column
 *   C. POST /api/ai/feedback exists, gates on auth, validates verdict
 *      union, upserts via ON DUPLICATE KEY UPDATE, rate-limits per user
 *   D. /admin/ai-feedback page exists, gates on requireAdmin, queries
 *      the table, renders summary + per-op + recent thumbs-down sections
 *   E. Admin layout NAV includes the new "AI feedback" entry under Ops
 *
 * Output line conforms to aggregator regex `${name}: ${pass} passed,
 * ${fail} failed`.
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

const MIGRATION_PATH = path.join(
  ROOT,
  "db",
  "migrations",
  "0022_ai_feedback.sql",
);
const SCHEMA_PATH = path.join(ROOT, "db", "schema", "app.ts");
const ROUTE_PATH = path.join(ROOT, "app", "api", "ai", "feedback", "route.ts");
const ADMIN_PAGE_PATH = path.join(
  ROOT,
  "app",
  "admin",
  "ai-feedback",
  "page.tsx",
);
const ADMIN_LAYOUT_PATH = path.join(ROOT, "app", "admin", "layout.tsx");

// ============================================================================
// Section A — Migration 0022 contract
// ============================================================================

assert(
  fs.existsSync(MIGRATION_PATH),
  "A0: migration 0022_ai_feedback.sql exists",
);
const migSrc = fs.existsSync(MIGRATION_PATH)
  ? fs.readFileSync(MIGRATION_PATH, "utf8")
  : "";

const execSql = migSrc.replace(/^--.*$/gm, "");

assert(
  /CREATE TABLE\s+`ai_feedback`/.test(execSql),
  "A1: migration creates ai_feedback table",
);

const expectedCols = [
  "id",
  "user_id",
  "ai_usage_id",
  "file_id",
  "operation",
  "verdict",
  "reason",
  "note",
  "provider_id",
  "model",
  "created_at",
  "updated_at",
];
for (const col of expectedCols) {
  assert(
    new RegExp(`\`${col}\``).test(execSql),
    `A2.${col}: column \`${col}\` declared`,
  );
}

// FKs to users (cascade on user delete) + ai_usage (cascade on usage rotation).
assert(
  /FOREIGN KEY\s*\(`user_id`\)[\s\S]{0,80}REFERENCES\s+`users`/.test(execSql),
  "A3: FK on user_id → users (cascade for GDPR/DPDP delete)",
);
assert(
  /FOREIGN KEY\s*\(`ai_usage_id`\)[\s\S]{0,80}REFERENCES\s+`ai_usage`/.test(
    execSql,
  ),
  "A4: FK on ai_usage_id → ai_usage (cascade on usage row delete)",
);

// 1 UNIQUE + 4 secondary indexes.
const uniqCount = (execSql.match(/CREATE UNIQUE INDEX/g) ?? []).length;
const idxCount = (execSql.match(/^CREATE INDEX/gm) ?? []).length;
assert(
  uniqCount === 1,
  `A5: exactly 1 UNIQUE index (user_id, ai_usage_id) — got ${uniqCount}`,
);
assert(
  idxCount === 4,
  `A6: exactly 4 secondary indexes (created/verdict-created/op-created/provider-model-created) — got ${idxCount}`,
);

// ON UPDATE CURRENT_TIMESTAMP on updated_at — the auto-bump on flip.
assert(
  /`updated_at`[\s\S]{0,200}ON UPDATE CURRENT_TIMESTAMP/i.test(execSql),
  "A7: updated_at auto-bumps via ON UPDATE CURRENT_TIMESTAMP (flip rate observable)",
);

// Additive-only.
assert(
  !/\b(DROP|MODIFY|CHANGE)\b/.test(execSql),
  "A8: migration is additive-only (no DROP/MODIFY/CHANGE)",
);

// ============================================================================
// Section B — Drizzle schema parity
// ============================================================================

const schemaSrc = fs.readFileSync(SCHEMA_PATH, "utf8");

assert(
  /export\s+const\s+aiFeedback\s*=\s*mysqlTable\(\s*"ai_feedback"/.test(
    schemaSrc,
  ),
  "B1: aiFeedback Drizzle table exported",
);

const colToField = {
  id: 'id: varchar\\("id"',
  user_id: 'userId: varchar\\("user_id"',
  ai_usage_id: 'aiUsageId: varchar\\("ai_usage_id"',
  file_id: 'fileId: varchar\\("file_id"',
  operation: 'operation: varchar\\("operation"',
  verdict: 'verdict: varchar\\("verdict"',
  reason: 'reason: varchar\\("reason"',
  note: 'note: text\\("note"',
  provider_id: 'providerId: varchar\\("provider_id"',
  model: 'model: varchar\\("model"',
  created_at: 'createdAt: timestamp\\("created_at"',
  updated_at: 'updatedAt: timestamp\\("updated_at"',
};
for (const [col, regex] of Object.entries(colToField)) {
  assert(
    new RegExp(regex).test(schemaSrc),
    `B2.${col}: schema field for ${col}`,
  );
}

// onUpdateNow() on updatedAt — the Drizzle helper that maps to the
// migration's ON UPDATE CURRENT_TIMESTAMP. Removing it would drift
// the schema from the table.
assert(
  /updatedAt[\s\S]{0,120}\.onUpdateNow\(\)/.test(schemaSrc),
  "B3: schema declares updatedAt.onUpdateNow() (matches migration ON UPDATE)",
);

// FK: schema references users.id with cascade. We can't introspect
// .references() easily but checking the literal is good enough.
assert(
  /userId[\s\S]{0,200}references\(\s*\(\)\s*=>\s*users\.id[\s\S]{0,80}onDelete:\s*"cascade"/.test(
    schemaSrc,
  ),
  "B4: schema declares users.id FK with cascade delete",
);

// Indexes mirrored.
for (const idx of [
  "ai_feedback_user_call_uq",
  "ai_feedback_created_idx",
  "ai_feedback_verdict_created_idx",
  "ai_feedback_op_created_idx",
  "ai_feedback_provider_model_created_idx",
]) {
  assert(schemaSrc.includes(idx), `B5.${idx}: schema declares ${idx}`);
}

// ============================================================================
// Section C — POST endpoint
// ============================================================================

assert(fs.existsSync(ROUTE_PATH), "C0: app/api/ai/feedback/route.ts exists");
const routeSrc = fs.readFileSync(ROUTE_PATH, "utf8");

assert(
  /export\s+async\s+function\s+POST/.test(routeSrc),
  "C1: route exports POST handler",
);
assert(
  /from\s+"@\/auth"/.test(routeSrc) && /await\s+auth\(\)/.test(routeSrc),
  "C2: route imports + invokes auth() (PII wall)",
);
assert(
  /"auth_required"/.test(routeSrc),
  "C3: route returns auth_required on anon (401 contract)",
);
assert(
  /z\.enum\(VERDICTS\)/.test(routeSrc) || /z\.enum\(\[\s*"up"/.test(routeSrc),
  "C4: route validates verdict via zod enum (only 'up' | 'down' accepted)",
);
assert(
  /onDuplicateKeyUpdate/.test(routeSrc),
  "C5: route uses onDuplicateKeyUpdate (idempotent flip on UNIQUE conflict)",
);
assert(
  /MAX_PER_WINDOW/.test(routeSrc) && /WINDOW_MS/.test(routeSrc),
  "C6: route has per-user token bucket rate limit (60/min)",
);
assert(
  /rate_limited/.test(routeSrc),
  "C7: route returns rate_limited on bucket exhaustion (429)",
);
// Persist must be in try/catch — same defense-in-depth as contact route.
// The route writes the chained call style:
//   await db
//     .insert(schema.aiFeedback)
//     .values(...)
//     .onDuplicateKeyUpdate(...)
// so the try → insert proximity check has to tolerate `db<newline+ws>.insert`.
// 2000-char window absorbs the inline comment block above the call.
assert(
  /try\s*\{[\s\S]{0,2000}\.insert\(\s*schema\.aiFeedback/.test(routeSrc),
  "C8: persist wrapped in try/catch (db.insert(schema.aiFeedback) inside a try block)",
);
// And a matching catch — the critical part of the contract.
assert(
  /\.insert\(\s*schema\.aiFeedback[\s\S]{0,4000}\}\s*catch\s*\(/.test(
    routeSrc,
  ),
  "C8b: catch block follows the insert (the actual safety net)",
);
assert(
  /persist_failed/.test(routeSrc),
  "C9: route returns persist_failed on DB error (500 contract)",
);
// Verdict echoed back so client UI can confirm.
assert(
  /verdict:\s*v\.verdict/.test(routeSrc),
  "C10: 200 response echoes verdict back (client confirms optimistic UI state)",
);

// ============================================================================
// Section D — Admin viewer
// ============================================================================

assert(
  fs.existsSync(ADMIN_PAGE_PATH),
  "D0: app/admin/ai-feedback/page.tsx exists",
);
const adminSrc = fs.readFileSync(ADMIN_PAGE_PATH, "utf8");

assert(/requireAdmin/.test(adminSrc), "D1: gates on requireAdmin");
assert(
  /schema\.aiFeedback/.test(adminSrc),
  "D2: queries schema.aiFeedback (the new table)",
);
assert(
  /export const dynamic = "force-dynamic"/.test(adminSrc),
  "D3: force-dynamic (always fresh)",
);
assert(
  /export const runtime = "nodejs"/.test(adminSrc),
  "D4: nodejs runtime (db client requirement)",
);
// Three sections: summary cards, per-op table, recent thumbs-down.
assert(
  /Total feedback/.test(adminSrc),
  "D5a: summary section has 'Total feedback' card",
);
assert(
  /By operation/.test(adminSrc),
  "D5b: per-op section heading present",
);
assert(
  /Recent thumbs-down/.test(adminSrc),
  "D5c: recent thumbs-down section heading present",
);
// Page LIMITs to 50 thumbs-down rows (paginate when this becomes a problem).
assert(
  /\.limit\(\s*50\s*\)/.test(adminSrc),
  "D6: thumbs-down query LIMITs to 50 rows",
);

// ============================================================================
// Section E — Admin layout NAV wiring
// ============================================================================

const layoutSrc = fs.readFileSync(ADMIN_LAYOUT_PATH, "utf8");

assert(
  /\/admin\/ai-feedback/.test(layoutSrc),
  "E1: NAV array includes /admin/ai-feedback href",
);
const navMatch = layoutSrc.match(
  /section:\s*"Ops"[\s\S]{0,500}\/admin\/ai-feedback/,
);
assert(
  navMatch !== null,
  "E2: /admin/ai-feedback nav entry is in 'Ops' section (matches rationale)",
);

// ============================================================================
// Output
// ============================================================================

if (failed > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error("  -", f);
}

console.log(`ai-feedback-foundation: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
