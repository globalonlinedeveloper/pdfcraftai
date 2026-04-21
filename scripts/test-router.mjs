#!/usr/bin/env node
// scripts/test-router.mjs
//
// Self-contained test harness for Task #21 / MASTER_PLAN §7 gate #6 —
// the per-op AI router (`lib/ai/router.ts`) plus the new Gemini adapter
// and the updated provider registry.
//
// What this covers:
//
//   SECTION A — AIProviderId + capability types. The types module must
//               include "gemini" in the provider-id union (adapter
//               registrations fail to typecheck otherwise) and keep the
//               pdfInput capability flag that OCR routing depends on.
//
//   SECTION B — lib/ai/router.ts contract checks:
//               * Exports the AIOp union, route(), resolveLadder(),
//                 currentPolicySnapshot(), NoRoutableProviderError, and
//                 __ROUTER_INTERNALS test hook.
//               * Every AIOp has a compiled ROUTING_POLICY row with a
//                 primary + at least one fallback.
//               * Every AIOp declares OP_REQUIRED_CAPABILITY — and OCR
//                 specifically requires pdfInput (the whole reason the
//                 router exists).
//               * Every AIOp has an AI_ROUTER_* env-override name.
//
//   SECTION C — Gemini adapter shipped:
//               * lib/ai/adapters/gemini.ts exists.
//               * Declares pdfInput: true (so the router's OCR ladder
//                 picks it over OpenAI).
//               * Imports from @google/generative-ai.
//               * package.json lists @google/generative-ai.
//
//   SECTION D — Registry wiring:
//               * lib/ai/registry.ts has a row with id "gemini".
//               * Accepts either GEMINI_API_KEY or GOOGLE_API_KEY.
//               * Lazy-imports the adapter (keeps boot safe when the
//                 package is missing, same posture as anthropic/openai).
//
//   SECTION E — Call-site refactor from selectProvider → router.route:
//               * ocr.ts calls route("ocr", …), catches
//                 NoRoutableProviderError.
//               * translate.ts calls route("translate", …).
//               * summarize.ts calls route("summarize", …).
//               * compare.ts calls route("compare", …).
//               * app/api/ai/chat/route.ts calls route("chat", …) and
//                 keeps the refund-then-503 behaviour on
//                 NoRoutableProviderError.
//               * No call-site still uses selectProvider for these ops.
//
// Run: `node scripts/test-router.mjs`
// Exits 0 on pass, 1 on any failure.
//
// Wiring: this harness is listed in scripts/run-all-tests.mjs SUITES so
// `npm test` covers it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const TYPES_PATH = resolve(ROOT, "lib", "ai", "types.ts");
const ROUTER_PATH = resolve(ROOT, "lib", "ai", "router.ts");
const REGISTRY_PATH = resolve(ROOT, "lib", "ai", "registry.ts");
const GEMINI_PATH = resolve(ROOT, "lib", "ai", "adapters", "gemini.ts");
const OCR_PATH = resolve(ROOT, "lib", "ai", "ocr.ts");
const TRANSLATE_PATH = resolve(ROOT, "lib", "ai", "translate.ts");
const SUMMARIZE_PATH = resolve(ROOT, "lib", "ai", "summarize.ts");
const COMPARE_PATH = resolve(ROOT, "lib", "ai", "compare.ts");
// Tier 1 (2026-04-21): rewrite/table/redact promoted to dedicated ops
// with openai primary — see COST_MATRIX_3PROVIDER.md §2, margin move M2.
const REWRITE_PATH = resolve(ROOT, "lib", "ai", "rewrite.ts");
const TABLE_PATH = resolve(ROOT, "lib", "ai", "table.ts");
const REDACT_PATH = resolve(ROOT, "lib", "ai", "redact.ts");
const CHAT_ROUTE_PATH = resolve(ROOT, "app", "api", "ai", "chat", "route.ts");
const PACKAGE_JSON_PATH = resolve(ROOT, "package.json");
// Task #12 (2026-04-22): kill switches + per-user daily cost ceiling.
const KILL_SWITCHES_PATH = resolve(ROOT, "lib", "ai", "kill-switches.ts");
const RATE_LIMIT_PATH = resolve(ROOT, "lib", "ai", "rate-limit.ts");
const ROUTE_GUARDS_PATH = resolve(ROOT, "lib", "ai", "route-guards.ts");
const SCHEMA_APP_PATH = resolve(ROOT, "db", "schema", "app.ts");
const MIGRATION_0009_PATH = resolve(
  ROOT,
  "db",
  "migrations",
  "0009_user_rate_limits.sql",
);
const OP_ROUTE_PATHS = {
  ocr: resolve(ROOT, "app", "api", "ai", "ocr", "route.ts"),
  translate: resolve(ROOT, "app", "api", "ai", "translate", "route.ts"),
  chat: resolve(ROOT, "app", "api", "ai", "chat", "route.ts"),
  summarize: resolve(ROOT, "app", "api", "ai", "summarize", "route.ts"),
  compare: resolve(ROOT, "app", "api", "ai", "compare", "route.ts"),
  generate: resolve(ROOT, "app", "api", "ai", "generate", "route.ts"),
  sign: resolve(ROOT, "app", "api", "ai", "sign", "route.ts"),
  rewrite: resolve(ROOT, "app", "api", "ai", "rewrite", "route.ts"),
  table: resolve(ROOT, "app", "api", "ai", "table", "route.ts"),
  redact: resolve(ROOT, "app", "api", "ai", "redact", "route.ts"),
};

