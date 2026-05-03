// Per-op bonus cap (plan §8 layer 6 / Gap #2 / Option A).
//
// Caps how many of a user's signup_bonus credits can go to any single
// AI op type. Without this cap, a bot that beats the upstream 6 abuse
// layers (disposable email blocklist, Gmail+alias normalize, email
// verification gate, IP /24 throttle, device fingerprint, Cloudflare
// Turnstile) can still redeem all 5 free credits in a single
// high-value run (e.g. one OCR on a 5-page PDF). The per-op cap makes
// the bonus pool stretch only across multiple distinct ops.
//
// Design ref: docs/GAP2_DESIGN_OPTIONS.md (Option A).
//
// Semantics:
//   - The cap is BONUS_PER_OP_CAP credits per (userId, op), default 2.
//   - A user who has EVER paid (any credit_ledger row with reason
//     starting with "purchase" or "subscription") is exempt — the cap
//     only applies to true free-trial users.
//   - If exempt, the helper returns { capped: false } cheaply (1 query).
//   - If capped, the helper computes how much the user has already
//     spent on this op (across all of their signup_bonus pool) and
//     returns the remaining budget.
//
// Feature flag:
//   - Default OFF. Enable by setting BONUS_PER_OP_CAP_ENABLED="true"
//     in the Hostinger env. Lets us A/B test in prod without redeploy.
//   - When OFF, the helper returns { capped: false, exemptReason:
//     "feature_disabled" } unconditionally.
//
// Performance:
//   - Best case (feature off OR user has paid): 0–1 indexed queries.
//   - Worst case (feature on, free-trial user): 2 indexed queries.
//     One on credit_ledger (paid? probe), one on ai_usage (op spend
//     tally). Both return on indexed columns.
//
// Why this lives in lib/payments not lib/ai:
//   The cap is a property of the credit grant (signup_bonus), not of
//   the AI op. Future paid plans might apply different caps without
//   touching AI route handlers.

import "server-only";

import { and, eq, like, or } from "drizzle-orm";

import { db, schema } from "@/db/client";
import type { AIOperationId } from "@/lib/pricing";

const DEFAULT_CAP = 2;

/**
 * Whether the per-op bonus cap is currently enforced. Default OFF;
 * Hostinger panel flag `BONUS_PER_OP_CAP_ENABLED=true` enables.
 */
export function isPerOpBonusCapEnabled(): boolean {
  return process.env.BONUS_PER_OP_CAP_ENABLED === "true";
}

/**
 * Cap value (credits per op). Env-overridable via BONUS_PER_OP_CAP.
 * Defaults to 2.
 */
export function bonusPerOpCap(): number {
  const raw = process.env.BONUS_PER_OP_CAP;
  if (!raw) return DEFAULT_CAP;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CAP;
  return parsed;
}

export type PerOpBonusCapResult =
  | { capped: false; exemptReason: "feature_disabled" | "user_has_paid" }
  | { capped: true; cap: number; spent: number; remaining: number };

/**
 * Check whether a proposed spend would exceed the per-op bonus cap.
 *
 * Returns { capped: false } when the user is exempt (feature off, or
 * they've ever paid). Returns { capped: true, ... } with the
 * remaining-budget detail when the cap applies.
 *
 * The CALLER decides what to do — typically: if cap.remaining < cost,
 * deny the spend with a 402-shaped result. This helper is pure
 * inspection; it doesn't mutate anything.
 */
export async function checkPerOpBonusCap(
  userId: string,
  operation: AIOperationId,
): Promise<PerOpBonusCapResult> {
  // Fast-path: feature off.
  if (!isPerOpBonusCapEnabled()) {
    return { capped: false, exemptReason: "feature_disabled" };
  }

  // Probe whether the user has ever paid. We check for any positive-
  // delta credit_ledger row whose reason starts with "purchase" or
  // "subscription". `manual_grant` is NOT a "paid" signal — admin
  // goodwill grants shouldn't lift the cap.
  const paidRows = await db
    .select({ id: schema.creditLedger.id })
    .from(schema.creditLedger)
    .where(
      and(
        eq(schema.creditLedger.userId, userId),
        or(
          like(schema.creditLedger.reason, "purchase%"),
          like(schema.creditLedger.reason, "subscription%"),
        ),
      ),
    )
    .limit(1);

  if (paidRows.length > 0) {
    return { capped: false, exemptReason: "user_has_paid" };
  }

  // User is on the bonus-only pool. Tally their op-specific spend.
  // We sum across ALL ai_usage rows for this (userId, op) pair —
  // not scoped to "since signup_bonus grant" because the cap is a
  // lifetime per-op cap on the bonus pool. (If they later top up,
  // the next call returns capped:false via the paid-probe above.)
  const usageRows = await db
    .select({ creditsSpent: schema.aiUsage.creditsSpent })
    .from(schema.aiUsage)
    .where(
      and(
        eq(schema.aiUsage.userId, userId),
        eq(schema.aiUsage.operation, operation),
      ),
    );

  const spent = usageRows.reduce(
    (acc, r) => acc + (Number(r.creditsSpent) || 0),
    0,
  );
  const cap = bonusPerOpCap();
  const remaining = Math.max(0, cap - spent);

  return { capped: true, cap, spent, remaining };
}
