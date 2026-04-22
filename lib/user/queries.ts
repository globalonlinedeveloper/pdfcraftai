// lib/user/queries.ts — Server-only user-scoped query helpers.
//
// INVARIANTS (verified by scripts/test-user-dashboard-v2.mjs):
//   1. Every exported function takes `userId: string` as its FIRST POSITIONAL
//      ARGUMENT. That userId MUST come from `auth()` on the caller side —
//      never from a URL param, search param, or request body. The test
//      harness greps each caller page to confirm the only source is auth().
//
//   2. Every SELECT has a `WHERE user_id = ?` clause bound to the passed
//      userId. No function fans out across users. No function accepts
//      "all users" or "*" as a sentinel.
//
//   3. NO forbidden column is ever SELECTed:
//        cost_micros, net_revenue_micros, processor_fee_micros,
//        tax_collected_micros, tax_remittable_micros, fx_rate_used,
//        fx_slippage_micros, infra_amortized_micros, gross_charge_micros,
//        infra_amortized_credits, refund_reserve_credits.
//      These are margin/cost/MoR-split fields — admin-only by policy.
//
//   4. Every return path is wrapped in `UserQueryResult<T> = {data, error}`
//      so page components branch on `.error` instead of throwing. A failed
//      query renders an ErrorBanner; it never takes the whole dashboard down.
//
// Phase B/5 — Task #19.

import "server-only";

import { db, schema } from "@/db/client";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  sql,
  sum as drizzleSum,
  count as drizzleCount,
} from "drizzle-orm";

export type UserQueryResult<T> = { data: T; error: string | null };

function ok<T>(data: T): UserQueryResult<T> {
  return { data, error: null };
}

function fail<T>(fallback: T, e: unknown): UserQueryResult<T> {
  const msg = e instanceof Error ? e.message : String(e);
  return { data: fallback, error: msg };
}

// -----------------------------------------------------------------------
// 1. Current credit balance.
// -----------------------------------------------------------------------

export async function getUserBalance(
  userId: string
): Promise<UserQueryResult<{ balance: number }>> {
  try {
    const [row] = await db
      .select({ balance: schema.credits.balance })
      .from(schema.credits)
      .where(eq(schema.credits.userId, userId))
      .limit(1);
    return ok({ balance: row?.balance ?? 0 });
  } catch (e) {
    return fail({ balance: 0 }, e);
  }
}

// -----------------------------------------------------------------------
// 2. Per-operation usage rollup over the last N days.
//
// Returns credits spent, call count, success rate, and truncation rate per
// operation. Explicitly does NOT return cost_micros — users see what they
// spent in credits, not what we spent in USD.
//
// Success rate excludes rows with NULL `success` (shouldn't happen, but
// defensive). Truncation rate excludes rows with NULL `response_truncated`
// (historical + errored rows — matches the indexed admin rollup pattern).
// -----------------------------------------------------------------------

export type UsageRollupRow = {
  operation: string;
  calls: number;
  creditsSpent: number;
  successRate: number | null; // 0..1, null if calls === 0
  truncationRate: number | null; // 0..1, null if no instrumented rows
};

export async function getUsageRollup(
  userId: string,
  days: number
): Promise<UserQueryResult<UsageRollupRow[]>> {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        operation: schema.aiUsage.operation,
        calls: drizzleCount(schema.aiUsage.id),
        creditsSpent: sql<number>`COALESCE(SUM(${schema.aiUsage.creditsSpent}), 0)`,
        successes: sql<number>`COALESCE(SUM(${schema.aiUsage.success}), 0)`,
        truncatedDenom: sql<number>`COALESCE(SUM(CASE WHEN ${schema.aiUsage.responseTruncated} IS NOT NULL THEN 1 ELSE 0 END), 0)`,
        truncatedNumer: sql<number>`COALESCE(SUM(CASE WHEN ${schema.aiUsage.responseTruncated} = 1 THEN 1 ELSE 0 END), 0)`,
      })
      .from(schema.aiUsage)
      .where(
        and(
          eq(schema.aiUsage.userId, userId),
          gte(schema.aiUsage.createdAt, since)
        )
      )
      .groupBy(schema.aiUsage.operation)
      .orderBy(desc(sql<number>`COALESCE(SUM(${schema.aiUsage.creditsSpent}), 0)`));

    return ok(
      rows.map((r) => ({
        operation: r.operation,
        calls: Number(r.calls) || 0,
        creditsSpent: Number(r.creditsSpent) || 0,
        successRate:
          r.calls > 0 ? Number(r.successes) / Number(r.calls) : null,
        truncationRate:
          Number(r.truncatedDenom) > 0
            ? Number(r.truncatedNumer) / Number(r.truncatedDenom)
            : null,
      }))
    );
  } catch (e) {
    return fail([] as UsageRollupRow[], e);
  }
}