const TYPES_SRC = readFileSync(TYPES_PATH, "utf8");
const ROUTER_SRC = readFileSync(ROUTER_PATH, "utf8");
const REGISTRY_SRC = readFileSync(REGISTRY_PATH, "utf8");
const GEMINI_SRC = readFileSync(GEMINI_PATH, "utf8");
const OCR_SRC = readFileSync(OCR_PATH, "utf8");
const TRANSLATE_SRC = readFileSync(TRANSLATE_PATH, "utf8");
const SUMMARIZE_SRC = readFileSync(SUMMARIZE_PATH, "utf8");
const COMPARE_SRC = readFileSync(COMPARE_PATH, "utf8");
const REWRITE_SRC = readFileSync(REWRITE_PATH, "utf8");
const TABLE_SRC = readFileSync(TABLE_PATH, "utf8");
const REDACT_SRC = readFileSync(REDACT_PATH, "utf8");
const CHAT_SRC = readFileSync(CHAT_ROUTE_PATH, "utf8");
const PACKAGE_JSON_SRC = readFileSync(PACKAGE_JSON_PATH, "utf8");
// Task #12 — kill switches + rate limit module sources.
const KILL_SWITCHES_SRC = readFileSync(KILL_SWITCHES_PATH, "utf8");
const RATE_LIMIT_SRC = readFileSync(RATE_LIMIT_PATH, "utf8");
const ROUTE_GUARDS_SRC = readFileSync(ROUTE_GUARDS_PATH, "utf8");
const SCHEMA_APP_SRC = readFileSync(SCHEMA_APP_PATH, "utf8");
const MIGRATION_0009_SRC = readFileSync(MIGRATION_0009_PATH, "utf8");
const OP_ROUTE_SRCS = Object.fromEntries(
  Object.entries(OP_ROUTE_PATHS).map(([op, p]) => [op, readFileSync(p, "utf8")]),
);

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, condition, detail) {
  if (condition) {
    pass += 1;
  } else {
    fail += 1;
    failures.push({ label, detail });
  }
}

// The canonical operations. Adding an op means adding a row here
// AND to ROUTING_POLICY + OP_REQUIRED_CAPABILITY + OP_ENV_VAR in the
// router. This test pins the set so silent drift (e.g. deleting "sign"
// from the router but not from the types) fails here.
//
// Tier 1 (2026-04-21): rewrite/table/redact promoted from "chat-with-
// extra-prompting" ad-hoc calls into first-class ops with dedicated
// openai primaries — see COST_MATRIX_3PROVIDER.md §2, margin move M2.
const OPS = [
  "ocr",
  "translate",
  "chat",
  "summarize",
  "compare",
  "generate",
  "sign",
  "rewrite",
  "table",
  "redact",
];

// =============================================================================
// SECTION A — lib/ai/types.ts
// =============================================================================

assert(
  "A1 types.ts AIProviderId union includes 'gemini'",
  /export type AIProviderId\s*=\s*"anthropic"\s*\|\s*"openai"\s*\|\s*"gemini"/.test(
    TYPES_SRC
  ) ||
    /export type AIProviderId[\s\S]{0,200}"gemini"/.test(TYPES_SRC),
  "Expected AIProviderId to include the 'gemini' literal"
);

assert(
  "A2 types.ts AICapabilities still declares pdfInput",
  /pdfInput:\s*boolean/.test(TYPES_SRC),
  "pdfInput capability flag missing — OCR routing depends on it"
);

// =============================================================================
// SECTION B — lib/ai/router.ts contract
// =============================================================================

assert(
  "B1 router exports AIOp union",
  /export type AIOp\s*=/.test(ROUTER_SRC),
  "AIOp type export missing"
);

assert(
  "B1 router AIOp union covers every shipped op",
  OPS.every((op) => new RegExp(`"${op}"`).test(ROUTER_SRC)),
  "At least one of ocr/translate/chat/summarize/compare/generate/sign missing from router.ts"
);

assert(
  "B2 router exports route() entry point",
  /export async function route\(/.test(ROUTER_SRC),
  "route() entry point missing from router.ts"
);

assert(
  "B2 router exports resolveLadder() test hook",
  /export function resolveLadder\(/.test(ROUTER_SRC),
  "resolveLadder() helper missing from router.ts"
);

assert(
  "B2 router exports currentPolicySnapshot() diagnostic",
  /export function currentPolicySnapshot\(/.test(ROUTER_SRC),
  "currentPolicySnapshot() diagnostic helper missing"
);

assert(
  "B2 router exports NoRoutableProviderError",
  /export class NoRoutableProviderError/.test(ROUTER_SRC),
  "NoRoutableProviderError class missing — call-sites need it for 503 mapping"
);

assert(
  "B2 router exports __ROUTER_INTERNALS test hook",
  /export const __ROUTER_INTERNALS\b/.test(ROUTER_SRC),
  "__ROUTER_INTERNALS test hook missing"
);

// Policy table present + OCR specifically pins gemini as primary.
assert(
  "B3 router ROUTING_POLICY table declared",
  /const ROUTING_POLICY:\s*Record<AIOp,\s*readonly AIProviderId\[\]>\s*=\s*\{/.test(
    ROUTER_SRC
  ),
  "ROUTING_POLICY Record declaration missing"
);

assert(
  "B3 router OCR policy picks gemini first, anthropic fallback",
  /ocr:\s*\[\s*"gemini"\s*,\s*"anthropic"\s*\]/.test(ROUTER_SRC),
  "OCR primary should be gemini with anthropic fallback"
);

// M1 (2026-04-21) — translate primary flipped from gemini → openai.
// gpt-4o-mini is ~4× cheaper than gemini 2.5 flash for short-form
// bilingual passes (COST_MATRIX_3PROVIDER.md §2).
assert(
  "B3 router translate policy picks openai first (M1 flip, 2026-04-21)",
  /translate:\s*\[\s*"openai"[^\]]*\]/.test(ROUTER_SRC),
  "translate primary should be openai post-M1"
);

assert(
  "B3 router chat policy picks openai first (cheapest streaming)",
  /chat:\s*\[\s*"openai"[^\]]*\]/.test(ROUTER_SRC),
  "chat primary should be openai for cost reasons"
);

// M2 (2026-04-21) — rewrite/table/redact promoted with openai primaries.
assert(
  "B3 router rewrite policy picks openai first (M2, 2026-04-21)",
  /rewrite:\s*\[\s*"openai"[^\]]*\]/.test(ROUTER_SRC),
  "rewrite primary should be openai (gpt-4o-mini ~8× cheaper than haiku)"
);

assert(
  "B3 router table policy picks openai first (M2, 2026-04-21)",
  /table:\s*\[\s*"openai"[^\]]*\]/.test(ROUTER_SRC),
  "table primary should be openai for structured-JSON short-form work"
);

