// /api/admin/evals/grade-pairwise — POST handler for the Phase
// G-2 side-by-side grader (PENDING §6a final, 2026-05-07).
//
// Auth: must be admin. graderUserId pulled from session, NEVER
// from body — anti-impersonation. Same posture as the
// single-output grader at /api/admin/evals/grade.
//
// Body shape:
//   {
//     goldenSetId: string,
//     op: string,
//     leftProviderId: string,
//     leftModel: string,
//     rightProviderId: string,
//     rightModel: string,
//     preference: "left"|"right"|"tie"|"both_bad",
//     leftOverallScore?: 1..5 | null,
//     rightOverallScore?: 1..5 | null,
//     notes?: string,
//     leftOutputExcerpt?: string,
//     rightOutputExcerpt?: string,
//     replace?: boolean
//   }

import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin/guard";
import {
  PairwiseGradeWriteError,
  recordPairwiseGrade,
  type PairwisePreference,
} from "@/lib/ai/eval/pairwise-grade-writer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ALLOWED_PREFS: ReadonlyArray<PairwisePreference> = [
  "left",
  "right",
  "tie",
  "both_bad",
];

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  const email = session?.user?.email;
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (typeof userId !== "string") {
    return json(401, { error: "not_authenticated" });
  }
  if (!isAdminEmail(email, process.env.ADMIN_EMAILS)) {
    return json(403, { error: "forbidden" });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid_body" });
  }

  const pref = body.preference as unknown;
  if (
    typeof pref !== "string" ||
    !ALLOWED_PREFS.includes(pref as PairwisePreference)
  ) {
    return json(400, {
      error: "invalid_preference",
      detail: `preference must be one of ${ALLOWED_PREFS.join("/")}`,
    });
  }

  try {
    const result = await recordPairwiseGrade({
      goldenSetId: String(body.goldenSetId ?? ""),
      op: String(body.op ?? ""),
      leftProviderId: String(body.leftProviderId ?? ""),
      leftModel: String(body.leftModel ?? ""),
      rightProviderId: String(body.rightProviderId ?? ""),
      rightModel: String(body.rightModel ?? ""),
      graderUserId: userId,
      preference: pref as PairwisePreference,
      leftOverallScore:
        typeof body.leftOverallScore === "number"
          ? body.leftOverallScore
          : null,
      rightOverallScore:
        typeof body.rightOverallScore === "number"
          ? body.rightOverallScore
          : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      leftOutputExcerpt:
        typeof body.leftOutputExcerpt === "string"
          ? body.leftOutputExcerpt
          : null,
      rightOutputExcerpt:
        typeof body.rightOutputExcerpt === "string"
          ? body.rightOutputExcerpt
          : null,
      replace: body.replace === true,
    });
    return json(200, { ok: true, id: result.id });
  } catch (err) {
    if (err instanceof PairwiseGradeWriteError) {
      const status =
        err.code === "DUPLICATE"
          ? 409
          : err.code === "DB_ERROR"
          ? 500
          : 400;
      return json(status, {
        error: err.code.toLowerCase(),
        detail: err.message,
      });
    }
    console.error("[grade-pairwise] unexpected error:", err);
    return json(500, { error: "internal" });
  }
}
