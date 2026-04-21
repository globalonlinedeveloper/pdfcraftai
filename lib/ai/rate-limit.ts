// Task #12 — per-user daily cost ceiling.
//
// Second half of the Phase A circuit-breaker set (the first half is
// env-flipped kill switches in `./kill-switches.ts`). Enforces a hard
// dollar cap on how much a single user can cost us per UTC day across
// every op. If they exceed the cap, the next request returns 429 with
// `Retry-After: <seconds until 00:00 UTC>`; the app won't call a
// provider, won't spend credits, and won't write an `ai_usage` row for
// the refused call.
//
// Why a cap at all
// ----------------
// Net margin = revenue - provider cost. A single user stuck in a bad
// client loop (or a credential leak, or a credit-card-fraud-driven
// abuse pattern) can burn through three-digit USD in AI provider spend
// in a few minutes. Credits handle the "user ran out of prepaid budget"
// case, but a malicious or broken client with fresh credits can still
// dump thousands of calls before the next credit top-up fails. The
// daily cost ceiling is the second layer — even WITH credits, a single
// user can't cost us more than N microdollars per UTC day.
//
// Why UTC day and not rolling 24h
// -------------------------------
// Two reasons:
//   1. Every margin rollup in this repo is bucketed by UTC day
//      (`ai_daily_margin`, admin dashboards, daily digest emails).
//      Keeping the cap on the same boundary means "user X hit cap on
//      2026-04-22" is directly comparable to "ai_daily_margin row for
//      provider Y on 2026-04-22" — no off-by-one pain during incident
//      post-mortems.
//   2. Rolling-window caps require an index on a non-constant window
//      (`created_at >= NOW() - INTERVAL 24 HOUR`), which can't use a
//      composite (user_id, created_at) index efficiently. A fixed UTC
//      day lets MySQL bound both sides of the range at query time and
//      do a bounded range scan on the existing index.
//
// Cost computation
// ----------------
// `ai_usage.cost_micros` (set by the router/op layer after a successful
// provider call) is the source of truth for "what did this call cost
// us". We SUM it for today's rows for this user:
//
//     SELECT COALESCE(SUM(cost_micros), 0)
//     FROM ai_usage
//     WHERE user_id = ?
//       AND created_at >= '2026-04-22 00:00:00.000'
//       AND created_at <  '2026-04-23 00:00:00.000'
//
// Covered by the existing `ai_usage_user_created_idx` (user_id,
// created_at) index — one bounded range scan per request.
//
// Cap resolution order
// --------------------
// 1. Row in `user_rate_limits` for this userId → use its
//    `daily_cost_cap_micros` (can be 0 for hard-block during fraud review,
//    can be higher than env default for enterprise pilots).
// 2. Otherwise → `process.env.USER_DAILY_COST_MICROS_CAP`, parsed as a
//    positive integer.
// 3. Otherwise → `DEFAULT_DAILY_COST_CAP_MICROS` (500000 = $0.50/user/day).
//    This is deliberately conservative for initial rollout; we can raise
//    it once we have a few days of data on normal-user spend distribution.
//
// A cap of exactly 0 is a HARD BLOCK — any usage (even 0-cost retries)
// trips the ceiling. Used by operators who want to disable a user
// without deleting the account.
//
// Where this is called
// --------------------
// API route handlers (`app/api/ai/*/route.ts`), right after `auth()`
// succeeds and BEFORE `spendCredits`. Flow:
//
//     const session = await auth();
//     assertOpNotKilled("summarize");         // ← kill switches
//     await assertWithinDailyCap(userId);     // ← this module
//     await spendCredits(...);                // ← existing credits
//     // ... provider call, persist ai_usage, etc.
//
// This ordering matters: a capped user must NOT have credits deducted
// for the rejected call. If we deducted first, we'd have to refund on
// every 429 — extra DB writes + reconciliation surface area. Checking
// cap before credits is cheaper and simpler.
//
// Test story
// ----------
// `scripts/test-router.mjs` SECTION H pins:
//   - Exports exist: DailyCostCeilingExceededError, checkUserDailyCost,
//     assertWithinDailyCap, DEFAULT_DAILY_COST_CAP_MICROS,
//     resolveDailyCapMicros.
//   - `DEFAULT_DAILY_COST_CAP_MICROS === 500000` (=$0.50).
//   - Route handlers import and call `assertWithinDailyCap` after
//     `assertOpNotKilled` and before `spendCredits`.
//   - 429 branch in each route handler maps `DailyCostCeilingExceededError`
//     to HTTP 429 with a `Retry-After` header.

