// Task #12 — shared entry-gate for every /api/ai/* route handler.
//
// Every op route has the same two checks sandwiched between `auth()` and
// `spendCredits()`:
//
//   1. Is this op currently killed by env var? → 503 `op_disabled`.
//   2. Has this user exceeded their daily cost ceiling? → 429 with
//      `Retry-After: <seconds until 00:00 UTC>`.
//
// Inlining ~25 lines of try/catch into 10 route handlers creates 250
// lines of copy-paste where a single mistake (wrong op string, missed
// Retry-After header, inconsistent JSON body shape) drifts across files
// and becomes a migration problem later. Consolidating into ONE helper
// here means the contract lives in one place:
//
//   - Same JSON body shape for every op's 503 / 429.
//   - Same Retry-After header placement.
//   - Same instanceof-based error classification (so if we add a third
//     pre-spend check later — e.g. a TOS-acceptance gate for EU users
//     per Task #24 — we add it here and every handler gets it).
//
// Usage pattern in a route handler:
//
//     const session = await auth();
//     const userId = session?.user ? (session.user as { id?: string }).id : undefined;
//     if (!userId) return json(401, { error: "not_authenticated" });
//
//     const gate = await guardAiRoute("summarize", userId);
//     if (gate) return gate;
//
//     // ... continue with idempotency replay / spendCredits / etc.
//
// The helper returns `Response | null`:
//   - `null` → all gates passed, continue with the op.
//   - `Response` → gate tripped; the handler returns it directly.
//
// This is the same shape as Next.js middleware + most other route-gate
// patterns in the app, so it reads idiomatically at the top of each
// handler.
//
// Why not also fold auth() into here
// ----------------------------------
// Auth handling is slightly different per op — chat does SSE on 401,
// a few ops have extra session shape checks — and bundling auth in
// here would force every route to adopt an identical auth posture.
// Keeping auth in each route + gate as a separate single-line call is
// a cleaner split of concerns.

import "server-only";

import { OpKilledError, assertOpNotKilled } from "./kill-switches";
import {
  DailyCostCeilingExceededError,
  assertWithinDailyCap,
} from "./rate-limit";
import type { AIOp } from "./router";

/**
 * Run the pre-spend gate (kill switch + daily cost ceiling) for an op.
 *
 * Returns a ready-to-return Response if any gate trips, or null if all
 * gates passed and the caller should proceed with the op.
 *
 * Never throws — an unexpected error is re-raised so the route handler's
 * outer try/catch can still apply its own error posture; ordinary
 * gate errors (OpKilledError, DailyCostCeilingExceededError) are
 * converted to Responses inline.
 */
export async function guardAiRoute(
  op: AIOp,
  userId: string,
): Promise<Response | null> {
  try {
    assertOpNotKilled(op);
    await assertWithinDailyCap(userId);
    return null;
  } catch (err) {
    if (err instanceof OpKilledError) {
      // 503 with the env var in the body so operators grepping logs can
      // trace a 503 spike back to the flip that caused it. Also sets
      // Retry-After: 60 — we don't know WHEN operators will unflip, so
      // 60s is a conservative client nudge that doesn't thrash us.
      return new Response(
        JSON.stringify({
          error: "op_disabled",
          detail: `AI operation "${err.op}" is currently disabled by the operator.`,
          op: err.op,
          envVar: err.envVar,
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        },
      );
    }
    if (err instanceof DailyCostCeilingExceededError) {
      // 429 with exact seconds to UTC midnight. Body carries used/cap so
      // the client can show "$0.49 of $0.50 used" without a second API
      // call. Values are in µUSD — the /app/usage UI converts for
      // display.
      return new Response(
        JSON.stringify({
          error: "daily_cost_ceiling_exceeded",
          detail:
            "You've reached your daily AI usage budget. It resets at 00:00 UTC.",
          usedMicros: err.usedMicros,
          capMicros: err.capMicros,
          retryAfterSeconds: err.retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(err.retryAfterSeconds),
          },
        },
      );
    }
    // Unknown error — bubble up. The route handler's outer try/catch
    // (or Next.js's default 500 handler) takes over.
    throw err;
  }
}
