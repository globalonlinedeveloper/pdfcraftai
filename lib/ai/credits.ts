// Credit-spend wrapper for AI operations.
//
// Every AI route handler goes through `spendCredits` before it calls an
// adapter. This file is the single place that:
//   1. Looks up the flat per-op cost from `AI_OPERATION_COSTS`.
//   2. Does a pre-flight balance check so the user sees a clean 402-ish
//      error instead of a negative-balance ledger row.
//   3. Debits the ledger via `grantCredits(delta: -cost)` with a
//      deterministic idempotency key.
//   4. Exposes a `refundCredits` inverse that the route handler calls
//      when the provider errors out mid-stream — we want the user's
//      credit back, not a "you paid for nothing" ticket.
//
// The pre-flight balance check is NOT a true reservation. It's possible
// for two concurrent spends to both see a balance of 2 and both commit
// a -1. We accept that race: worst case the user goes 1 credit negative
// and the next top-up absorbs it. Building a proper reservation would
// mean a second table and a cleanup cron, which isn't worth it at our
// scale — the overdraft window is measured in ms.

import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db/client";
import {
  AI_OPERATION_COSTS,
  type AIOperationId,
} from "@/lib/pricing";
import { grantCredits } from "@/lib/payments/ledger";
// 2026-05-03 plan §8 layer 6 / Gap #2 Option A — per-op cap on
// signup_bonus credits. Feature-flagged via BONUS_PER_OP_CAP_ENABLED;
// helper returns { capped:false } when flag off OR user has paid.
import { checkPerOpBonusCap } from "@/lib/payments/per-op-bonus-cap";

// --- spendCredits ---------------------------------------------------------

export type SpendCreditsInput = {
  userId: string;
  operation: AIOperationId;
  /**
   * Stable idempotency key. Callers typically derive this from the
   * session/message id, e.g. `ai:${sessionId}:${userMessageId}`, so a
   * retried request collapses to a single debit at the ledger layer.
   */
  idempotencyKey: string;
  /** Optional free-form note — shown in /app/billing ledger. */
  note?: string;
  /**
   * Per-unit multiplier for operations whose cost scales linearly (today
   * just `ocr`, which is 2 credits per page). Defaults to 1 for flat-cost
   * operations. Must be a positive integer.
   *
   * We keep this a simple multiplier rather than a full cost model so the
   * flat-cost callers (chat_turn, summarize, translate, compare) don't
   * change — they omit the field and get the historical behavior.
   */
  multiplier?: number;
};

export type SpendCreditsResult =
  | {
      ok: true;
      ledgerId: string;
      creditsSpent: number;
      newBalance: number;
    }
  | {
      ok: false;
      reason: "insufficient";
      balance: number;
      required: number;
      /**
       * Set when the spend was blocked by the per-op signup-bonus cap
       * rather than a true zero-balance situation. Routes that want
       * different copy can check this flag; routes that don't will
       * just emit the standard 402 message (still correct — topping
       * up DOES fix the cap).
       */
      capExceeded?: true;
    }
  | { ok: false; reason: "duplicate" };

/**
 * Debit credits for a single AI operation. Returns a discriminated result
 * the route handler switches on:
 *   - `ok: true`    → proceed with the adapter call; remember `ledgerId`
 *                     for audit.
 *   - `insufficient`→ return 402 / "not enough credits" to the client.
 *   - `duplicate`   → the same operation already ran; treat as success
 *                     but DON'T re-invoke the adapter (caller should
 *                     replay the stored assistant message instead).
 */
