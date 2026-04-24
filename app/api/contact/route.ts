import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Contact form handler.
 *
 * Currently logs the message server-side and returns 200. When the email
 * provider lands (SendGrid / Postmark / Resend), send the payload to support
 * + a thank-you acknowledgement back to the submitter.
 *
 * Rate limiting is intentionally light (one submission per email per 60s,
 * in-memory). Replace with an edge KV store before this sees real traffic.
 */

const contactSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  topic: z.string().min(1).max(60),
  message: z.string().min(10).max(5000),
  // Honeypot (Task #30). Real users never see this field; bots fill
  // every textbox. Any non-empty value triggers a silent 200 reject
  // so the spammer doesn't learn the form bounced.
  website: z.string().max(0).optional(),
});

// Per-email limit — one submission per email per 60s.
const recentByEmail = new Map<string, number>();
const EMAIL_LIMIT_MS = 60_000;

// Per-IP limit (Task #30) — 3 submissions per IP per 5 minutes.
// Catches the "rotate emails to bypass per-email limit" vector that
// 2026-04-24 smoke testing exposed (8 different @example.test emails
// all returned 200). 3/5min leaves real users with retries after
// typos plenty of headroom.
const recentByIp = new Map<string, number[]>();
const IP_WINDOW_MS = 5 * 60_000;
const IP_LIMIT = 3;

function clientIpFromHeaders(headers: Headers): string {
  // Cloudflare sets cf-connecting-ip. Fallback to the first entry of
  // x-forwarded-for. Our origin is behind Cloudflare — direct access
  // is firewalled off — so one of these is always present in prod.
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return "unknown";
}

function ipRateLimitOk(ip: string, now: number): boolean {
  if (ip === "unknown") return true; // fail-open behind CF
  const history = recentByIp.get(ip) ?? [];
  const inWindow = history.filter((t) => now - t < IP_WINDOW_MS);
  if (inWindow.length >= IP_LIMIT) {
    recentByIp.set(ip, inWindow);
    return false;
  }
  inWindow.push(now);
  recentByIp.set(ip, inWindow);
  // Periodic GC to bound memory under sustained traffic.
  if (recentByIp.size > 1000) {
    for (const [k, v] of recentByIp) {
      const still = v.filter((t) => now - t < IP_WINDOW_MS);
      if (still.length === 0) recentByIp.delete(k);
      else recentByIp.set(k, still);
    }
  }
  return true;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please fill in all fields. Messages need at least 10 characters." },
      { status: 400 },
    );
  }

  // Honeypot — silent 200 (don't reveal we noticed).
  if (parsed.data.website && parsed.data.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const { email } = parsed.data;
  const now = Date.now();

  // Per-IP throttle first — catches bots rotating emails.
  const ip = clientIpFromHeaders(req.headers);
  if (!ipRateLimitOk(ip, now)) {
    return NextResponse.json(
      {
        error:
          "Too many submissions from your network. Try again in a few minutes.",
      },
      { status: 429 },
    );
  }

  const last = recentByEmail.get(email) ?? 0;
  if (now - last < EMAIL_LIMIT_MS) {
    return NextResponse.json(
      { error: "You just sent a message. Give us a minute, then try again." },
      { status: 429 },
    );
  }
  recentByEmail.set(email, now);

  // TODO(email): wire SendGrid / Postmark here.
  // For now just log so the ops team can see submissions in the Hostinger
  // logs until the mail provider is configured.
  console.log(
    "[contact]",
    JSON.stringify({
      at: new Date().toISOString(),
      ...parsed.data,
    }),
  );

  return NextResponse.json({ ok: true });
}
