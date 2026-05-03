"use server";

// Admin user-actions (plan §7 + §8 / Gap #5).
//
// Server actions for the /admin/users/[id] page. Two surfaces:
//
//   - adminGrantCredits — manual grant. Used for goodwill credits,
//     winning-back lapsed users, comping a customer who hit a bug, etc.
//     Writes a credit_ledger row with reason="manual_grant" and a
//     deterministic idempotency key so the same form re-submission is
//     a no-op.
//
//   - adminDebitCredits — manual debit. Used for clawing back credits
//     that an abuser collected (e.g. a flagged signup-bonus account
//     that verified, then admin reviewed and decided it was a bot).
//     Same ledger row, but with negative delta and reason="manual_debit".
//     Balance can't go below 0 — the helper clamps the debit to the
//     user's current balance.
//
// Why not "ban" in this batch
//   The plan §7 list mentions a ban affordance, but the schema doesn't
//   have a `users.banned_at` column today and adding it requires a new
//   migration + a sign-in middleware check + (per DPDP Act) a notice
//   email. That's a 2-hour design task, not a 30-minute action. Ship
//   grant/debit now (the highest-value bots-recovery tools); ban is
//   tracked as a follow-up.
//
// Auth contract
//   Every action calls requireAdmin() FIRST. The signed-in admin's
//   email is recorded on the ledger row's `note` field for audit
//   trail (we don't have a separate audit_log table; the note column
//   is the closest thing).
//
// Idempotency
//   The idempotency key is `admin_${grant|debit}:${targetUserId}:${ts}`
//   where ts is rounded to the second. Two clicks within the same
//   second collide; clicks 2+ seconds apart create two ledger rows.
//   That's the right semantic — admins occasionally legitimately want
//   to grant twice in a row, but spam-clicking shouldn't double-grant.

import "server-only";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { requireAdmin } from "@/lib/admin/guard";
import { grantCredits } from "@/lib/payments/ledger";
import { db, schema } from "@/db/client";

// ---------------- Shared types ----------------

export type AdminActionResult =
  | { ok: true; newBalance: number; delta: number }
  | { ok: false; error: string };

interface AdminActionInput {
  targetUserId: string;
  amount: number;
  note?: string;
}

// Cap a single admin grant or debit at this absolute value. Catches
// fat-finger errors (e.g. typing an extra digit). 1000 credits is
// roughly 25× the largest credit pack — generous, but bounded.
const MAX_ABS_AMOUNT = 1000;

function sanitizeAmount(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  const n = Math.floor(raw);
  if (n <= 0) return null;
  if (n > MAX_ABS_AMOUNT) return null;
  return n;
}

function sanitizeNote(raw: string | undefined, max = 256): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, max);
}

async function getCurrentBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: schema.credits.balance })
    .from(schema.credits)
    .where(eq(schema.credits.userId, userId))
    .limit(1);
  return row?.balance ?? 0;
}

// ---------------- Grant ----------------

export async function adminGrantCredits(
  input: AdminActionInput,
): Promise<AdminActionResult> {
  const admin = await requireAdmin(); // 404s if not admin

  const amount = sanitizeAmount(input.amount);
  if (amount === null) {
    return {
      ok: false,
      error: `Amount must be a positive integer between 1 and ${MAX_ABS_AMOUNT}.`,
    };
  }

  if (!input.targetUserId || typeof input.targetUserId !== "string") {
    return { ok: false, error: "Missing target user id." };
  }

  const note = sanitizeNote(input.note);
  // Stamp the admin email so the audit trail is grep-able.
  const adminNote = `[admin: ${admin.email}] ${note || "manual grant"}`;

  // Round timestamp to seconds for idempotency. Two clicks within the
  // same second collide; clicks 2+ seconds apart make two grants.
  const tsKey = Math.floor(Date.now() / 1000);
  const idempotencyKey = `admin_grant:${input.targetUserId}:${tsKey}`;

  try {
    const result = await grantCredits({
      userId: input.targetUserId,
      delta: amount,
      reason: "manual_grant",
      note: adminNote,
      idempotencyKey,
    });

    if (!result.applied) {
      return {
        ok: false,
        error:
          result.reason === "duplicate"
            ? "Duplicate grant — wait a second and retry, or check the ledger."
            : "Zero-delta — nothing to grant.",
      };
    }

    revalidatePath(`/admin/users/${input.targetUserId}`);
    return { ok: true, newBalance: result.newBalance, delta: amount };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "admin_grant_failed",
        admin: admin.email,
        targetUserId: input.targetUserId,
        amount,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    );
    return { ok: false, error: "Grant failed — see server logs." };
  }
}

// ---------------- Debit ----------------

export async function adminDebitCredits(
  input: AdminActionInput,
): Promise<AdminActionResult> {
  const admin = await requireAdmin(); // 404s if not admin

  const amount = sanitizeAmount(input.amount);
  if (amount === null) {
    return {
      ok: false,
      error: `Amount must be a positive integer between 1 and ${MAX_ABS_AMOUNT}.`,
    };
  }

  if (!input.targetUserId || typeof input.targetUserId !== "string") {
    return { ok: false, error: "Missing target user id." };
  }

  const note = sanitizeNote(input.note);
  const adminNote = `[admin: ${admin.email}] ${note || "manual debit"}`;

  // Clamp the debit to the user's current balance. We refuse to push
  // balance below 0 — that would create a "you owe credits" state the
  // ledger isn't designed to represent. If admin needs to do a larger
  // claw-back than the user's current balance, they should debit
  // exactly what's there now and re-debit later if more credits land.
  const currentBalance = await getCurrentBalance(input.targetUserId);
  const clampedAmount = Math.min(amount, currentBalance);

  if (clampedAmount === 0) {
    return {
      ok: false,
      error: `User has 0 credits — nothing to debit.`,
    };
  }

  const tsKey = Math.floor(Date.now() / 1000);
  const idempotencyKey = `admin_debit:${input.targetUserId}:${tsKey}`;

  try {
    const result = await grantCredits({
      userId: input.targetUserId,
      delta: -clampedAmount,
      reason: "manual_debit",
      note:
        clampedAmount < amount
          ? `${adminNote} (clamped: requested ${amount}, balance ${currentBalance})`
          : adminNote,
      idempotencyKey,
    });

    if (!result.applied) {
      return {
        ok: false,
        error:
          result.reason === "duplicate"
            ? "Duplicate debit — wait a second and retry, or check the ledger."
            : "Zero-delta — nothing to debit.",
      };
    }

    revalidatePath(`/admin/users/${input.targetUserId}`);
    return { ok: true, newBalance: result.newBalance, delta: -clampedAmount };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "admin_debit_failed",
        admin: admin.email,
        targetUserId: input.targetUserId,
        amount: clampedAmount,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    );
    return { ok: false, error: "Debit failed — see server logs." };
  }
}