// -----------------------------------------------------------------------
// 3. Daily credit-spend timeline for the last N days.
//
// Bucket by DATE(created_at) in UTC. Rows with zero spend are omitted —
// the page fills in gap days as "0" on the client side to keep the SQL
// simple (no calendar-table join).
// -----------------------------------------------------------------------

export type DailySpendRow = { day: string; creditsSpent: number; calls: number };

export async function getDailySpend(
  userId: string,
  days: number
): Promise<UserQueryResult<DailySpendRow[]>> {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        day: sql<string>`DATE(${schema.aiUsage.createdAt})`,
        creditsSpent: sql<number>`COALESCE(SUM(${schema.aiUsage.creditsSpent}), 0)`,
        calls: drizzleCount(schema.aiUsage.id),
      })
      .from(schema.aiUsage)
      .where(
        and(
          eq(schema.aiUsage.userId, userId),
          gte(schema.aiUsage.createdAt, since)
        )
      )
      .groupBy(sql`DATE(${schema.aiUsage.createdAt})`)
      .orderBy(desc(sql`DATE(${schema.aiUsage.createdAt})`));

    return ok(
      rows.map((r) => ({
        day: String(r.day),
        creditsSpent: Number(r.creditsSpent) || 0,
        calls: Number(r.calls) || 0,
      }))
    );
  } catch (e) {
    return fail([] as DailySpendRow[], e);
  }
}

// -----------------------------------------------------------------------
// 4. Recent credit-ledger entries (user-safe projection).
//
// Selects ONLY: id, delta, reason, note, paymentId, createdAt.
// Does NOT select: gross_charge_micros, processor_fee_micros,
//   tax_*_micros, fx_*, net_revenue_micros, infra_amortized_credits,
//   card_fingerprint, data_source. Those are MoR/admin-only.
// -----------------------------------------------------------------------

export type LedgerRow = {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  paymentId: string | null;
  createdAt: Date;
};

export async function getRecentCreditLedger(
  userId: string,
  limit: number
): Promise<UserQueryResult<LedgerRow[]>> {
  try {
    const rows = await db
      .select({
        id: schema.creditLedger.id,
        delta: schema.creditLedger.delta,
        reason: schema.creditLedger.reason,
        note: schema.creditLedger.note,
        paymentId: schema.creditLedger.paymentId,
        createdAt: schema.creditLedger.createdAt,
      })
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, userId))
      .orderBy(desc(schema.creditLedger.createdAt))
      .limit(limit);
    return ok(rows);
  } catch (e) {
    return fail([] as LedgerRow[], e);
  }
}

// -----------------------------------------------------------------------
// 5. Active subscription (if any).
//
// Returns the single row matching status IN ('active', 'paused', 'pending')
// — there should be at most one per user by DB invariant. "Cancelled" and
// "failed" subscriptions are intentionally excluded: the plan page shows
// a "no active plan" CTA instead.
// -----------------------------------------------------------------------

export type ActiveSubscription = {
  id: string;
  providerId: string;
  planCode: string;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
};

export async function getActiveSubscription(
  userId: string
): Promise<UserQueryResult<ActiveSubscription | null>> {
  try {
    const [row] = await db
      .select({
        id: schema.subscriptions.id,
        providerId: schema.subscriptions.providerId,
        planCode: schema.subscriptions.planCode,
        status: schema.subscriptions.status,
        currentPeriodStart: schema.subscriptions.currentPeriodStart,
        currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
        cancelledAt: schema.subscriptions.cancelledAt,
        createdAt: schema.subscriptions.createdAt,
      })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.userId, userId),
          inArray(schema.subscriptions.status, ["active", "paused", "pending"])
        )
      )
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(1);
    return ok(row ?? null);
  } catch (e) {
    return fail(null as ActiveSubscription | null, e);
  }
}