import "server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

/**
 * Default per-user daily cost ceiling when neither a `user_rate_limits`
 * override row nor the `USER_DAILY_COST_MICROS_CAP` env var is set.
 *
 * 500000 µUSD = $0.50/user/day. Deliberately tight during initial
 * rollout — a normal user doing a handful of OCR + summarize ops in a
 * day lands well under $0.10, so $0.50 catches runaway loops while
 * leaving multi-x headroom for legitimate power usage. Raise via env
 * (not by code change) once we have distribution data.
 */
export const DEFAULT_DAILY_COST_CAP_MICROS = 500_000;

/**
 * Env-var name — single source of truth for operators. Flipping this
 * value on Hostinger and redeploying changes the default cap for every
 * user without an override row.
 */
export const DAILY_COST_CAP_ENV_VAR = "USER_DAILY_COST_MICROS_CAP";

// -------------------------------------------------------------------
// Error class
// -------------------------------------------------------------------

/**
 * Thrown by `assertWithinDailyCap` (and surfaced via `checkUserDailyCost`
 * when `allowed=false`) when a user's summed cost_micros for the UTC
 * day meets or exceeds their cap.
 *
 * Carries the used/cap pair and the precomputed retry-after seconds so
 * the route handler can set an accurate `Retry-After` header without
 * recomputing the UTC-day math.
 *
 * Separate class from `OpKilledError` / `NoRoutableProviderError` so
 * callers that want different audit posture ("user tripped their own
 * cap" vs. "operator killed the op" vs. "no provider configured") can
 * distinguish with `instanceof`.
 */
export class DailyCostCeilingExceededError extends Error {
  constructor(
    public readonly userId: string,
    public readonly usedMicros: number,
    public readonly capMicros: number,
    public readonly retryAfterSeconds: number,
  ) {
    super(
      `User ${userId} exceeded daily cost ceiling: ` +
        `used=${usedMicros}µUSD, cap=${capMicros}µUSD, ` +
        `retryAfter=${retryAfterSeconds}s`,
    );
    this.name = "DailyCostCeilingExceededError";
  }
}

// -------------------------------------------------------------------
// Cap resolution
// -------------------------------------------------------------------

/**
 * Parse `USER_DAILY_COST_MICROS_CAP` from env. Returns null if unset,
 * empty, or unparseable (so callers can fall through to the default).
 * Negative values are treated as unset (negative cap has no semantics;
 * operators who want "no cap" should delete the env var, and operators
 * who want "hard block" should set 0).
 */
