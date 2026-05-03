# Cron Jobs Registry

_Every endpoint that needs to be hit on a schedule, what it does, what breaks if it stops firing, and the canonical configuration._
_Source of truth: the route files at `app/api/cron/*/route.ts`. This doc is the operator-facing summary._

## Quick reference

| Endpoint | Schedule (UTC) | Auth | What breaks if missing |
|---|---|---|---|
| `/api/cron/expire-grants` | `0 3 * * *` (daily 03:00) | `CRON_SECRET` | Free credits sit on accounts past 7-day TTL; `Purchased credits never expire` becomes a lie. |
| `/api/cron/reconcile-payments` | `0 3 * * *` (daily 03:00) | `CRON_SECRET` | Provider/ledger drift accumulates silently; refund/chargeback events not reflected in our ledger. |
| `/api/cron/ai-margin-rollup` | `15 0 * * *` (daily 00:15) | `x-cron-secret` header | Admin `/admin/margin` page shows stale data; red-margin Slack alerts don't fire; green-streak counter freezes. |

All three crons share the same `CRON_SECRET`. Configure it ONCE in Hostinger panel.

## Setup

### Step 1 — Generate + install the shared secret

```bash
# Generate any 32+ char random string. macOS / Linux:
openssl rand -hex 32
```

Hostinger hPanel → Environment Variables → add:
- `CRON_SECRET=<the generated string>`

Save and redeploy. **NOTE:** the secret won't take effect on running cron jobs until the redeploy completes; existing cron schedules will start returning 401 mid-cycle if the secret rotates without coordinated redeploy.

### Step 2 — Configure cron-job.org (recommended)

cron-job.org is free, EU-hosted, has sub-minute reliability, and emails on failure. We use it instead of Hostinger's built-in cron because Hostinger's cron is per-user-shell and competes for the same thread budget that occasionally saturates during deploys.

For each entry in the **Quick reference** table:
1. cron-job.org → New cronjob.
2. URL: see "URL" rows in the per-cron sections below.
3. Schedule: see "Schedule (UTC)" column above. Use the cron-syntax field, NOT the dropdown — sub-minute scheduling matters for `ai-margin-rollup`.
4. HTTP Method: GET (all three accept GET; reconcile-payments + ai-margin-rollup also accept POST).
5. Save + enable.

### Step 3 — Verify (manually trigger each cron)

```bash
# Replace SECRET with your CRON_SECRET value.
curl -sS -H "x-cron-secret: SECRET" https://pdfcraftai.com/api/cron/expire-grants | jq
curl -sS -H "x-cron-secret: SECRET" https://pdfcraftai.com/api/cron/reconcile-payments | jq
curl -sS -H "x-cron-secret: SECRET" https://pdfcraftai.com/api/cron/ai-margin-rollup | jq
```

Expected: 200 with a small JSON body. 401 = secret wrong. 404 = endpoint missing (should never happen against a healthy deploy). 5xx = real failure — see per-cron troubleshooting below.

## Per-cron details

### `/api/cron/expire-grants`

**What:** scans `credit_ledger` for `signup_bonus` rows where `expires_at < NOW` AND the user still has positive balance. For each match, writes a debit row with `reason="signup_bonus_expired"` and idempotency key `signup_bonus_expired:${ledgerId}`. Net effect: clawback of unused free credits exactly 7 days after grant.

**URL:**
- `https://pdfcraftai.com/api/cron/expire-grants?secret=<CRON_SECRET>` (query string)
- OR `https://pdfcraftai.com/api/cron/expire-grants` with header `x-cron-secret: <CRON_SECRET>`

**Schedule:** `0 3 * * *` (daily at 03:00 UTC = 08:30 IST). Low-traffic window.

**Idempotency:** safe to re-run. Per-ledger-row idempotency key means each row is debited at most once across all cron invocations.

**Response shape:** `{ "expired": <count>, "debitedCredits": <total>, "skipped": <count>, "errors": <count> }`

**What breaks if missing:** the "free credits valid 7 days" promise on the registration page becomes a lie. Bot accounts that signed up but never converted hold free credits indefinitely. Marketing copy at `/pricing` claims expiry but ledger doesn't enforce it.

**Plan ref:** `docs/PRICING_AND_TELEMETRY_PLAN.md` §8 layer 6.

### `/api/cron/reconcile-payments`

