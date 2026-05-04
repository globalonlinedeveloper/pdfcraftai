// app/api/ai/feedback/route.ts — thumbs ↑/↓ on AI outputs.
//
// PENDING_WORK_ANALYSIS.md §6b. The data flywheel for AI quality.
// Schema + persist endpoint ship in this commit; UI integration
// (FeedbackChip on AI result cards) follows in the next commit so
// the cascade-bearing UI change can be reviewed independently.
//
// Auth contract
//   userId comes EXCLUSIVELY from auth(). 401 if anon. The endpoint
//   refuses to accept a userId via body — same PII wall as the rest
//   of the user surface (recent-usage / estimate / etc.).
//
// Idempotency
//   UNIQUE(user_id, ai_usage_id) on the table; route uses ON
//   DUPLICATE KEY UPDATE so a flip from up → down replaces in place.
//   Repeated identical clicks are no-op (the row's verdict is already
//   what we'd write).
//
// Rate limiting
//   60/min per user. Real users click thumbs at most a few times per
//   minute; an automated abuser could rotate through historical
//   ai_usage rows trying to skew the NPS. 60/min bounds the damage
//   without inconveniencing legit clicks. Same in-process bucket
//   pattern as recent-usage.
//
// Verdict validation
//   Only "up" | "down" today. The varchar(8) column accepts up to
//   8 chars so future "n/a" / "flag" verdicts don't need a migration,
//   but the route's zod schema gates new variants to a deliberate
//   change.
//
// Response shape
//   200 → { ok: true, verdict: "up" | "down" } (echoes back what we
//   stored, so the client can update its optimistic UI state with a
//   confirmed value)
//   400 → { error: "invalid" } (validation failed)
//   401 → { error: "auth_required" }
//   429 → { error: "rate_limited" }
//   500 → { error: "persist_failed" }

import "server-only";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Match the table's varchar(8) verdict column. Add new verdicts here
// AND in the comment on schema.aiFeedback.verdict (the schema's
// inline doc is the SSOT for "what verdicts are accepted").
const VERDICTS = ["up", "down"] as const;

const feedbackSchema = z.object({
  // Required — we attach feedback to a concrete AI call. The client
  // should pass the ai_usage row id from the response that produced
  // the output (every AI route handler now writes one — see
  // app/api/ai/<op>/route.ts spendCredits + ai_usage insert pair).
  // Nullable for legacy callers (the schema accepts null and the
  // table allows NULL), but in practice always present going forward.
  aiUsageId: z.string().min(1).max(64).nullable().optional(),
  // Optional — when feedback is on a file-bound output (summary,
  // translation, etc.) the client can pass the file id. Null for
  // chat_turn feedback.
  fileId: z.string().min(1).max(64).nullable().optional(),
  // Required — the operation id ("summarize", "translate", etc.).
  // Free string capped at 32 chars to match ai_usage.operation column.
  operation: z.string().min(1).max(32),
  verdict: z.enum(VERDICTS),
  // Optional canned reason chip. Capped at the column size.
  reason: z.string().min(1).max(128).nullable().optional(),
  // Optional free-text. 1000-char zod cap keeps abusive payloads from
  // hitting the DB; the column is `text` (~64KB) so we have headroom.
  note: z.string().min(1).max(1000).nullable().optional(),
  // Optional denormalized fields. Caller passes whatever ai_usage row
  // it has on hand; admin queries use these without a join.
  providerId: z.string().min(1).max(32).nullable().optional(),
  model: z.string().min(1).max(128).nullable().optional(),
});

// Per-user token bucket. Same pattern as recent-usage — 60/min, in-
// process, resets on deploy. Adequate at single-process scale.
const buckets = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

function consume(userId: string): boolean {
  const now = Date.now();
  const b = buckets.get(userId);
  if (!b || now - b.windowStart > WINDOW_MS) {
    buckets.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= MAX_PER_WINDOW) return false;
  b.count += 1;
  return true;
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (!userId) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  if (!consume(userId)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const v = parsed.data;

  try {
    // Upsert: insert if no (user_id, ai_usage_id) row exists; update
    // verdict + reason + note + denormalized columns if it does. The
    // updated_at column auto-bumps via ON UPDATE CURRENT_TIMESTAMP.
    //
    // We deliberately DO NOT set updated_at in the SET clause — the
    // DB-side ON UPDATE handles it. Mixing app-side timestamps with
    // server-side defaults is the kind of subtle drift that the next
    // refactor breaks; let MySQL own the column.
    //
    // The id is fresh per insert; on conflict it's irrelevant (we
    // don't update id). Inserting a UUID we never use on a flip is
    // a harmless wart.
    await db
      .insert(schema.aiFeedback)
      .values({
        id: randomUUID(),
        userId,
        aiUsageId: v.aiUsageId ?? null,
        fileId: v.fileId ?? null,
        operation: v.operation,
        verdict: v.verdict,
        reason: v.reason ?? null,
        note: v.note ?? null,
        providerId: v.providerId ?? null,
        model: v.model ?? null,
      })
      .onDuplicateKeyUpdate({
        set: {
          verdict: v.verdict,
          reason: v.reason ?? null,
          note: v.note ?? null,
          // Refresh denormalized fields too — if the user runs the
          // same operation again with a different model and re-rates,
          // the latest row should reflect the latest provider/model.
          providerId: v.providerId ?? null,
          model: v.model ?? null,
          // Touch updated_at via DB-side ON UPDATE (no app value).
          // We DO need a SET that mentions a column, otherwise
          // Drizzle's ON DUPLICATE KEY UPDATE generates an empty
          // SET clause and MySQL throws.
          // Setting verdict = VALUES(verdict) implicitly works because
          // we're already setting verdict above, but we tag updated_at
          // explicitly here just to make the intent obvious.
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        },
      });

    return NextResponse.json({
      ok: true,
      verdict: v.verdict,
    });
  } catch (err) {
    console.error("[ai-feedback-persist-failed]", String(err));
    return NextResponse.json(
      { error: "persist_failed" },
      { status: 500 },
    );
  }
}
