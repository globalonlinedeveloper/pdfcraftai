// /api/account/balance — current credit balance for the signed-in user.
//
// Replaces the localStorage demo "BALANCE" chip on /agent (and any
// future client surface that wants to show credits without a full
// /app/billing fetch). Returns a flat integer; the source of truth
// is the same `credits.balance` row that spendCredits debits.
//
// REQUEST  (GET)
//   /api/account/balance
//
// RESPONSE
//   200 { balance: number }
//   401 { error }                       — not signed in
//
// Why this is its own route and not bundled into /api/auth/session:
//   The session payload is cached aggressively by next-auth's client.
//   Credit balance changes after every AI run, and we want fresh reads
//   each time the agent finishes a step. Keeping it separate also lets
//   us add Cache-Control: no-store without breaking session caching.

import "server-only";

import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (!userId) {
    return Response.json(
      { error: { code: "auth_required", message: "Sign in to view balance." } },
      { status: 401 },
    );
  }

  // No row → 0 credits (new account that hasn't been granted a free
  // trial top-up yet). Any non-zero starting balance lives in the
  // existing onboarding flow, not here.
  const row = await db
    .select({ balance: schema.credits.balance })
    .from(schema.credits)
    .where(eq(schema.credits.userId, userId))
    .limit(1)
    .then((rows) => rows[0]);

  return Response.json(
    { balance: row?.balance ?? 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
