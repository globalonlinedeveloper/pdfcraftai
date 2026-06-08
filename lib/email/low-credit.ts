// lib/email/low-credit.ts — low-credit-nudge reconcile (I/O layer).
//
// Called from grantCredits() on EVERY applied balance change (spend =
// negative delta, top-up = positive delta) — the single chokepoint for
// balance movement. Pure decision in ./low-credit-policy; this file
// does the atomic flag claim/clear + the send.
//
// Never throws (grantCredits also wraps the call) — a notice side-
// effect must never affect a ledger write.

import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { sendLowCreditEmail } from "./transactional";
import { lowCreditDecision, lowCreditThreshold } from "./low-credit-policy";

export async function reconcileLowCreditNotice(
  userId: string,
  newBalance: number,
  delta: number,
): Promise<void> {
  try {
    const threshold = lowCreditThreshold();
    const action = lowCreditDecision({ newBalance, delta, threshold });
    if (action === "noop") return;

    if (action === "rearm") {
      // Top-up crossed back to >= threshold — clear the flag so the
      // next draw-down can nudge again. Scoped to NOT NULL so it's a
      // no-op when already armed.
      await db
        .update(schema.users)
        .set({ lowCreditNotifiedAt: null })
        .where(
          and(
            eq(schema.users.id, userId),
            isNotNull(schema.users.lowCreditNotifiedAt),
          ),
        );
      return;
    }

    // action === "claim": atomically stamp notified_at IF still NULL.
    // affectedRows === 1 means WE won the crossing (no concurrent spend
    // already claimed it) → send exactly one email.
    const upd = await db
      .update(schema.users)
      .set({ lowCreditNotifiedAt: new Date() })
      .where(
        and(
          eq(schema.users.id, userId),
          isNull(schema.users.lowCreditNotifiedAt),
        ),
      );
    const header = Array.isArray(upd) ? upd[0] : upd;
    const affected =
      (header as { affectedRows?: number } | undefined)?.affectedRows ?? 0;
    if (affected === 1) {
      await sendLowCreditEmail(userId, newBalance, threshold);
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "low_credit_reconcile_threw",
        userId,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    );
  }
}
