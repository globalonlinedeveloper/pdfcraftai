import { NextResponse } from "next/server";
import { z } from "zod";
import { mintPasswordResetToken } from "@/lib/password-reset";

/**
 * Forgot-password endpoint.
 *
 * Anti-enumeration contract: MUST ack identically whether or not the email
 * exists. For valid payloads we always return 200. We still mint a token
 * when the email DOES exist (so the reset URL appears in the server log
 * right now, and so the mail-send in a later commit is a two-line drop-in).
 *
 * When transactional mail is wired:
 *   1. Remove the console.log below.
 *   2. Send the URL via the provider (SendGrid / Postmark / Resend).
 *   3. Leave the 200-on-miss behaviour exactly as-is.
 *
 * Rate limit: one successful mint per email per 60 seconds. Unauthenticated
 * rate limiter, fine for stub traffic. Replace with edge KV before real
 * load (noted in deployment notes).
 */

const schema = z.object({
  email: z.string().email().max(320),
});

// Naïve per-email rate limiter — replace with edge KV before real traffic.
const recent = new Map<string, number>();
const WINDOW_MS = 60_000;

function buildResetUrl(req: Request, rawToken: string): string {
  // Prefer the env var set in prod, fall back to the request origin so
  // local dev + preview deploys "just work" without extra config.
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return `${configured}/reset-password/${rawToken}`;

  try {
    const origin = new URL(req.url).origin;
    return `${origin}/reset-password/${rawToken}`;
  } catch {
    return `/reset-password/${rawToken}`;
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const now = Date.now();
  const last = recent.get(email) ?? 0;
  if (now - last < WINDOW_MS) {
    // Still 200 to avoid leaking which addresses are throttled.
    console.warn("[forgot-password] throttled", email);
    return NextResponse.json({ ok: true });
  }
  recent.set(email, now);

  try {
    const minted = await mintPasswordResetToken(email);
    if (minted) {
      const url = buildResetUrl(req, minted.rawToken);
      // UNTIL transactional mail is wired: log the reset URL so an
      // operator can hand it to the user on request. The URL contains
      // a bearer token — DO NOT add it to any third-party logger that
      // ships to external dashboards (PII/bearer exposure). Server-only
      // console output is acceptable because it's in Hostinger's Node
      // process log, gated by SSH access.
      console.log(
        "[forgot-password] reset URL issued",
        JSON.stringify({
          at: new Date().toISOString(),
          email,
          expiresAt: minted.expiresAt.toISOString(),
          url,
        }),
      );
    } else {
      // User not found — still ack 200.
      console.log(
        "[forgot-password] no account",
        JSON.stringify({ at: new Date().toISOString(), email }),
      );
    }
  } catch (err) {
    // Log but still 200 — we'd rather obscure failure than surface
    // "this account exists but the DB is broken" to an enumeration probe.
    console.error("[forgot-password] mint failed", err);
  }

  return NextResponse.json({ ok: true });
}
