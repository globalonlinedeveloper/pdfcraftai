// lib/auth/resolve-user.ts — unified userId resolution for AI
// route handlers (Tier 1 #1 follow-on, 2026-05-08).
//
// Each /api/ai/* route used to do:
//
//   const session = await auth();
//   const userId = session?.user
//     ? (session.user as { id?: string }).id
//     : undefined;
//   if (!userId) return json(401, { error: "not_authenticated" });
//
// This helper consolidates that pattern AND adds support for
// API-key authentication via the `x-api-key` header. Header is
// checked FIRST (cheaper than re-loading the session); session
// is the fallback for browser-driven calls.
//
// Header format
// -------------
// `x-api-key: pck_<64-hex>` (raw key from /app/api-keys mint
// flow)
//
// Why x-api-key not Authorization: Bearer
// ---------------------------------------
// Two reasons:
//   1. The Bearer-token slot is already used by the cron routes
//      (`Authorization: Bearer ${CRON_SECRET}`). Mixing user-
//      issued keys with the cron secret on the same header would
//      be confusing in support tickets.
//   2. `x-api-key` is the de-facto convention for API-key
//      authentication on Stripe, AWS API Gateway, OpenAI's
//      programmatic-access tier — users expect this header on
//      a "create your API key" surface.
//
// Returns
// -------
// `{ userId, source: "session" | "api_key" } | null`. The
// `source` discriminator lets the caller log which path was
// used (useful for ai_usage telemetry once we stamp it).

import "server-only";

import { auth } from "@/auth";
import { verifyKey } from "@/lib/api-keys";

export interface ResolvedUser {
  userId: string;
  source: "session" | "api_key";
  /** Present only when source === "api_key" — the api_keys.id
   *  that authenticated. Future per-key telemetry / rate-limit
   *  hooks key on this. */
  keyId?: string;
}

/**
 * Resolve the calling user from a Request. Tries:
 *   1. x-api-key header → verifyKey → { userId, keyId }
 *   2. session cookie (NextAuth) → { userId }
 *   3. null on no match
 *
 * The header path runs ONLY when the header is present + non-
 * empty — empty header doesn't fall through to a "tried API
 * key, failed, now fall back to session" race. If a caller
 * sends an invalid x-api-key, they get null (not session-fallback)
 * — prevents silent downgrade attacks where a hostile script
 * sends `x-api-key: garbage` and gets the human-session's auth.
 */
export async function resolveUser(req: Request): Promise<ResolvedUser | null> {
  // 1. API-key header path
  const apiKeyHeader = req.headers.get("x-api-key");
  if (typeof apiKeyHeader === "string" && apiKeyHeader.length > 0) {
    const result = await verifyKey(apiKeyHeader.trim());
    if (result) {
      return {
        userId: result.userId,
        source: "api_key",
        keyId: result.keyId,
      };
    }
    // Header was sent but didn't verify — return null. Don't
    // fall through to session (anti-downgrade).
    return null;
  }

  // 2. Session cookie path
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (typeof userId === "string") {
    return { userId, source: "session" };
  }

  return null;
}