// -----------------------------------------------------------------------
// 6. Captured receipts (for the receipts page).
//
// Projection: id, providerId, status, amountMinor, currency, packId,
// planCode, createdAt. Does NOT project processor_fee_micros,
// tax_remittable_micros, fx_rate_used — those live on credit_ledger
// and are admin-only.
// -----------------------------------------------------------------------

export type ReceiptRow = {
  id: string;
  providerId: string;
  providerRef: string | null;
  status: string;
  amountMinor: number;
  currency: string;
  packId: string | null;
  planCode: string | null;
  createdAt: Date;
};

export async function getReceipts(
  userId: string,
  limit: number
): Promise<UserQueryResult<ReceiptRow[]>> {
  try {
    const rows = await db
      .select({
        id: schema.payments.id,
        providerId: schema.payments.providerId,
        providerRef: schema.payments.providerRef,
        status: schema.payments.status,
        amountMinor: schema.payments.amountMinor,
        currency: schema.payments.currency,
        packId: schema.payments.packId,
        planCode: schema.payments.planCode,
        createdAt: schema.payments.createdAt,
      })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.userId, userId),
          // Receipts = money actually moved. Pending / failed / cancelled
          // are hidden from this view (they're still visible on the
          // /app/billing page under "recent payments").
          inArray(schema.payments.status, [
            "captured",
            "refunded",
            "partial_refund",
          ])
        )
      )
      .orderBy(desc(schema.payments.createdAt))
      .limit(limit);
    return ok(rows);
  } catch (e) {
    return fail([] as ReceiptRow[], e);
  }
}

// -----------------------------------------------------------------------
// 7. Last 7d + last 30d credit totals (for dashboard StatCards).
//
// Returns two buckets in a single round-trip. Explicitly omits cost.
// -----------------------------------------------------------------------

export type SpendSummary = {
  last7dCredits: number;
  last30dCredits: number;
  last7dCalls: number;
  last30dCalls: number;
};

export async function getSpendSummary(
  userId: string
): Promise<UserQueryResult<SpendSummary>> {
  try {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [row] = await db
      .select({
        c30: sql<number>`COALESCE(SUM(CASE WHEN ${schema.aiUsage.createdAt} >= ${since30} THEN ${schema.aiUsage.creditsSpent} ELSE 0 END), 0)`,
        c7: sql<number>`COALESCE(SUM(CASE WHEN ${schema.aiUsage.createdAt} >= ${since7} THEN ${schema.aiUsage.creditsSpent} ELSE 0 END), 0)`,
        n30: sql<number>`COALESCE(SUM(CASE WHEN ${schema.aiUsage.createdAt} >= ${since30} THEN 1 ELSE 0 END), 0)`,
        n7: sql<number>`COALESCE(SUM(CASE WHEN ${schema.aiUsage.createdAt} >= ${since7} THEN 1 ELSE 0 END), 0)`,
      })
      .from(schema.aiUsage)
      .where(
        and(
          eq(schema.aiUsage.userId, userId),
          gte(schema.aiUsage.createdAt, since30)
        )
      );

    return ok({
      last30dCredits: Number(row?.c30) || 0,
      last7dCredits: Number(row?.c7) || 0,
      last30dCalls: Number(row?.n30) || 0,
      last7dCalls: Number(row?.n7) || 0,
    });
  } catch (e) {
    return fail(
      {
        last7dCredits: 0,
        last30dCredits: 0,
        last7dCalls: 0,
        last30dCalls: 0,
      } as SpendSummary,
      e
    );
  }
}

// Keep drizzleSum / drizzleCount re-imports silenced when unused in
// future edits — they're imported at top-of-file for consistency with
// lib/admin/queries.ts so query rewrites stay mechanical.
void drizzleSum;
