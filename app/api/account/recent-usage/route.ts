// app/api/account/recent-usage/route.ts — Last-N-days credit recap.
//
// Plan §9 / Gap #4 (2026-05-03): the OutOfCreditsAlert needs a small
// "you used N credits this week — top tools: X, Y, Z" block to remind
// users what their balance went toward and drive top-up conversion.
//
// Why a dedicated endpoint instead of reusing the /app/usage data
//   The /app/usage page is server-rendered with a redirect to /login
//   for anon. OutOfCreditsAlert is a CLIENT component that lives
//   inside an authed tool runner — the user is already signed in but
//   the alert needs JSON over fetch, not server-rendered HTML.
//
// Why credits-only response (no cost_micros, no rupees)
//   Same Principle 1 lock as the rest of the user surface — credits
//   are the unit users see; rupees only at /buy. This endpoint
//   delegates to lib/user/queries:getUsageRollup which already enforces
//   the credits-only contract.
//
// Auth contract
//   userId comes EXCLUSIVELY from auth(). 401 if anon. The endpoint
//   refuses to accept a userId via body / query — same PII wall as
//   the /app/usage page.
//
// Response shape
//   { totalCredits: number, days: 7, top: [{ op, credits, calls }] }
//
//   - totalCredits — sum of credit spend in the window
//   - top — operations ordered by spend desc, top 3
//   - Empty array if the user hasn't run anything in the window
//     (caller decides whether to render the recap or skip it)

import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUsageRollup } from "@/lib/user/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 7-day window. Hard-coded — there's no per-user override here. If we
// ever want a user-tunable window we'll re-use clampUserDays() from
// lib/user/format.ts; for now Plan §9 specifies "last 7 days you used"
// as the canonical recap framing.
const WINDOW_DAYS = 7;

// Cap on how many operations we surface in the alert. 3 keeps the
// alert visually compact while covering the dominant tools — anyone
// who used 4+ tools in a week is already a power user and the alert's
// job is to drive conversion, not narrate.
const TOP_N = 3;

export async function GET() {
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (!userId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const rollup = await getUsageRollup(userId, WINDOW_DAYS);
  if (rollup.error) {
    // Soft error — return empty payload so the alert just hides the
    // recap section. Logging the underlying error is the rollup
    // helper's responsibility (it stamps fail() with a stderr line).
    return NextResponse.json({
      totalCredits: 0,
      days: WINDOW_DAYS,
      top: [],
    });
  }

  // Sort + slice in JS (the Drizzle query already orders desc by
  // creditsSpent, so this is mostly defensive — keeps the contract
  // explicit for future caller assumptions).
  const sorted = [...rollup.data].sort(
    (a, b) => b.creditsSpent - a.creditsSpent,
  );
  const totalCredits = sorted.reduce((acc, r) => acc + r.creditsSpent, 0);
  const top = sorted.slice(0, TOP_N).map((r) => ({
    op: r.operation,
    credits: r.creditsSpent,
    calls: r.calls,
  }));

  return NextResponse.json({
    totalCredits,
    days: WINDOW_DAYS,
    top,
  });
}