function parseEnvCap(): number | null {
  const raw = process.env[DAILY_COST_CAP_ENV_VAR];
  if (!raw) return null;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * Resolve the effective cap for a user given their override (or null
 * for no override). Exported so the admin page can render the exact
 * numbers shown to operators.
 *
 *   override !== null → use override (even 0 — that's a valid hard block)
 *   override === null → env cap → DEFAULT_DAILY_COST_CAP_MICROS
 */
export function resolveDailyCapMicros(override: number | null): number {
  if (override !== null) return override;
  const fromEnv = parseEnvCap();
  if (fromEnv !== null) return fromEnv;
  return DEFAULT_DAILY_COST_CAP_MICROS;
}

// -------------------------------------------------------------------
// UTC-day window + retry-after math
// -------------------------------------------------------------------

/**
 * UTC-day [start, endExclusive) bounds for `now`. End is 00:00:00.000
 * of the NEXT UTC day, exclusive — matches the standard half-open
 * interval used everywhere else in the app's daily rollups.
 *
 * Exported for the test harness to pin the boundary math.
 */
export function utcDayBounds(now: Date = new Date()): {
  start: Date;
  endExclusive: Date;
} {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, endExclusive };
}

/**
 * Seconds from `now` until the next UTC midnight. Used to populate the
 * `Retry-After` header on 429 responses — tells the client exactly how
 * long until the cap resets.
 *
 * Always >= 1 so the client never sees `Retry-After: 0` (which some
 * clients interpret as "retry immediately", defeating the purpose).
 */
export function secondsUntilNextUtcMidnight(now: Date = new Date()): number {
  const { endExclusive } = utcDayBounds(now);
  const deltaMs = endExclusive.getTime() - now.getTime();
  const deltaSec = Math.ceil(deltaMs / 1000);
  return Math.max(1, deltaSec);
}

// -------------------------------------------------------------------
// Usage aggregate + check
// -------------------------------------------------------------------

/**
 * Sum `ai_usage.cost_micros` for this user in today's UTC window. NULL
 * costs (rows where the provider didn't return a cost — rare, usually
 * an error mid-call) count as 0 via COALESCE.
 *
 * Uses the existing `ai_usage_user_created_idx` (user_id, created_at)
 * composite — the WHERE clause is a prefix match on user_id plus a
 * bounded range on created_at, so MySQL does one indexed range scan.
 */
async function sumUserCostMicrosForToday(
  userId: string,
  start: Date,
  endExclusive: Date,
): Promise<number> {
  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(${schema.aiUsage.costMicros}), 0)`,
    })
    .from(schema.aiUsage)
    .where(
      and(
        eq(schema.aiUsage.userId, userId),
        gte(schema.aiUsage.createdAt, start),
        lt(schema.aiUsage.createdAt, endExclusive),
      ),
    );
  // drizzle can return the aggregate as a JS number, a bigint, or a
  // numeric string depending on the driver version. Coerce defensively.
  const raw = result[0]?.total ?? 0;
  if (typeof raw === "number") return raw;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coerced = Number((raw as any)?.toString?.() ?? raw);
  return Number.isFinite(coerced) ? coerced : 0;
}

/**
 * Look up a user's override cap from `user_rate_limits`, or null if no
 * row exists. `cap=0` rows ARE returned (0 is a valid hard-block value);
 * null is reserved for "no row at all, fall through to env default".
 */
async function readUserCapOverrideMicros(
  userId: string,
): Promise<number | null> {
  const rows = await db
    .select({ cap: schema.userRateLimits.dailyCostCapMicros })
    .from(schema.userRateLimits)
    .where(eq(schema.userRateLimits.userId, userId))
    .limit(1);
  if (rows.length === 0) return null;
  const cap = rows[0].cap;
  return typeof cap === "number" ? cap : Number(cap) || 0;
}

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------

/**
 * Non-throwing check — returns a structured verdict. Used by the admin
 * page to display a user's current state ("You've used $0.23 of your
 * $0.50 daily budget"), and by the route handlers indirectly through
 * `assertWithinDailyCap`.
 *
 * Atomicity note: we run two sequential queries (override lookup, then
 * usage SUM). A user whose override row is inserted between the two
 * queries could briefly see stale behaviour — but since overrides are
 * operator-managed (low frequency, seconds-to-minutes between flips and
 * a user's next request), the race is inconsequential. The next
 * request picks up the new cap.
 */
export async function checkUserDailyCost(userId: string): Promise<{
  allowed: boolean;
  usedMicros: number;
  capMicros: number;
  retryAfterSeconds: number;
}> {
  const now = new Date();
  const { start, endExclusive } = utcDayBounds(now);

  const [override, used] = await Promise.all([
    readUserCapOverrideMicros(userId),
    sumUserCostMicrosForToday(userId, start, endExclusive),
  ]);

  const capMicros = resolveDailyCapMicros(override);
  const allowed = used < capMicros;
  const retryAfterSeconds = allowed ? 0 : secondsUntilNextUtcMidnight(now);

  return { allowed, usedMicros: used, capMicros, retryAfterSeconds };
}

/**
 * Throwing variant — the canonical entry point for route handlers.
 * Throws `DailyCostCeilingExceededError` (which the handler catches and
 * maps to HTTP 429) when the cap is met or exceeded.
 *
 * Semantics: the comparison is STRICT `used >= cap` — the moment a
 * user's summed cost ties the cap, the NEXT call is refused. This is
 * safer than `used > cap` (which would let one over-cap call through
 * if timing lines up) and matches operator intuition: "cap = 500000
 * means the most this user can spend today is 500000".
 */
export async function assertWithinDailyCap(userId: string): Promise<void> {
  const { allowed, usedMicros, capMicros, retryAfterSeconds } =
    await checkUserDailyCost(userId);
  if (!allowed) {
    throw new DailyCostCeilingExceededError(
      userId,
      usedMicros,
      capMicros,
      retryAfterSeconds,
    );
  }
}