assert(
  "B3 router redact policy picks openai first (M2, 2026-04-21)",
  /redact:\s*\[\s*"openai"[^\]]*\]/.test(ROUTER_SRC),
  "redact primary should be openai for PII span enumeration"
);

assert(
  "B3 router summarize policy picks anthropic first",
  /summarize:\s*\[\s*"anthropic"[^\]]*\]/.test(ROUTER_SRC),
  "summarize primary should be anthropic"
);

assert(
  "B3 router compare policy picks anthropic first",
  /compare:\s*\[\s*"anthropic"[^\]]*\]/.test(ROUTER_SRC),
  "compare primary should be anthropic"
);

assert(
  "B3 router generate policy picks anthropic first",
  /generate:\s*\[\s*"anthropic"[^\]]*\]/.test(ROUTER_SRC),
  "generate primary should be anthropic"
);

assert(
  "B3 router sign policy picks anthropic first",
  /sign:\s*\[\s*"anthropic"[^\]]*\]/.test(ROUTER_SRC),
  "sign primary should be anthropic"
);

// Per-op policy entries: each op must have at least primary + one fallback.
for (const op of OPS) {
  const rowRe = new RegExp(`${op}:\\s*\\[([^\\]]*)\\]`);
  const m = ROUTER_SRC.match(rowRe);
  const ladder = m
    ? m[1].split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  assert(
    `B4 router ROUTING_POLICY.${op} has primary + at least one fallback`,
    ladder.length >= 2,
    `Expected ROUTING_POLICY.${op} to have ≥2 providers (primary + fallback); found ${ladder.length}`
  );
}

// Required capability table.
assert(
  "B5 router OP_REQUIRED_CAPABILITY declared",
  /const OP_REQUIRED_CAPABILITY:\s*Record<AIOp,\s*keyof AICapabilities>/.test(
    ROUTER_SRC
  ),
  "OP_REQUIRED_CAPABILITY table missing"
);

assert(
  "B5 router OP_REQUIRED_CAPABILITY.ocr === 'pdfInput'",
  /ocr:\s*"pdfInput"/.test(ROUTER_SRC),
  "OCR op must declare pdfInput as required capability"
);

for (const op of OPS.filter((o) => o !== "ocr")) {
  assert(
    `B5 router OP_REQUIRED_CAPABILITY.${op} === 'streaming'`,
    new RegExp(`${op}:\\s*"streaming"`).test(ROUTER_SRC),
    `Non-OCR op ${op} should require the universal 'streaming' capability`
  );
}

// Env-override name table.
assert(
  "B6 router OP_ENV_VAR declared",
  /const OP_ENV_VAR:\s*Record<AIOp,\s*string>/.test(ROUTER_SRC),
  "OP_ENV_VAR table missing"
);

for (const op of OPS) {
  const envVarName = `AI_ROUTER_${op.toUpperCase()}`;
  assert(
    `B6 router OP_ENV_VAR.${op} === '${envVarName}'`,
    new RegExp(`${op}:\\s*"${envVarName}"`).test(ROUTER_SRC),
    `Op ${op} should map to env var ${envVarName}`
  );
}

// Caller preferredId + env override precedence semantics.
assert(
  "B7 router resolveLadder considers caller preferredId first",
  /preferredId && VALID_PROVIDER_IDS\.has\(preferredId\)/.test(ROUTER_SRC),
  "Caller preferredId should be pushed onto the ladder first when valid"
);

assert(
  "B7 router resolveLadder reads env override via OP_ENV_VAR",
  /process\.env\[envVar\]/.test(ROUTER_SRC) ||
    /process\.env\[OP_ENV_VAR\[op\]\]/.test(ROUTER_SRC),
  "resolveLadder should read process.env[OP_ENV_VAR[op]] for env-based pinning"
);

assert(
  "B7 router resolveLadder falls through ROUTING_POLICY last",
  /for \(const id of ROUTING_POLICY\[op\]\)/.test(ROUTER_SRC),
  "Compiled ROUTING_POLICY ladder should be appended last"
);