export async function spendCredits(
  input: SpendCreditsInput
): Promise<SpendCreditsResult> {
  const unitCost = AI_OPERATION_COSTS[input.operation];
  // TS would catch an unknown operation at build time, but defend against
  // bad runtime data (e.g. an operation id read from the DB).
  if (!unitCost || unitCost <= 0) {
    throw new Error(
      `spendCredits: unknown or non-positive cost for operation "${input.operation}"`
    );
  }
  const multiplier = input.multiplier ?? 1;
  if (!Number.isInteger(multiplier) || multiplier <= 0) {
    throw new Error(
      `spendCredits: multiplier must be a positive integer, got ${multiplier}`
    );
  }
  const cost = unitCost * multiplier;

  // 2026-05-03 plan §8 layer 6 / Gap #2 Option A — per-op bonus cap.
  // Skipped when BONUS_PER_OP_CAP_ENABLED!=="true" (the helper short-
  // circuits to {capped:false}). Skipped also when the user has ever
  // paid (the helper's paid-probe returns {capped:false}). Only fires
  // for true free-trial users; bounds how much of their 5-credit pool
  // can land on any one op type. See lib/payments/per-op-bonus-cap.ts
  // and docs/GAP2_DESIGN_OPTIONS.md for design rationale.
  const capCheck = await checkPerOpBonusCap(input.userId, input.operation);
  if (capCheck.capped && capCheck.remaining < cost) {
    // Surface as insufficient — same 402 path the route handlers
    // already use. The capExceeded flag lets callers that care emit
    // bespoke copy ("free-trial cap reached on this tool") while the
    // default path stays "Top up to keep using it" — which IS the
    // resolution either way (paid balance bypasses the cap).
    return {
      ok: false,
      reason: "insufficient",
      // Report what's actually available on this op via the bonus
      // pool. Topping up bypasses the cap entirely so the "Top up"
      // CTA still resolves the user's blocker correctly.
      balance: capCheck.remaining,
      required: cost,
      capExceeded: true,
    };
  }

  // Pre-flight balance check. See file header for the race discussion.
  const [row] = await db
    .select({ balance: schema.credits.balance })
    .from(schema.credits)
    .where(eq(schema.credits.userId, input.userId))
    .limit(1);
  const balance = row?.balance ?? 0;
  if (balance < cost) {
    return { ok: false, reason: "insufficient", balance, required: cost };
  }

  const grant = await grantCredits({
    userId: input.userId,
    delta: -cost,
    reason: `ai_${input.operation}`,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
  });

  if (grant.applied) {
    return {
      ok: true,
      ledgerId: grant.ledgerId,
      creditsSpent: cost,
      newBalance: grant.newBalance,
    };
  }

  // Duplicate idempotency key — previously-recorded spend, surface to
  // the caller so it can skip the adapter call. `zero_delta` can't
  // happen here because we guarded `cost > 0` above.
  if (grant.reason === "duplicate") {
    return { ok: false, reason: "duplicate" };
  }
  // Unreachable given the cost > 0 guard, but TS narrow requires this.
  throw new Error(`spendCredits: unexpected grant result: ${grant.reason}`);
}

// --- refundCredits --------------------------------------------------------

export type RefundCreditsInput = {
  userId: string;
  operation: AIOperationId;
  /**
   * The ORIGINAL idempotency key passed to `spendCredits`. We derive the
   * refund's own key as `refund:${originalKey}` so replayed refunds also
   * collapse to one ledger row.
   */
  originalIdempotencyKey: string;
  note?: string;
  /**
   * Must match the multiplier originally passed to `spendCredits` so the
   * refund amount equals the debit. Default 1. For OCR the route handler
   * must pass `pages` here and pass the same number to the spend call.
   */
  multiplier?: number;
};

export type RefundCreditsResult =
  | { ok: true; ledgerId: string; creditsRefunded: number; newBalance: number }
  | { ok: false; reason: "duplicate" };

/**
 * Reverse a prior `spendCredits` — used when the AI provider errored out
 * mid-stream and the user didn't actually get a response. Implemented as
 * a `grantCredits(+cost)` with a deterministic `refund:` prefix so the
 * refund itself is idempotent.
 */
export async function refundCredits(
  input: RefundCreditsInput
): Promise<RefundCreditsResult> {
  const unitCost = AI_OPERATION_COSTS[input.operation];
  if (!unitCost || unitCost <= 0) {
    throw new Error(
      `refundCredits: unknown or non-positive cost for operation "${input.operation}"`
    );
  }
  const multiplier = input.multiplier ?? 1;
  if (!Number.isInteger(multiplier) || multiplier <= 0) {
    throw new Error(
      `refundCredits: multiplier must be a positive integer, got ${multiplier}`
    );
  }
  const cost = unitCost * multiplier;

  const grant = await grantCredits({
    userId: input.userId,
    delta: cost,
    reason: `ai_${input.operation}_refund`,
    note: input.note ?? "Refund: provider error",
    idempotencyKey: `refund:${input.originalIdempotencyKey}`,
  });

  if (grant.applied) {
    return {
      ok: true,
      ledgerId: grant.ledgerId,
      creditsRefunded: cost,
      newBalance: grant.newBalance,
    };
  }
  if (grant.reason === "duplicate") {
    return { ok: false, reason: "duplicate" };
  }
  throw new Error(`refundCredits: unexpected grant result: ${grant.reason}`);
}
