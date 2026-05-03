# Next session — pick up here

**Updated 2026-05-03 evening (latest live commit `4f3a4c7`).** The Pricing/Telemetry plan auto-mode arc is complete + all 5 post-plan code gaps are closed. Code-side punch list is empty. Only user-action items remain.

**Status snapshot:**
- Latest live commit: `4f3a4c7` (Gap #2 Option A — per-op signup-bonus cap, feature-flagged default OFF)
- All 13 plan days shipped at gross level; all 5 post-plan code gaps closed (#1, #3, #4, #5, #2 all live)
- Aggregator: **4462/4462 tests passing across 77 suites** (`tsc --noEmit` exit 0)
- Resilience: 8 zombie-next-server cascades + 3 auto-pull jams survived this arc; documented playbook is reliable

**Three classes of remaining work:**

## 1. User-action items (founder must do, no Claude work needed)

These are the only blockers between "everything is wired" and "everything is live + active in prod."

### 1a. Hostinger panel env vars (REQUIRED)
Add the following in hPanel → Environment Variables → Save and redeploy:
- `CRON_SECRET=<generate any 32+ char random string>` — gates `/api/cron/expire-grants` (the daily sweep that debits expired signup_bonus credits past the 7-day TTL).
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAADH0w8NFtw_mwWPx` — public site key (already in `.claude/secrets.env`, just needs to be on the live env). Required for the registration form's captcha widget to render.
- `TURNSTILE_SECRET_KEY=0x4AAAAAADH0wxWtlmi0hAi8-8HB-zOCYK8` — server-side secret. Required for `verifyTurnstileToken` to hit Cloudflare's siteverify endpoint. Without this, the captcha layer fails open.

### 1b. cron-job.org schedule (REQUIRED for credit expiry to actually fire)
1. Sign in to cron-job.org → New cronjob.
2. URL: `https://pdfcraftai.com/api/cron/expire-grants?secret=<the CRON_SECRET you set above>`
3. Schedule: daily at 03:00 UTC (low-traffic window for the production DB).
4. HTTP Method: GET.
5. Save + enable.

Without this, the "free credits valid 7 days" promise isn't enforced — credits silently sit on user accounts past expiry. The expire-grants endpoint is idempotent (each row gets debited at most once) so manual re-runs are safe.

### 1c. Optional: activate Gap #2 per-op cap
The cap is wired but disabled by default. To activate:
- Add `BONUS_PER_OP_CAP_ENABLED=true` in hPanel.
- (Optional) `BONUS_PER_OP_CAP=2` to override the default cap value.
- Save + redeploy.

When activated, free-trial users (no purchases yet) can spend at most 2 of their 5 credits on any single AI op. After hitting the cap on a given op, they see "Top up to keep using it" — same UX as running out of pool credits, just earlier per-op. Topping up bypasses the cap entirely.

### 1d. Search Console / Bing Webmaster
Sitemap was last submitted to GSC + Bing on 2026-04-20 / 2026-04-21. The plan arc shipped 13 SEO landings + several redirect changes; the sitemap reflects them. Re-submit if you want fresh crawls — `https://pdfcraftai.com/sitemap.xml`.

## 2. Open investigation threads (worth a future session)

### Cascade-pattern investigation
**Hypothesis:** zombie-next-server cascades correlate with **rapid code-bearing deploys**, not with deploy frequency alone. Doc-only and test-only commits deploy clean (commits `78240d4`, `ff54a98`, `d75f726`, `fef1304`); code-bearing commits repeatedly trigger cascades (`8afefa5` → #7, `acb7695` → #8). Counter-data: `4f3a4c7` was code-bearing but deployed clean — though only after an empty-commit nudge resolved auto-pull jam #3, suggesting the nudge sidestepped some queue-overlap state.

**Suggested experiment** (~30 min):
1. Push a small code-bearing commit at low-traffic time. Watch `/api/health` `uptimeSec` and `ps -fu u692382124 | grep -c next-server` via SSH.
2. Wait 10 min. Push another code-bearing commit. Observe whether the second deploy cascades (overlap with first deploy's cleanup).
3. Try the same with two doc-only commits 10 min apart. Compare cascade rate.

**Working theory:** Hostinger's Passenger HelperAgent has a thread budget; rapid LSAPI socket re-binds during code-bearing rebuilds saturate it. Doc-only commits skip the rebuild entirely so don't compete for thread slots.

**Mitigation if confirmed:** batch code commits with 5+ min spacing, OR ask Hostinger Support to bump the per-user thread cap (currently shared at the cgroup level — `ulimit -u` in user shell is misleadingly high).

### `capExceeded` flag → friendlier copy (deferred)
Gap #2 Option A wires the cap and returns `{reason:"insufficient", capExceeded:true}` when fired. Route handlers and tool components currently ignore the flag — users see the standard "Not enough credits" copy. Once the cap is activated and we observe friction, the friendlier "Free trial cap reached on this tool — top up" copy is a 30-min batch:
- 9-10 AI route handlers: pass `capExceeded` through to the 402 response body.
- 9-10 client tool components: detect the new field, switch the formatted error string.
- Probably best wrapped as a single `lib/ai/error-mapping.ts` helper that all components import, to avoid duplicating the conditional logic.

### Per-op cap admin observability
Right now we have no admin signal that "user X hit the cap on op Y." Worth a small dashboard or log line: when `checkPerOpBonusCap` returns capped:true with remaining < cost, emit a structured stdout log (`event: "per_op_cap_blocked"`) so admin can grep for cap-hit clusters. Especially useful in the first 2 weeks after activation to see if the cap is firing on legit users.

## 3. Documentation that should exist (low-priority polish)

### Operations runbook
We have lots of cascade history in STATUS.md but no single "what to do when X breaks" doc. A short `docs/OPS_RUNBOOK.md` covering:
- Cascade recovery: SSH mass-kill or wait 5–10 min (with the fork-retry decision tree)
- Auto-pull jam: empty-commit nudge
- 503 vs 200 vs HTML-default-error decision flow
- "How to find the latest live commit": `curl /api/health | jq .commit`
- "How to roll back": `git revert HEAD && push` (followed by another empty-commit nudge if needed)

This could be 1 page of dense bullets and would save ~10 min in any future incident.

### Cron-jobs index
Currently we have one cron (expire-grants) and the design doc trail mentions future ones (margin rollup, anomaly detection, etc.). Worth a `docs/CRON_JOBS.md` listing every endpoint that should be hit on a schedule, the schedule, and the canonical cron-job.org configuration. Easy to forget to set up new crons during onboarding to a new hosting platform.

---

## What this session shipped (handoff snapshot)

**Plan arc** (Pricing/Telemetry — multiple sub-sessions, ~50 commits total):
- Day 1 supply-chain scrub + credit-badge removal + marketing copy
- Day 1.5a/b email verification + password reset SMTP + login rate limit + bcrypt 12 + password strength + no-enumeration
- Day 1.6 DPDP compliance (data export, account delete, breach runbook)
- Day 1.7 multiplier-aware spend for translate/redact/sign
- Day 2 + 2.5 pre-flight credit estimator + 9/9 AI tools wired
- Day 3 user `/app/usage` page (credits-only)
- Day 5 + 5.5 abuse stack layers 1-7 (disposable blocklist, Gmail-alias normalize, IP /24 throttle, device fingerprint, Cloudflare Turnstile)
- Day 6 atomic 25→5 credit grant flip + grantSignupBonus

**Post-plan gap closure** (this session, 9 commits):
- Gap #1 — defer signup bonus to /verify-email after email-ownership proof
- Gap #3 — estimator badge wired into 6 remaining AI tools (9/9 coverage now)
- Gap #4 — personalized "last 7 days" recap on OutOfCreditsAlert (+ rate-limit on /api/account/recent-usage)
- Gap #5 — admin grant/debit credit actions on /admin/users/[id]
- Gap #2 Option A — per-op signup-bonus cap (feature-flagged default OFF, decision-doc trail in `docs/GAP2_DESIGN_OPTIONS.md`)

**Test surface:** 4462/4462 across 77 suites; 2 new CI guards added (`gap4-gap5` 58 assertions, `per-op-bonus-cap` 26 assertions), plus extensions to `abuse-prevention`.

**Files most likely to be relevant in the next session:**
- `lib/payments/per-op-bonus-cap.ts` — Gap #2 helper (pure)
- `lib/ai/credits.ts` — spendCredits wire-in
- `app/verify-email/page.tsx` — grant-on-verify hook
- `lib/admin/user-actions.ts` — admin grant/debit
- `components/admin/AdminUserActions.tsx` — admin form UI
- `app/api/account/recent-usage/route.ts` — recent-usage endpoint with rate limit
- `components/upsell/OutOfCreditsAlert.tsx` — alert with personalized recap
- `docs/GAP2_DESIGN_OPTIONS.md` — Option A activation instructions
- `docs/STATUS.md` — full timeline of the arc (cascade history, decision rationale)
- `CLAUDE.md` — bootstrap doc (deployment playbook, cascade recovery, env vars)