// Invalid env value / caller id is silently ignored (never fail-closed
// because a typo shouldn't 503 the app).
assert(
  "B8 router skips invalid env / caller IDs via VALID_PROVIDER_IDS gate",
  /VALID_PROVIDER_IDS\s*:\s*ReadonlySet<AIProviderId>/.test(ROUTER_SRC),
  "VALID_PROVIDER_IDS set missing — typo'd env values would reach the ladder otherwise"
);

// Capability filter is still applied even with a policy match.
assert(
  "B9 router route() still filters by provider.capabilities[capability]",
  /provider\.capabilities\[capability\]/.test(ROUTER_SRC),
  "route() must keep the capability filter — policy-only isn't enough"
);

// Throws typed error when no provider in the ladder can service the op.
assert(
  "B9 router route() throws NoRoutableProviderError when ladder is empty",
  /throw new NoRoutableProviderError\(op,\s*capability\)/.test(ROUTER_SRC),
  "route() must throw NoRoutableProviderError on empty ladder so callers map to 503"
);

// =============================================================================
// SECTION C — lib/ai/adapters/gemini.ts
// =============================================================================

assert(
  "C1 gemini adapter imports from @google/generative-ai SDK",
  /from\s+"@google\/generative-ai"/.test(GEMINI_SRC),
  "Gemini adapter must import from @google/generative-ai"
);

assert(
  "C1 gemini adapter exports GeminiProvider class",
  /export class GeminiProvider\b/.test(GEMINI_SRC),
  "GeminiProvider class export missing"
);

assert(
  "C1 gemini adapter declares id: 'gemini'",
  /\bid\s*:\s*AIProviderId\s*=\s*"gemini"|readonly id:\s*AIProviderId\s*=\s*"gemini"|id\s*=\s*"gemini"/.test(
    GEMINI_SRC
  ) ||
    /id\s*:\s*"gemini"/.test(GEMINI_SRC),
  "Adapter.id must equal 'gemini'"
);

assert(
  "C1 gemini adapter declares pdfInput: true in capabilities",
  /capabilities\s*:[\s\S]*?pdfInput:\s*true/.test(GEMINI_SRC),
  "Gemini's whole reason-for-being is native PDF input — capability flag must be true"
);

assert(
  "C1 gemini adapter declares streaming: true in capabilities",
  /capabilities\s*:[\s\S]*?streaming:\s*true/.test(GEMINI_SRC),
  "Gemini must advertise streaming capability"
);