**What:** cursor-paginated scan of payment provider `/transactions` API across a 30-day window. Compares provider state to local `payments` + `credit_ledger` state. Logs drift events; auto-corrects when safe.

**URL:** `https://pdfcraftai.com/api/cron/reconcile-payments` with header `x-cron-secret: <CRON_SECRET>`

**Schedule:** `0 3 * * *` (daily at 03:00 UTC). Same window as expire-grants — back-to-back is fine, both are read-mostly.

**Response timeout:** can take 60–120s at moderate volume. `maxDuration: 300` is set on the route. Hostinger Node hosting caps at 300s.

**What breaks if missing:** payment-provider events that don't fire webhook (e.g. webhook deliveries failed and exhausted retries) accumulate as silent drift. Manual refunds initiated in the provider dashboard don't reflect in user balances. Period of drift bounded by the next manual run.

### `/api/cron/ai-margin-rollup`

**What:** writes one row per `(date, provider_id, model, operation)` slice into `ai_daily_margin`. Computes margin %, fires red-margin Slack alerts, runs three drift detectors (margin drift, primary-share drop, dark routing), updates the green-streak counter.

**URL:** `https://pdfcraftai.com/api/cron/ai-margin-rollup` with header `x-cron-secret: <CRON_SECRET>`

**Schedule:** `15 0 * * *` (daily at 00:15 UTC). The 15-minute offset gives the previous-UTC-day 15 minutes of tail-latency headroom before we close the window.

**Idempotency:** UPSERT-on-(date, provider_id, model, operation). Re-running overwrites instead of duplicating.

**Slack integration:** if `AI_SPEND_ALERT_SLACK_URL` env var is configured, posts alerts on red slices and detected drift events. Without the env var, alerts log to stdout only. Setting Slack alerts up is recommended ahead of activating the per-op bonus cap (Gap #2) so unusual cap-hit clusters surface immediately.

**What breaks if missing:** `/admin/margin` shows a stale view (stops at the last successful run). Red-slice alerts don't fire. Green-streak counter freezes at the last day's value. Drift detectors silent — early warnings of margin regressions are missed.

## Future cron jobs (not yet shipped)

These are proposed but not in the codebase as of `4f3a4c7`. Add this section as they ship.

- **`/api/cron/abuse-signal-summary`** — daily digest of `/admin/abuse-signals` cluster sizes, posted to admin Slack. Useful when daily signups grow past ~50/day and manual review of every flagged account isn't feasible.
- **`/api/cron/per-op-cap-blocked-summary`** — once Gap #2 is activated (`BONUS_PER_OP_CAP_ENABLED=true`), a daily summary of cap-hit events per op + per user. Helps tune the cap value if observed friction is too high.

## Critical operational notes

- **All three crons require `CRON_SECRET`.** No graceful degradation if the secret is missing — they 401 every request. The fail-closed design is intentional (these endpoints write to ledger / payments tables; an unauthenticated trigger could be weaponized).
- **Don't rotate `CRON_SECRET` without coordinating the redeploy.** Existing cron schedules will start failing the moment the env-var change goes live, and won't recover until the cron-job.org config is updated to match. Set + verify in a maintenance window.
- **Each cron is independently idempotent.** Running them by hand for diagnostic purposes is safe. Running them more frequently than the canonical schedule is also safe (just wastes a few hundred ms of DB time per extra run).
- **The CLAUDE.md §3 secrets table** has the canonical list of integration IDs — match against this doc when investigating any "is this cron actually live?" question.

## Verifying a cron has fired recently

```bash
# expire-grants — count yesterday's expiry debits
ssh ... 'mysql --defaults-file=~/.mysql/.my.cnf <<< \
  "SELECT COUNT(*) FROM credit_ledger WHERE reason=\"signup_bonus_expired\" \
   AND DATE(created_at) = CURDATE() - INTERVAL 1 DAY;"'

# reconcile-payments — last reconciliation report row
ssh ... 'mysql ... <<< "SELECT MAX(created_at) FROM reconciliation_runs;"'

# ai-margin-rollup — most recent rollup date
ssh ... 'mysql ... <<< "SELECT MAX(date) FROM ai_daily_margin;"'
```

If any of these returns no rows OR a `MAX(date) / MAX(created_at)` more than 36 hours ago: the cron is broken. Trace via the verification curl in the Setup section — 200 vs 401 vs timeout tells you whether the issue is auth, scheduling, or runtime.
