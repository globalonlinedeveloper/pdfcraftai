import { NextResponse } from "next/server";
import { z } from "zod";
import { consumePasswordResetToken } from "@/lib/password-reset";

/**
 * Reset-password redemption endpoint.
 *
 * POST { token, password } → 200 { ok: true }  on success
 *                          → 400 { error }     on bad payload
 *                          → 409 { error }     on expired / consumed / missing token
 *
 * The happy path writes the new passwordHash and invalidates every
 * outstanding reset token for the user atomically. Callers should
 * redirect to /login with a "password updated" flash on 200.
 *
 * We intentionally do NOT auto-sign-in after a reset. Forcing a fresh
 * credential login:
 *   a) proves the user knows the new password, and
 *   b) invalidates whichever session was attacking the account.
 *
 * Rate limit: per-IP, 5 attempts per minute. Brute-forcing a 64-char
 * hex token is already infeasible, but we throttle to keep honest
 * clients from chewing through the DB on retry loops.
 */

const schema = z.object({
  token: z
    .string()
    .min(64)
    .max(64)
    .regex(/^[0-9a-f]{64}$/i, "Invalid reset token."),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(128, "Password is too long."),
});

// Per-IP rate limiter. Bucket by minute so we don't need a sliding window.
const attempts = new Map<string, { count: number; minute: number }>();
const PER_MINUTE_LIMIT = 5;

function ipBucket(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  // Rate-limit FIRST — no point touching the DB if we're going to 429.
  const ip = ipBucket(req);
  const minute = Math.floor(Date.now() / 60_000);
  const bucket = attempts.get(ip);
  if (bucket && bucket.minute === minute) {
    if (bucket.count >= PER_MINUTE_LIMIT) {
      return NextResponse.json(
        { error: "Too many attempts. Try again in a minute." },
        { status: 429 },
      );
    }
    bucket.count += 1;
  } else {
    attempts.set(ip, { count: 1, minute });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Invalid request.";
    return NextResponse.json({ error: first }, { status: 400 });
  }

  try {
    const result = await consumePasswordResetToken(
      parsed.data.token,
      parsed.data.password,
    );
    if (!result.ok) {
      // 409 Conflict: the resource (token) is no longer in a usable state.
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-password] consume failed", err);
    return NextResponse.json(
      { error: "Something went wrong. Try requesting a new link." },
      { status: 500 },
    );
  }
}
