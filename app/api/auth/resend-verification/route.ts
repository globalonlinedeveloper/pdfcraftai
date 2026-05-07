// /api/auth/resend-verification — POST handler for the dashboard
// "Resend verification email" banner (PENDING auth-flow gap #2 +
// #4, 2026-05-06).
//
// Auth: must be signed in (session cookie). userId pulled from
// session, NEVER from body — anti-impersonation. A hostile client
// posting another userId in the body is rejected at the auth layer.
//
// Behavior:
//   - Already verified? → 200 { ok:true, alreadyVerified:true }
//   - Rate-limited (last resend < 60s ago)? → 429
//   - SMTP failed? → 502 (operator-actionable; user sees "try again")
//   - User row missing? → 401 (stale session)
//   - Success → 200 { ok:true, sent:true }

import { auth } from "@/auth";
import { resendVerificationEmail } from "@/lib/auth/email-verification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(): Promise<Response> {
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (typeof userId !== "string") {
    return json(401, { error: "not_authenticated" });
  }

  const result = await resendVerificationEmail(userId);
  if (result.ok) {
    if ("alreadyVerified" in result) {
      return json(200, { ok: true, alreadyVerified: true });
    }
    return json(200, { ok: true, sent: true });
  }

  if (result.error === "rate_limited") {
    return json(429, {
      error: "rate_limited",
      detail: "Too soon since last resend. Check your inbox + try again in a minute.",
    });
  }
  if (result.error === "smtp_failed") {
    return json(502, {
      error: "smtp_failed",
      detail:
        "We couldn't send the verification email right now. Try again in a minute, or contact support@pdfcraftai.com.",
    });
  }
  return json(401, { error: result.error });
}
