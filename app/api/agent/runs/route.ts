// /api/agent/runs — list the signed-in user's recent runs.
//
// Powers the future /app/agent/history page (deferred). Useful today
// for ad-hoc inspection from the browser console.
//
// REQUEST  (GET)
//   /api/agent/runs            → 20 most recent
//   /api/agent/runs?limit=50   → up to 100
//
// RESPONSE
//   { runs: RunSummary[] }
//
// ERRORS
//   401 → not signed in

import "server-only";

import { auth } from "@/auth";
import { listRunsForUser } from "@/lib/agent/run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json(
      { error: { code: "auth_required", message: "Sign in." } },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 20, 1), 100) : 20;

  const runs = await listRunsForUser({
    userId: session.user.id,
    limit,
  });

  return Response.json({ runs }, { status: 200 });
}
