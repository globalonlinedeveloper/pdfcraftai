// /api/ai/estimate — pre-flight credit cost calculator (plan §5, Day 2).
//
// Why this exists:
//   The pre-flight estimator is the user-facing antidote to the
//   "what does this actually cost?" trust break that hardcoded
//   credit-number badges create. Day 1 stripped those badges.
//   This endpoint is what fills the gap.
//
// Life of a request:
//   1. auth() → 401 if anonymous (same gate as run endpoints).
//   2. parse JSON body → { op, pageCount?, charCount? }.
//   3. validate `op` is a known AI op → 400 if unknown.
//   4. read user's current credit balance (one indexed PK lookup).
//   5. estimateCredits() — pure function, no I/O.
//   6. respond { credits, balance } — credits-only display.
//
// Critical UX promise: the number this endpoint returns IS the
// number the user will be charged when they click Run. Day 1.7 wires
// translate/redact/sign route handlers to call estimateCredits() at
// spend time, eliminating any drift between estimate and live.
//
// We deliberately do NOT include the multiplier in the user-facing
// response — surfacing "12 chunks × 5 = 60 credits" leaks the
// chunking implementation. The estimator returns flat `credits`;
// admin diagnostics see the multiplier via /admin/users/[id].
//
// Rate limiting: this endpoint runs the chunker estimate (a divide
// and a ceil — basically free) and a single indexed DB read. The
// guardAiRoute() ceiling doesn't apply because no actual provider
// work happens. We add a simple in-memory token bucket sized so a
// pathological client cannot DoS us by spamming /estimate (30
// requests/user/min). Process-local so it resets on deploy — fine
// for our single-process Node runtime.

import "server-only";

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db/client";
import {
  estimateCredits,
  type EstimateInput,
} from "@/lib/ai/estimate";
import {
  AI_OPERATION_COSTS,
  type AIOperationId,
} from "@/lib/pricing";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const KNOWN_OPS = new Set(Object.keys(AI_OPERATION_COSTS) as AIOperationId[]);

function isKnownOp(op: unknown): op is AIOperationId {
  return typeof op === "string" && KNOWN_OPS.has(op as AIOperationId);
}

// Token bucket per user: 30 estimates/min. Keyed by userId. Process-
// local — survives concurrent requests on the same node, resets on
// restart. Good enough at our scale.
const buckets = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

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

export async function POST(req: NextRequest): Promise<Response> {
  // -- 1. auth -------------------------------------------------------
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (!userId) {
    return json(401, { error: "auth_required" });
  }

  // -- 2. rate limit --------------------------------------------------
  if (!consume(userId)) {
    return json(429, {
      error: "rate_limited",
      detail: "Too many estimates. Wait a moment and retry.",
    });
  }

  // -- 3. parse + validate -------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  if (!body || typeof body !== "object") {
    return json(400, { error: "invalid_body" });
  }
  const { op, pageCount, charCount } = body as Record<string, unknown>;

  if (!isKnownOp(op)) {
    return json(400, {
      error: "invalid_op",
      detail: `Unknown op. Valid: ${[...KNOWN_OPS].join(", ")}`,
    });
  }

  const input: EstimateInput = {};
  if (typeof pageCount === "number" && Number.isFinite(pageCount) && pageCount > 0) {
    input.pageCount = pageCount;
  }
  if (typeof charCount === "number" && Number.isFinite(charCount) && charCount > 0) {
    input.charCount = charCount;
  }

  // -- 4. read balance + compute estimate ----------------------------
  const [row] = await db
    .select({ balance: schema.credits.balance })
    .from(schema.credits)
    .where(eq(schema.credits.userId, userId))
    .limit(1);
  const balance = row?.balance ?? 0;

  const est = estimateCredits(op, input);

  // -- 5. respond ----------------------------------------------------
  // Credits-only payload. Multiplier is intentionally omitted from
  // the user-visible response to avoid leaking chunking detail
  // (principle 2: hide the supply chain). Admin can see the multiplier
  // via /admin/users/[id] activity log.
  return json(200, {
    credits: est.credits,
    balance,
    canRun: balance >= est.credits,
  });
}
