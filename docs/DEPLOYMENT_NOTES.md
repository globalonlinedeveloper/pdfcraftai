# pdfcraftai.com — Deployment & Session Notes

_Last updated: 2026-04-21 (Task #22 code-side — daily margin rollup cron + 7-day green streak metric)_

## Production environment

- **Host:** Hostinger (managed Next.js hosting, hPanel)
- **CDN / Proxy:** Cloudflare (proxy enabled — confirmed via `cf-ray`, `server: cloudflare`, `cf-cache-status: DYNAMIC`)
- **Domain:** https://pdfcraftai.com (apex + www redirect)
- **Current commit at last successful deploy:** `0ba0665` (2026-04-21, Task #22 code-side — daily margin rollup cron + 7-day green streak metric / MASTER_PLAN §7 gate #7 / Phase A4. Seven-file bundle: (1) new `db/migrations/0006_ai_daily_margin.sql` (17 columns: id varchar(36) PK, date DATE, provider_id varchar(32), model varchar(128), operation varchar(32), 3 int counters call/success/error_count, 6 bigint sums input_tokens/output_tokens/latency_ms/credits_spent/cost_micros/revenue_micros, margin_bps/floor_bps int, is_green int, created_at timestamp(3) default current_timestamp(3)), composite UNIQUE `ai_daily_margin_slice_idx (date, provider_id, model, operation)` + 3 regular indexes (`date_idx`, `date_green_idx`, `provider_date_idx`). Docstring cites gate #7 + Phase A4 explicitly and explains the revenue-proxy methodology (30,000 µUSD/credit midpoint of Creator $0.036 + Pro $0.027 per-credit pricing — `credit_ledger` records debits in credits not USD so margin math needs a reference price). (2) `db/schema/app.ts` edit — `date` added to drizzle-orm/mysql-core imports, `aiDailyMargin` mysqlTable export appended (~95 lines): `date({ mode: "string" })` for clean YYYY-MM-DD handling, `bigint({ mode: "number" })` for the 6 sum columns, uniqueIndex + 3 regular index declarations matching the migration byte-for-byte. (3) new `lib/ai/margin-rollup.ts` (~430 lines) — Phase A4 analytical core. Exports `REFERENCE_USD_MICROS_PER_CREDIT = 30_000` revenue proxy, `OP_MARGIN_FLOOR_BPS` ladder (chat_turn/generate 60%, summarize/rewrite/table/sign 65%, translate/ocr/compare/redact 70% from MARGIN_VERIFICATION.md §12.3 S1 worst-case column), pure math (`computeMarginBps(revenueMicros, costMicros)` returns MIN on zero revenue + clamps to ±10000, `revenueMicrosFromCredits`, `floorForOp`), UTC helpers (`utcDateString` zero-padded YYYY-MM-DD, `utcDayStart`), async surface (`runDailyRollup({ targetDate? })` grouped-by query using Drizzle `sql\`COUNT(*)\`` + `COALESCE(SUM(CASE WHEN success = 1 THEN ...))` + idempotent upsert via `onDuplicateKeyUpdate({ set: { ...col: sql\`VALUES(col)\` } })`; `computeGreenStreak({ throughDate?, maxDays? = 90 })` walks backward day-by-day with explicit absent-day=not-green semantics preventing silent streak extension through outage windows; `postMarginAlertToSlack(report)` non-throwing so broken webhook never cascades to 500; `listConfiguredModelsForDate`). `"server-only"` boundary. Types `SliceReport` + `DailyRollupReport`. (4) new `app/api/cron/ai-margin-rollup/route.ts` — mirrors reconcile-payments auth pattern: `x-cron-secret` header, 500 on missing CRON_SECRET env, 401 on mismatch, POST + GET both call `runCron(req)`, `?date=YYYY-MM-DD` backfill accepted, Slack gate formula `redCount > 0 || (allGreen && greenStreakDays >= 7)` (posts on breach OR on gate-close celebration), structured `[ai-margin-rollup] report` log line for durable ops trail, `dynamic = "force-dynamic"` + `runtime = "nodejs"` + `maxDuration = 300`, `margin_rollup_failed` 500 on exception. (5) new `scripts/test-ai-margin-rollup.mjs` (~600 lines / 96 assertions across 7 sections): A migration SQL columns + indexes + types + defaults, B Drizzle schema import/export/type alignment with migration, C library public surface (constants + all 8 functions + server-only + onDuplicateKeyUpdate + AI_SPEND_ALERT_SLACK_URL env read), D pure-math behavior (REFERENCE=30000, 10-op floor map, compute returns MIN on zero revenue, clamp range, utcDateString zero-pad, streak-walks-backward), E cron route (POST+GET, runtime/dynamic/maxDuration, auth pattern, 500-on-missing/401-on-mismatch, ?date= backfill, Slack gate formula, console.log, 500-on-throw), F aggregator wiring pins, G spec-docstring cross-refs (gate #7 + phase A4 + proxy rationale). Canonical `AI-margin-rollup tests: 96 passed, 0 failed` summary line. (6) `scripts/run-all-tests.mjs` SUITES array gains new entry between `health-ai` and `dev-hooks` with a 10-line rationale comment explaining placement (same ai_usage schema dependency as Phase A1 — column rename breaks both, this harness pins the aggregate-side consumer). (7) `docs/STATUS.md` — section header bumped to `Phase A1 + A2 + A4 — gates #3 / #5 / #6 / #7`; new Task #22 entry at top of AI observability section with deploy gotcha + ops follow-up + gate-close criteria. **Test verdict**: `npm test` now runs 9 suites / 725 assertions in ~1.2s, all green (pdf-tools 17 + geo-router 148 + geo-waitlist 248 + ai-usage 72 + chat-context-cap 33 + ai-router 76 + health-ai 27 + ai-margin-rollup 96 + dev-hooks 8). `npx tsc --noEmit` exit 0. **Deploy gotcha (mirrors Task #19 pattern):** `0006_ai_daily_margin.sql` is NOT auto-applied on deploy — must be piped to Hostinger MySQL manually BEFORE first cron invocation (same SSH + `grep -v '^--> statement-breakpoint' | mysql -h ...` flow as `0005_ai_usage.sql` on 2026-04-21 ~11:00 UTC), otherwise the rollup's INSERT-on-duplicate throws and the cron returns `margin_rollup_failed` 500. **Ops follow-up:** user adds `15 0 * * * curl -H "x-cron-secret: $CRON_SECRET" https://pdfcraftai.com/api/cron/ai-margin-rollup` to hPanel → Advanced → Cron Jobs (00:15 UTC = previous day + 15min tail-latency headroom) once the migration has landed. **Gate #7 close criteria:** Task #22 stays `in_progress` until (a) migration applied AND (b) first cron writes rows AND (c) 7 consecutive all-green days accumulate — the gate-close celebration Slack message is the canonical signal. Previous: `f3c79e0` (2026-04-21, Task #18 code-side — `/api/health` now surfaces `ai: { configured, providers, defaults }` metadata block. Three-file code bundle: `app/api/health/route.ts` gains four new imports (`listConfiguredProviderIds` from `@/lib/ai/registry`, `currentPolicySnapshot` + `AIOp` type from `@/lib/ai/router`, `AIProviderId` type from `@/lib/ai/types`), a new `probeAi()` helper wrapping both introspection calls in try/catch so a registry-layer throw degrades to `{ configured: false, providers: [], defaults: {} }` + a `console.error` rather than cascading to 503 (DB liveness stays the only signal that flips `ok` — AI state is deployment state, not health state), and a one-line `ai` field wired into the JSON response between `db` and `ts`. Docstring rewritten to pin the new shape and the "AI never flips `ok`" invariant. New test harness `scripts/test-health-ai.mjs` (260 lines / 27 assertions / 5 sections: A imports, B `probeAi()` shape + try/catch degrade, C GET body wiring + 200/503 posture preserved, D router/registry export surface intact, E sibling posture with `/api/payments/probe` — no SDK imports, no `listConfiguredProviders` heavy variant, no `route()`/`getProvider()` calls, no direct `process.env.*API_KEY` read in the health route). `scripts/run-all-tests.mjs` SUITES gains `health-ai` entry between `ai-router` and `dev-hooks` with a rationale comment explaining the consumer-side pinning of the Task #21 router surface. `npm test` now runs **8 suites / 629 assertions in ~1.4s**, all green (pdf-tools 17 + geo-router 148 + geo-waitlist 248 + ai-usage 72 + chat-context-cap 33 + ai-router 76 + health-ai 27 + dev-hooks 8). `npx tsc --noEmit` exit 0. **Deploy gotcha — none.** Pure code change, no migration, no new env var required to deploy. **Task #18 stays in_progress (not completed):** this closes the CODE half of the `/api/health ai.configured probe` clause; the ENV-VAR half (user sets `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in hPanel → App → Environment Variables, clicks Save & Redeploy) remains user-blocked — same pattern as Task #21's `GEMINI_API_KEY` deferred handoff. Once keys land, the probe flips `configured: false, providers: []` → `configured: true, providers: [<ids>]` **automatically** via the registry's env-driven rollout model — no code change, no redeploy beyond env. Gate #1 closes when a post-env-save `curl https://pdfcraftai.com/api/health | jq .ai` returns a non-empty `providers` array. Previous: `ed6e244` (2026-04-21, Phase A2 gate #6 — Gemini adapter + per-op routing ladder — Task #21. Three new files: `lib/ai/adapters/gemini.ts` (`GeminiProvider` class matching the `AIProvider` interface — gemini-2.5-flash default with `GEMINI_MODEL` override, PDF bytes as `inlineData` Part, usage from `usageMetadata`), `lib/ai/router.ts` (exports `AIOp`/`ROUTING_POLICY`/`OP_REQUIRED_CAPABILITY`/`OP_ENV_VAR`/`route()`/`NoRoutableProviderError` with caller-preferred > env-override > compiled-in precedence; ocr/translate → Gemini-primary, chat → OpenAI-primary, summarize/compare/generate/sign → Anthropic-primary with typed fallback chains), `scripts/test-router.mjs` (76 assertions / 6 sections). Seven refactored files: `lib/ai/types.ts`/`registry.ts`/`ocr.ts`/`translate.ts`/`summarize.ts`/`compare.ts`/`app/api/ai/chat/route.ts` — every `selectProvider()` → `route(op, { preferredId })` + typed `NoRoutableProviderError` catch mapped to each subsystem's existing error class. Chat route provider-swap preserved all Phase A1 `recordAiUsage`/`providerStartedAt` + Phase A2 `estimatePromptTokens`/20k-cap/413-refund logic byte-for-byte (verified green by re-running `test-ai-usage.mjs` + `test-chat-context-cap.mjs` post-refactor). `scripts/run-all-tests.mjs` SUITES gains `ai-router`; `npm test` now runs 7 suites / 602 assertions / ~1.1s, all green. `npx tsc --noEmit` exit 0. `@google/generative-ai ^0.24.1` added with clean +10-line lockfile delta. **No deploy gotcha** — pure code change, no migration, no env-var addition required to deploy (gate #6 runtime validation defers until `GEMINI_API_KEY` lands in Hostinger — same handoff shape as Task #18's `ANTHROPIC_API_KEY`). Until then `route("ocr", …)` falls through to the Anthropic fallback (if configured) or throws `NoRoutableProviderError` → 503 `no_ai_provider_configured` — the ladder degrades gracefully, doesn't silently misroute. Previous: `e882eed` (Phase A2 token-level input-context cap on `/api/ai/chat` — Task #20. Replaces old 16k-char byte-level `message_too_long` guard with a proper 20k-token ceiling per MASTER_PLAN §4 D4 + §7 gate #5. Three-file bundle: new `lib/ai/tokens.ts` (char-based heuristic, 3.5 chars/token Latin + 1:1 CJK + 4-token role-framing), restructured `app/api/ai/chat/route.ts` (cap check runs after PDF extract, before user-message INSERT; refund-before-413 on overflow), new `scripts/test-chat-context-cap.mjs` (33 assertions across 5 sections: static / behavioral / route-wiring / drift / spec-pin). Also wired ai-usage + chat-context-cap suites into the aggregator and fixed the Task #19 retrospective gap. `npm test` now runs 6 suites / 526 assertions / ~1.0s, all green. **No deploy gotcha this time** — pure code change, no migration. Previous: `037f6ea` Phase A1 `ai_usage` per-call audit table — Task #19. **Deploy gotcha for that one: `db/migrations/0005_ai_usage.sql` was applied manually to Hostinger MySQL 2026-04-21 ~11:00 UTC via SSH — verified via `SHOW CREATE TABLE ai_usage` showing all 15 columns + 5 indexes + FK to users.id ON DELETE CASCADE.** See STATUS.md § "AI observability (Phase A1/A2)". Before that: `5f70cd7` CF-IPCountry auto-preselect on `/launch-notify` Task #3 sub-item 4d; code shipped in `00615d2`.)

## Hostinger environment variables (production)

Set in hPanel → App → Environment Variables:

| Key | Value |
|---|---|
| `MYSQL_URL` | (pre-existing — MySQL connection string) |
| `NEXTAUTH_SECRET` | (pre-existing) |
| `NEXTAUTH_URL` | `https://pdfcraftai.com` |
| `NEXT_PUBLIC_SITE_URL` | `https://pdfcraftai.com` |
| `GOOGLE_CLIENT_ID` | `912612566698-n1857n8qa60n2sb55qag7sn2fi9bgias.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | (set; do not echo) |

After editing env vars, click **Save and redeploy**.

## Google OAuth

- **Google Cloud project:** `pdfcraftai`
- **Consent screen:** Published + Branding verified (2026-04-19)
- **OAuth client type:** Web application
- **Authorized JavaScript origins:**
  - `https://pdfcraftai.com`
  - `https://www.pdfcraftai.com`
- **Authorized redirect URIs:**
  - `https://pdfcraftai.com/api/auth/callback/google`
  - `https://www.pdfcraftai.com/api/auth/callback/google`
- **App logo uploaded:** `public/brand/pdfcraftai-mark-120.png` (120×120 chromatic monogram)
- **Branding URLs filled:** App home, Privacy, Terms — all pointing at `https://pdfcraftai.com/...`
- **Support email:** `rajasekarjavaee@gmail.com` (swap to `support@pdfcraftai.com` once that mailbox is confirmed deliverable)

## Known operational issue — 503 after deployment

**Symptom:** Occasionally after clicking *Save and redeploy* in Hostinger, the site returns HTTP 503.

**Fix:** In Hostinger hPanel:
1. Go to **Resource usage** (left nav / app dashboard)
2. Find the running Node process(es)
3. Click **Stop running process**
4. The app auto-restarts fresh and the 503 clears

## Integration status (verified 2026-04-20)

| Integration | Status | Evidence |
|---|---|---|
| Cloudflare proxy | OK | `cf-ray`, `server: cloudflare` on every response |
| `robots.txt` | OK | Advertises `Sitemap: https://pdfcraftai.com/sitemap.xml` |
| Sitemap (`/sitemap.xml`) | OK | 39 URLs, application/xml, resubmitted to GSC + Bing 2026-04-19 |
| Google OAuth (plumbing) | OK | `/api/auth/providers` shows Google wired to correct callback |
| Google OAuth (sign-in smoke test) | Pending | Needs human click at `/login` |
| Microsoft Clarity | OK (live) | Tag `wcsbv536zv` present in rendered HTML, commit `36034eb` |
| Google Analytics (GA4) | OK (live) | Tag `G-2Y8PS0S93F` present in rendered HTML, commit `36034eb` |

## `app/layout.tsx` current state

Contains:
1. Theme-flash-prevention inline script (pre-existing)
2. GA4 snippet via `next/script` (id `ga4-init`, `afterInteractive`)
3. Microsoft Clarity snippet via `next/script` (id `ms-clarity-init`, `afterInteractive`)

IDs are defined as constants at the top of the file: `GA_MEASUREMENT_ID`, `CLARITY_PROJECT_ID`.

## Useful commands

```bash
# Check live headers (from sandbox)
curl -sI https://pdfcraftai.com | head -20

# Verify Clarity + GA4 present in live HTML
curl -s https://pdfcraftai.com | grep -oE '(gtag/js\?id=G-[A-Z0-9]+|clarity\.ms|ga4-init|ms-clarity-init)' | sort -u

# Check sitemap URL count
curl -s https://pdfcraftai.com/sitemap.xml | grep -c '<loc>'

# Auth plumbing
curl -s https://pdfcraftai.com/api/auth/providers
```
