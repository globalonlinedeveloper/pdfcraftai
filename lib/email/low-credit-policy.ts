// lib/email/low-credit-policy.ts — PURE low-credit-nudge decision.
//
// No imports / no I/O so it's unit-testable in isolation. The reconcile
// layer (./low-credit) threads this through the DB.
//
// The nudge targets PURCHASERS drawing a pack down, NOT free-trial
// users (who start at ~5 credits). That's enforced by only firing on a
// genuine DOWNWARD crossing from at/above the threshold: a free user's
// only sub-threshold balance comes from a grant (delta > 0), which can
// never be a "claim". A purchaser who buys 100+ and spends below the
// threshold crosses down (delta < 0, pre >= threshold) exactly once.

export type LowCreditAction = "claim" | "rearm" | "noop";

/** Resolve the threshold from env (LOW_CREDIT_THRESHOLD, default 50).
 *  <= 0 (or non-numeric) disables the feature entirely. */
export function lowCreditThreshold(): number {
  const n = parseInt(process.env.LOW_CREDIT_THRESHOLD ?? "50", 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Decide what to do after a balance change of `delta` that produced
 * `newBalance`:
 *   - "claim" — a spend crossed the balance DOWN from >= threshold to
 *     < threshold. Send the nudge (once; the reconcile layer also
 *     guards on the notified_at flag).
 *   - "rearm" — a grant brought the balance back to >= threshold. Clear
 *     the flag so a later draw-down can nudge again.
 *   - "noop" — anything else (still above, still below without a fresh
 *     crossing, a grant that stays below threshold, feature disabled).
 */
export function lowCreditDecision(opts: {
  newBalance: number;
  delta: number;
  threshold: number;
}): LowCreditAction {
  const { newBalance, delta, threshold } = opts;
  if (!Number.isFinite(threshold) || threshold <= 0) return "noop";
  if (delta < 0) {
    const pre = newBalance - delta; // delta < 0 → pre > newBalance
    if (pre >= threshold && newBalance < threshold) return "claim";
    return "noop";
  }
  if (delta > 0) {
    return newBalance >= threshold ? "rearm" : "noop";
  }
  return "noop";
}