assert(
  "C1 gemini adapter implements chat() entry point",
  /\bchat\s*\(/.test(GEMINI_SRC),
  "chat() method missing from adapter"
);

assert(
  "C1 gemini adapter implements streamChat() entry point",
  /\bstreamChat\s*\(/.test(GEMINI_SRC),
  "streamChat() method missing from adapter"
);

assert(
  "C1 gemini adapter maps PDFs to inlineData Part",
  /inlineData:\s*\{[\s\S]*?mimeType/.test(GEMINI_SRC),
  "PDFs should travel via inlineData Part; SDK shape required"
);

// =============================================================================
// SECTION D — lib/ai/registry.ts wiring
// =============================================================================

assert(
  "D1 registry declares gemini adapter row with id: 'gemini'",
  /id:\s*"gemini"/.test(REGISTRY_SRC),
  "Registry ADAPTERS is missing the gemini row"
);

assert(
  "D1 registry accepts GEMINI_API_KEY or GOOGLE_API_KEY",
  /process\.env\.GEMINI_API_KEY[\s\S]*?process\.env\.GOOGLE_API_KEY/.test(
    REGISTRY_SRC
  ),
  "Registry should accept either GEMINI_API_KEY (preferred) or GOOGLE_API_KEY (SDK default)"
);

assert(
  "D1 registry lazy-imports the gemini adapter module",
  /await import\(\s*"\.\/adapters\/gemini"\s*\)/.test(REGISTRY_SRC),
  "Adapter should be lazy-imported so a missing SDK doesn't break boot"
);

assert(
  "D1 registry defaults gemini model to gemini-2.5-flash",
  /defaultModel:\s*process\.env\.GEMINI_MODEL\s*\?\?\s*"gemini-2\.5-flash"/.test(
    REGISTRY_SRC
  ),
  "Gemini default model should be gemini-2.5-flash (cheap, fast, PDF-capable)"
);

// =============================================================================
// SECTION E — call-site refactor (selectProvider → router.route)
// =============================================================================

// ocr.ts
assert(
  "E1 ocr.ts imports route + NoRoutableProviderError from ./router",
  /import\s*\{\s*NoRoutableProviderError\s*,\s*route\s*\}\s*from\s*"\.\/router"/.test(
    OCR_SRC
  ) ||
    /import\s*\{\s*route\s*,\s*NoRoutableProviderError\s*\}\s*from\s*"\.\/router"/.test(
      OCR_SRC
    ),
  "ocr.ts must import { route, NoRoutableProviderError } from './router'"
);

assert(
  "E1 ocr.ts calls route(\"ocr\", { preferredId })",
  /route\(\s*"ocr"\s*,\s*\{\s*preferredId:/.test(OCR_SRC),
  "ocr.ts should call route('ocr', { preferredId: input.preferredProvider })"
);

assert(
  "E1 ocr.ts maps NoRoutableProviderError → NoOcrProviderConfiguredError",
  /instanceof NoRoutableProviderError[\s\S]{0,200}throw new NoOcrProviderConfiguredError/.test(
    OCR_SRC
  ),
  "ocr.ts should catch NoRoutableProviderError and rethrow as NoOcrProviderConfiguredError (preserves 503 surface)"
);

assert(
  "E1 ocr.ts no longer imports selectProvider from ./registry",
  !/import\s*\{\s*selectProvider\s*\}\s*from\s*"\.\/registry"/.test(OCR_SRC),
  "ocr.ts should have dropped the selectProvider import"
);

// translate.ts
assert(
  "E2 translate.ts imports route + NoRoutableProviderError",
  /\broute\b[\s\S]{0,120}from\s*"\.\/router"/.test(TRANSLATE_SRC) &&
    /\bNoRoutableProviderError\b/.test(TRANSLATE_SRC),
  "translate.ts must import { route, NoRoutableProviderError } from './router'"
);

assert(
  "E2 translate.ts calls route(\"translate\", { preferredId })",
  /route\(\s*"translate"\s*,\s*\{\s*preferredId:/.test(TRANSLATE_SRC),
  "translate.ts should call route('translate', { preferredId })"
);

assert(
  "E2 translate.ts no longer imports selectProvider",
  !/import\s*\{\s*selectProvider\s*\}\s*from\s*"\.\/registry"/.test(
    TRANSLATE_SRC
  ),
  "translate.ts should have dropped the selectProvider import"
);

// summarize.ts
assert(
  "E3 summarize.ts imports route + NoRoutableProviderError",
  /\broute\b[\s\S]{0,120}from\s*"\.\/router"/.test(SUMMARIZE_SRC) &&
    /\bNoRoutableProviderError\b/.test(SUMMARIZE_SRC),
  "summarize.ts must import { route, NoRoutableProviderError } from './router'"
);

assert(
  "E3 summarize.ts calls route(\"summarize\", { preferredId })",
  /route\(\s*"summarize"\s*,\s*\{\s*preferredId:/.test(SUMMARIZE_SRC),
  "summarize.ts should call route('summarize', { preferredId })"
);

assert(
  "E3 summarize.ts no longer imports selectProvider",
  !/import\s*\{\s*selectProvider\s*\}\s*from\s*"\.\/registry"/.test(
    SUMMARIZE_SRC
  ),
  "summarize.ts should have dropped the selectProvider import"
);

// compare.ts
assert(
  "E4 compare.ts imports route + NoRoutableProviderError",
  /\broute\b[\s\S]{0,120}from\s*"\.\/router"/.test(COMPARE_SRC) &&
    /\bNoRoutableProviderError\b/.test(COMPARE_SRC),
  "compare.ts must import { route, NoRoutableProviderError } from './router'"
);

assert(
  "E4 compare.ts calls route(\"compare\", { preferredId })",
  /route\(\s*"compare"\s*,\s*\{\s*preferredId:/.test(COMPARE_SRC),
  "compare.ts should call route('compare', { preferredId })"
);

assert(
  "E4 compare.ts no longer imports selectProvider",
  !/import\s*\{\s*selectProvider\s*\}\s*from\s*"\.\/registry"/.test(
    COMPARE_SRC
  ),
  "compare.ts should have dropped the selectProvider import"
);

// app/api/ai/chat/route.ts
assert(
  "E5 chat route imports route + NoRoutableProviderError from @/lib/ai/router",
  /\bNoRoutableProviderError\b[\s\S]{0,200}from\s*"@\/lib\/ai\/router"/.test(
    CHAT_SRC
  ) ||
    /from\s*"@\/lib\/ai\/router"[\s\S]{0,200}\bNoRoutableProviderError\b/.test(
      CHAT_SRC
    ),
  "chat route must import { route, NoRoutableProviderError } from '@/lib/ai/router'"
);

assert(
  "E5 chat route calls route(\"chat\", { preferredId: ... })",
  /route\(\s*"chat"\s*,\s*\{\s*preferredId:/.test(CHAT_SRC),
  "chat route should call route('chat', { preferredId: chatSession.providerId })"
);

assert(
  "E5 chat route preserves refund + 503 on NoRoutableProviderError",
  /instanceof NoRoutableProviderError[\s\S]{0,600}refundCredits[\s\S]{0,600}no_ai_provider_configured/.test(
    CHAT_SRC
  ),
  "chat route must refund credits and return 503 no_ai_provider_configured when router throws NoRoutableProviderError"
);

assert(
  "E5 chat route no longer imports selectProvider from @/lib/ai/registry",
  !/import\s*\{\s*selectProvider\s*\}\s*from\s*"@\/lib\/ai\/registry"/.test(
    CHAT_SRC
  ),
  "chat route should have dropped the selectProvider import"
);

// rewrite.ts (Tier 1 / M2, 2026-04-21)
assert(
  "E6 rewrite.ts imports route + NoRoutableProviderError",
  /\broute\b[\s\S]{0,120}from\s*"\.\/router"/.test(REWRITE_SRC) &&
    /\bNoRoutableProviderError\b/.test(REWRITE_SRC),
  "rewrite.ts must import { route, NoRoutableProviderError } from './router'"
);

assert(
  'E6 rewrite.ts calls route("rewrite", { preferredId })',
  /route\(\s*"rewrite"\s*,\s*\{\s*preferredId:/.test(REWRITE_SRC),
  "rewrite.ts should call route('rewrite', { preferredId })"
);

assert(
  "E6 rewrite.ts maps NoRoutableProviderError → NoAIProviderConfiguredError",
  /instanceof NoRoutableProviderError[\s\S]{0,200}throw new NoAIProviderConfiguredError/.test(
    REWRITE_SRC
  ),
  "rewrite.ts should catch NoRoutableProviderError and rethrow as NoAIProviderConfiguredError"
);

assert(
  "E6 rewrite.ts no longer imports selectProvider",
  !/import\s*\{\s*selectProvider\s*\}\s*from\s*"\.\/registry"/.test(REWRITE_SRC),
  "rewrite.ts should have dropped the selectProvider import"
);

// table.ts (Tier 1 / M2, 2026-04-21)
assert(
  "E7 table.ts imports route + NoRoutableProviderError",
  /\broute\b[\s\S]{0,120}from\s*"\.\/router"/.test(TABLE_SRC) &&
    /\bNoRoutableProviderError\b/.test(TABLE_SRC),
  "table.ts must import { route, NoRoutableProviderError } from './router'"
);

assert(
  'E7 table.ts calls route("table", { preferredId })',
  /route\(\s*"table"\s*,\s*\{\s*preferredId:/.test(TABLE_SRC),
  "table.ts should call route('table', { preferredId })"
);

assert(
  "E7 table.ts maps NoRoutableProviderError → NoAIProviderConfiguredError",
  /instanceof NoRoutableProviderError[\s\S]{0,200}throw new NoAIProviderConfiguredError/.test(
    TABLE_SRC
  ),
  "table.ts should catch NoRoutableProviderError and rethrow as NoAIProviderConfiguredError"
);

assert(
  "E7 table.ts no longer imports selectProvider",
  !/import\s*\{\s*selectProvider\s*\}\s*from\s*"\.\/registry"/.test(TABLE_SRC),
  "table.ts should have dropped the selectProvider import"
);

// redact.ts (Tier 1 / M2, 2026-04-21)
assert(
  "E8 redact.ts imports route + NoRoutableProviderError",
  /\broute\b[\s\S]{0,120}from\s*"\.\/router"/.test(REDACT_SRC) &&
    /\bNoRoutableProviderError\b/.test(REDACT_SRC),
  "redact.ts must import { route, NoRoutableProviderError } from './router'"
);

assert(
  'E8 redact.ts calls route("redact", { preferredId })',
  /route\(\s*"redact"\s*,\s*\{\s*preferredId:/.test(REDACT_SRC),
  "redact.ts should call route('redact', { preferredId })"
);

assert(
  "E8 redact.ts maps NoRoutableProviderError → NoAIProviderConfiguredError",
  /instanceof NoRoutableProviderError[\s\S]{0,200}throw new NoAIProviderConfiguredError/.test(
    REDACT_SRC
  ),
  "redact.ts should catch NoRoutableProviderError and rethrow as NoAIProviderConfiguredError"
);

assert(
  "E8 redact.ts no longer imports selectProvider",
  !/import\s*\{\s*selectProvider\s*\}\s*from\s*"\.\/registry"/.test(REDACT_SRC),
  "redact.ts should have dropped the selectProvider import"
);

// =============================================================================
// SECTION F — package.json dependency
// =============================================================================

assert(
  "F1 package.json lists @google/generative-ai dependency",
  /"@google\/generative-ai"\s*:\s*"[^"]+"/.test(PACKAGE_JSON_SRC),
  "package.json must list @google/generative-ai under dependencies"
);

// =============================================================================
// SECTION G — Task #12 kill switches (lib/ai/kill-switches.ts)
// =============================================================================
//
// Pins the env-var naming scheme (so a rename breaks here, not in
// production when an operator flips a stale var name), the truthy
// vocabulary, the public reader surface, and the router's ladder-walk
// integration. Matches the "Test story" block in kill-switches.ts.

assert(
  "G1 kill-switches.ts declares server-only boundary",
  /^import\s+"server-only"/m.test(KILL_SWITCHES_SRC),
  'lib/ai/kill-switches.ts must import "server-only" — env reads must never run on the client'
);

assert(
  "G2 kill-switches.ts exports PROVIDER_KILL_ENV_VAR",
  /export const PROVIDER_KILL_ENV_VAR\b/.test(KILL_SWITCHES_SRC),
  "PROVIDER_KILL_ENV_VAR map must be exported so admin page + tests see the same names"
);

assert(
  "G2 kill-switches.ts exports OP_KILL_ENV_VAR",
  /export const OP_KILL_ENV_VAR\b/.test(KILL_SWITCHES_SRC),
  "OP_KILL_ENV_VAR map must be exported"
);

// Provider env-var names follow the AI_KILL_<UPPER_PROVIDER> scheme.
for (const prov of ["ANTHROPIC", "OPENAI", "GEMINI"]) {
  assert(
    `G3 kill-switches.ts declares AI_KILL_${prov}`,
    new RegExp(`"AI_KILL_${prov}"`).test(KILL_SWITCHES_SRC),
    `AI_KILL_${prov} env var name missing from kill-switches.ts`
  );
}

// Op env-var names follow the AI_KILL_<UPPER_OP> scheme, one per shipped op.
for (const op of OPS) {
  assert(
    `G4 kill-switches.ts declares AI_KILL_${op.toUpperCase()}`,
    new RegExp(`"AI_KILL_${op.toUpperCase()}"`).test(KILL_SWITCHES_SRC),
    `AI_KILL_${op.toUpperCase()} env var name missing — every AIOp needs a kill switch`
  );
}

// Reader function exports — these are the public surface that router.ts,
// route-guards.ts, and the admin page depend on.
for (const exp of [
  "isKillValueTruthy",
  "isProviderKilled",
  "isOpKilled",
  "killedProviders",
  "killedOps",
  "killSwitchSnapshot",
  "assertOpNotKilled",
]) {
  assert(
    `G5 kill-switches.ts exports ${exp}`,
    new RegExp(`export (async )?function ${exp}\\b`).test(KILL_SWITCHES_SRC),
    `${exp} must be exported from lib/ai/kill-switches.ts`
  );
}

assert(
  "G5 kill-switches.ts exports OpKilledError",
  /export class OpKilledError\b/.test(KILL_SWITCHES_SRC),
  "OpKilledError class must be exported so route-guards.ts can instanceof-check it"
);

// Truthy vocabulary — must accept "true"/"1"/"yes"/"on" (the operator-
// facing affirmatives). If a future refactor silently drops "yes" or
// "on", ops runbooks become lies — this test catches that.
for (const truthy of ["true", "1", "yes", "on"]) {
  assert(
    `G6 isKillValueTruthy accepts "${truthy}"`,
    new RegExp(`normalized === "${truthy}"`).test(KILL_SWITCHES_SRC),
    `isKillValueTruthy must accept "${truthy}" (case-insensitive) — operator vocabulary`
  );
}

// Router integration — route() must skip killed providers during the
// ladder walk. Matches the "router skips killed providers" assertion in
// kill-switches.ts's test-story comment.
assert(
  "G7 router.ts imports isProviderKilled",
  /\bisProviderKilled\b[\s\S]{0,120}from\s*"\.\/kill-switches"/.test(
    ROUTER_SRC,
  ),
  "router.ts must import isProviderKilled from ./kill-switches"
);

assert(
  "G7 router.ts skips killed providers in ladder walk",
  /if\s*\(\s*isProviderKilled\s*\(\s*id\s*\)\s*\)\s*continue/.test(ROUTER_SRC),
  "router.ts route() must `continue` past any id where isProviderKilled(id) === true"
);

// =============================================================================
// SECTION H — Task #12 per-user daily cost ceiling (lib/ai/rate-limit.ts)
// =============================================================================
//
// Pins the cap-resolution contract (row → env → default), the default
// value (so nobody silently 100x's it to $50/day in a refactor), the
// public API surface, the error class, the UTC-day math, and the 10
// route-handler wiring via the shared route-guards helper.

assert(
  "H1 rate-limit.ts declares server-only boundary",
  /^import\s+"server-only"/m.test(RATE_LIMIT_SRC),
  'lib/ai/rate-limit.ts must import "server-only"'
);

assert(
  "H2 rate-limit.ts exports DEFAULT_DAILY_COST_CAP_MICROS",
  /export const DEFAULT_DAILY_COST_CAP_MICROS\b/.test(RATE_LIMIT_SRC),
  "DEFAULT_DAILY_COST_CAP_MICROS constant must be exported"
);

assert(
  "H2 DEFAULT_DAILY_COST_CAP_MICROS === 500_000 ($0.50/day)",
  /DEFAULT_DAILY_COST_CAP_MICROS\s*=\s*500[_]?000\b/.test(RATE_LIMIT_SRC),
  "Default cap must stay 500000 µUSD until we have distribution data — do not raise silently"
);

assert(
  "H2 rate-limit.ts exports DAILY_COST_CAP_ENV_VAR",
  /export const DAILY_COST_CAP_ENV_VAR\s*=\s*"USER_DAILY_COST_MICROS_CAP"/.test(
    RATE_LIMIT_SRC,
  ),
  "DAILY_COST_CAP_ENV_VAR must be exported as the literal 'USER_DAILY_COST_MICROS_CAP'"
);

for (const exp of [
  "resolveDailyCapMicros",
  "utcDayBounds",
  "secondsUntilNextUtcMidnight",
  "checkUserDailyCost",
  "assertWithinDailyCap",
]) {
  assert(
    `H3 rate-limit.ts exports ${exp}`,
    new RegExp(`export (async )?function ${exp}\\b`).test(RATE_LIMIT_SRC),
    `${exp} must be exported from lib/ai/rate-limit.ts`
  );
}

assert(
  "H3 rate-limit.ts exports DailyCostCeilingExceededError",
  /export class DailyCostCeilingExceededError\b/.test(RATE_LIMIT_SRC),
  "DailyCostCeilingExceededError class must be exported"
);

// Cap resolution: override → env → default. The ordered branches in
// resolveDailyCapMicros must be present — a refactor that accidentally
// swaps "env before override" changes the security posture silently.
assert(
  "H4 resolveDailyCapMicros prefers override when non-null",
  /if\s*\(\s*override\s*!==\s*null\s*\)\s*return\s+override/.test(
    RATE_LIMIT_SRC,
  ),
  "resolveDailyCapMicros must return override first if present"
);

assert(
  "H4 resolveDailyCapMicros falls back to env then default",
  /parseEnvCap\(\)[\s\S]{0,120}DEFAULT_DAILY_COST_CAP_MICROS/.test(
    RATE_LIMIT_SRC,
  ),
  "resolveDailyCapMicros must fall through to env then the hard-coded default"
);

// Strict >= comparison (the comment in rate-limit.ts explains why).
assert(
  "H5 assertWithinDailyCap uses strict used >= cap semantics (allowed = used < cap)",
  /allowed\s*=\s*used\s*<\s*capMicros/.test(RATE_LIMIT_SRC),
  "checkUserDailyCost must compare used < cap (strict) so a tied used === cap refuses the NEXT call"
);

assert(
  "H5 assertWithinDailyCap throws DailyCostCeilingExceededError on !allowed",
  /if\s*\(\s*!allowed\s*\)[\s\S]{0,200}throw new DailyCostCeilingExceededError/.test(
    RATE_LIMIT_SRC,
  ),
  "assertWithinDailyCap must throw DailyCostCeilingExceededError when allowed === false"
);

// Schema + migration exist — a missing table blows up at runtime only,
// which is too late. Catch it here.
assert(
  "H6 db/schema/app.ts declares userRateLimits table",
  /export const userRateLimits\s*=\s*mysqlTable\(\s*"user_rate_limits"/.test(
    SCHEMA_APP_SRC,
  ),
  "userRateLimits Drizzle table must be declared in db/schema/app.ts"
);

assert(
  "H6 userRateLimits declares dailyCostCapMicros column",
  /dailyCostCapMicros:\s*bigint\(\s*"daily_cost_cap_micros"/.test(
    SCHEMA_APP_SRC,
  ),
  "userRateLimits must have a dailyCostCapMicros bigint column"
);

assert(
  "H6 migration 0009 creates user_rate_limits table",
  /CREATE TABLE[\s\S]{0,60}user_rate_limits/.test(MIGRATION_0009_SRC),
  "db/migrations/0009_user_rate_limits.sql must CREATE TABLE user_rate_limits"
);

// Route-guards consolidation — every op must route through it.
assert(
  "H7 route-guards.ts imports OpKilledError + assertOpNotKilled",
  /OpKilledError[\s\S]{0,80}assertOpNotKilled/.test(ROUTE_GUARDS_SRC) &&
    /from\s*"\.\/kill-switches"/.test(ROUTE_GUARDS_SRC),
  "route-guards.ts must pull OpKilledError and assertOpNotKilled from ./kill-switches"
);

assert(
  "H7 route-guards.ts imports DailyCostCeilingExceededError + assertWithinDailyCap",
  /DailyCostCeilingExceededError[\s\S]{0,80}assertWithinDailyCap/.test(
    ROUTE_GUARDS_SRC,
  ) && /from\s*"\.\/rate-limit"/.test(ROUTE_GUARDS_SRC),
  "route-guards.ts must pull DailyCostCeilingExceededError and assertWithinDailyCap from ./rate-limit"
);

assert(
  "H7 route-guards.ts exports guardAiRoute",
  /export async function guardAiRoute\s*\(/.test(ROUTE_GUARDS_SRC),
  "guardAiRoute must be the exported entry point for route handlers"
);

assert(
  "H7 route-guards.ts maps OpKilledError → status 503 with op_disabled",
  /instanceof OpKilledError[\s\S]{0,400}status:\s*503[\s\S]{0,200}op_disabled/.test(
    ROUTE_GUARDS_SRC,
  ) ||
    /op_disabled[\s\S]{0,400}status:\s*503/.test(ROUTE_GUARDS_SRC),
  "route-guards.ts must return HTTP 503 with error:'op_disabled' for OpKilledError"
);

assert(
  "H7 route-guards.ts maps DailyCostCeilingExceededError → status 429",
  /instanceof DailyCostCeilingExceededError[\s\S]{0,800}status:\s*429/.test(
    ROUTE_GUARDS_SRC,
  ) ||
    /daily_cost_ceiling_exceeded[\s\S]{0,400}status:\s*429/.test(
      ROUTE_GUARDS_SRC,
    ),
  "route-guards.ts must return HTTP 429 for DailyCostCeilingExceededError"
);

assert(
  "H7 route-guards.ts sets Retry-After from err.retryAfterSeconds",
  /"Retry-After":\s*String\(\s*err\.retryAfterSeconds\s*\)/.test(
    ROUTE_GUARDS_SRC,
  ),
  "route-guards.ts must set Retry-After to the error's retryAfterSeconds value"
);

// Route handler wiring — every one of the 10 ops must call guardAiRoute
// with its op string. This is the test that catches the "added a new op
// but forgot to wire the gate" drift.
for (const [op, src] of Object.entries(OP_ROUTE_SRCS)) {
  assert(
    `H8 /api/ai/${op}/route.ts imports guardAiRoute`,
    /import\s*\{\s*guardAiRoute\s*\}\s*from\s*"@\/lib\/ai\/route-guards"/.test(
      src,
    ),
    `app/api/ai/${op}/route.ts must import guardAiRoute from @/lib/ai/route-guards`
  );
  assert(
    `H8 /api/ai/${op}/route.ts calls guardAiRoute("${op}", userId)`,
    new RegExp(
      `guardAiRoute\\(\\s*"${op}"\\s*,\\s*userId\\s*\\)`,
    ).test(src),
    `app/api/ai/${op}/route.ts must call guardAiRoute("${op}", userId)`
  );
  assert(
    `H8 /api/ai/${op}/route.ts early-returns when gate trips`,
    /if\s*\(\s*gate\s*\)\s*return\s+gate/.test(src),
    `app/api/ai/${op}/route.ts must return the gate Response when guardAiRoute yields non-null`
  );
}

// =============================================================================
// Report
// =============================================================================

const total = pass + fail;
console.log("");
console.log(`test-router.mjs — ${pass}/${total} assertions passed`);
// Canonical summary line — parsed by scripts/run-all-tests.mjs.
console.log(`AI-router tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("");
  console.error("FAILURES:");
  for (const f of failures) {
    console.error(`  ✗ ${f.label}`);
    console.error(`      ${f.detail}`);
  }
  process.exit(1);
}
process.exit(0);
