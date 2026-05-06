// lib/orgs/writers.ts — write-side helpers for the multi-seat
// foundation (PENDING §3b Phase F partial, 2026-05-05).
//
// Companion to lib/orgs/queries.ts (read-side) and lib/orgs/codes.ts
// (slugify + invite token). Sits beside the foundation shipped earlier
// this session (commit 2bef9e0).
//
// Three core writers
// ------------------
// 1. recordOrgCreate({ownerUserId, name, billingMode?})
//    Creates a new organization. Atomically inserts the org row +
//    the owner's organization_members row (role="owner") in a
//    transaction. Slug generated via slugify() with collision-retry.
//    All flag-gated — calls are no-op'd silently when MULTI_SEAT
//    is off.
//
// 2. inviteMember({organizationId, email, role, invitedByUserId,
//                  ttlDays?})
//    Generates an invite token + INSERTs into organization_invites.
//    If a pending invite already exists for (orgId, email), the
//    prior token is replaced (DELETE + re-INSERT in transaction)
//    rather than creating a duplicate row. Caller (the future
//    UI) is responsible for dispatching the email.
//
// 3. acceptInvite({token, userId})
//    Validates the token (lives + not expired + not already
//    accepted), INSERTs into organization_members with the role
//    from the invite, marks the invite acceptedAt. Atomic.
//
// What this module does NOT do (deferred Phase F-2)
// -------------------------------------------------
// - changeRole / transferOwnership writers. These have permission
//   semantics (only owner can transfer; only admin+ can change
//   member roles) that depend on UI input. Skipping them in this
//   foundation; the create + invite + accept loop is enough to
//   bootstrap a team.
// - Email dispatch on invite. Caller wires the SendGrid/Postmark
//   send after this writer succeeds. Depends on §11 transactional
//   email wiring.
// - Permission enforcement on tool routes (org members can only
//   see their org's resources). That's a routing-layer concern
//   that touches every API route — separate batch.
// - Billing wire-up: the billingMode column is reserved
//   ("central" | "per_seat" | "credit_pool") but nothing reads it
//   yet. credit_ledger plumbing comes with billing-mode
//   enforcement in a separate commit.

import { randomUUID } from "node:crypto";

import { db, schema } from "@/db/client";
import { and, eq, isNull } from "drizzle-orm";

import { isMultiSeatEnabled } from "./queries";
import {
  ORG_SLUG_MAX_LENGTH,
  generateInviteToken,
  slugify,
} from "./codes";

export class OrgWriteError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "DISABLED"
      | "EMPTY_REQUIRED"
      | "SLUG_GENERATION_FAILED"
      | "INVITE_NOT_FOUND"
      | "INVITE_EXPIRED"
      | "INVITE_ALREADY_ACCEPTED"
      | "ALREADY_MEMBER"
      | "DB_ERROR",
  ) {
    super(message);
    this.name = "OrgWriteError";
  }
}

// ---------------------------------------------------------------------------
// recordOrgCreate
// ---------------------------------------------------------------------------

export interface RecordOrgCreateInput {
  ownerUserId: string;
  name: string;
  /** Reserved for Phase F billing wire-up. Defaults to "central". */
  billingMode?: "central" | "per_seat" | "credit_pool";
}

export interface RecordOrgCreateResult {
  organizationId: string;
  slug: string;
}

/**
 * Default invite TTL — 7 days. Long enough for someone on a slow
 * email cadence to accept; short enough that a leaked token from
 * an old email isn't useful forever.
 */
export const ORG_INVITE_DEFAULT_TTL_DAYS = 7;

/**
 * Maximum slug-collision retries before throwing. At 31^7 namespace
 * the collision probability for `slugify(name)` to clash with a
 * real org is high only when many orgs share the same name root
 * ("Acme", "Acme Corp", "Acme Inc") — we suffix `-2`, `-3`, … on
 * collision. 16 retries means we'd suffix up to `-16` before
 * giving up; in practice ops would rename the org well before that.
 */
const MAX_SLUG_RETRIES = 16;

/**
 * Create a new organization. Atomic: inserts the org + the owner's
 * membership in a single transaction. If either fails, the whole
 * operation rolls back.
 *
 * Returns null when MULTI_SEAT is off, so callers can
 * unconditionally invoke this without branching:
 *
 *   const result = await recordOrgCreate({...});
 *   if (result) { ... }
 */
export async function recordOrgCreate(
  input: RecordOrgCreateInput,
): Promise<RecordOrgCreateResult | null> {
  if (!isMultiSeatEnabled()) {
    return null;
  }

  const ownerUserId = requireNonEmpty("ownerUserId", input.ownerUserId);
  const name = requireNonEmpty("name", input.name);
  const billingMode = input.billingMode ?? "central";

  const baseSlug = slugify(name);
  // Empty slug on names like "💩💩💩" — fall back to "org-<random>"
  // so we don't INSERT an empty-string slug.
  const seedSlug =
    baseSlug.length > 0 ? baseSlug : `org-${randomUUID().slice(0, 8)}`;

  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
    const slug =
      attempt === 0
        ? seedSlug.slice(0, ORG_SLUG_MAX_LENGTH)
        : `${seedSlug}-${attempt + 1}`.slice(0, ORG_SLUG_MAX_LENGTH);
    const organizationId = randomUUID();

    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.organizations).values({
          id: organizationId,
          name,
          slug,
          ownerUserId,
          billingMode,
        });
        await tx.insert(schema.organizationMembers).values({
          id: randomUUID(),
          organizationId,
          userId: ownerUserId,
          role: "owner",
        });
      });
      return { organizationId, slug };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // UNIQUE(slug) collision → retry with suffix
      if (
        message.includes("Duplicate entry") ||
        message.includes("ER_DUP_ENTRY")
      ) {
        // Determine which uniqueness collided. The slug is the most
        // likely; the (orgId, userId) member unique can't collide
        // because we just generated a fresh orgId. Continue the
        // loop to suffix the slug.
        continue;
      }
      throw new OrgWriteError(
        `Failed to create org: ${message}`,
        "DB_ERROR",
      );
    }
  }

  throw new OrgWriteError(
    `Slug-collision retry exhausted after ${MAX_SLUG_RETRIES} attempts (base='${baseSlug}')`,
    "SLUG_GENERATION_FAILED",
  );
}

// ---------------------------------------------------------------------------
// inviteMember
// ---------------------------------------------------------------------------

export interface InviteMemberInput {
  organizationId: string;
  email: string;
  role: "admin" | "member";
  invitedByUserId: string;
  /** Defaults to ORG_INVITE_DEFAULT_TTL_DAYS. */
  ttlDays?: number;
}

export interface InviteMemberResult {
  inviteId: string;
  token: string;
  expiresAt: Date;
  /** True if a prior pending invite was replaced (re-invite case). */
  replacedPrior: boolean;
}

/**
 * Generate + persist an invite. If a PENDING invite already exists
 * for (organizationId, email), the prior token is replaced with a
 * fresh one (DELETE + INSERT in transaction). This re-invite
 * pattern means the email link in the OLD invitation email goes
 * dead the moment we re-invite — important for security (the prior
 * email might be in the wrong inbox, on a stolen device, etc.).
 *
 * Caller (the future Phase F-2 invite UI) is responsible for
 * dispatching the email containing /invite/<token> after this
 * writer returns successfully.
 */
export async function inviteMember(
  input: InviteMemberInput,
): Promise<InviteMemberResult | null> {
  if (!isMultiSeatEnabled()) {
    return null;
  }

  const organizationId = requireNonEmpty(
    "organizationId",
    input.organizationId,
  );
  const email = requireNonEmpty("email", input.email).toLowerCase();
  const invitedByUserId = requireNonEmpty(
    "invitedByUserId",
    input.invitedByUserId,
  );
  const role = input.role;
  if (role !== "admin" && role !== "member") {
    throw new OrgWriteError(
      `role must be 'admin' or 'member' (got '${role}')`,
      "EMPTY_REQUIRED",
    );
  }

  const ttlDays = input.ttlDays ?? ORG_INVITE_DEFAULT_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  return await db.transaction(async (tx) => {
    // Check for existing pending invite. UNIQUE constraint isn't on
    // (org, email) — it's only on token — so we manually dedupe.
    const priorRows = await tx
      .select({ id: schema.organizationInvites.id })
      .from(schema.organizationInvites)
      .where(
        and(
          eq(schema.organizationInvites.organizationId, organizationId),
          eq(schema.organizationInvites.email, email),
          isNull(schema.organizationInvites.acceptedAt),
        ),
      );

    let replacedPrior = false;
    if (priorRows.length > 0) {
      // Delete every pending invite for this (org, email) — there
      // shouldn't be more than one in practice but defensive cleanup
      // covers any race that snuck duplicates in.
      for (const row of priorRows) {
        await tx
          .delete(schema.organizationInvites)
          .where(eq(schema.organizationInvites.id, row.id));
      }
      replacedPrior = true;
    }

    // Generate token + collision retry. At 36^32 namespace size
    // the collision probability is ~7e-49 — retry is theatrical.
    let token = "";
    let inviteId = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      token = generateInviteToken();
      inviteId = randomUUID();
      try {
        await tx.insert(schema.organizationInvites).values({
          id: inviteId,
          organizationId,
          email,
          token,
          invitedByUserId,
          role,
          expiresAt,
        });
        return { inviteId, token, expiresAt, replacedPrior };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes("Duplicate entry") ||
          message.includes("ER_DUP_ENTRY")
        ) {
          continue;
        }
        throw err;
      }
    }
    throw new OrgWriteError(
      "Failed to generate unique invite token after 8 attempts",
      "DB_ERROR",
    );
  });
}

// ---------------------------------------------------------------------------
// acceptInvite
// ---------------------------------------------------------------------------

export interface AcceptInviteInput {
  token: string;
  userId: string;
}

export interface AcceptInviteResult {
  organizationId: string;
  role: string;
}

/**
 * Accept an invite. Validates token → not expired → not already
 * accepted, then atomically inserts the member row + marks the
 * invite acceptedAt. Throws typed errors for each failure mode
 * so the (future) /invite/<token> UI can render the appropriate
 * "expired" / "already accepted" / "invalid" copy.
 *
 * Why we don't validate the email match
 *   The original audit flagged this — should we check that the
 *   accepting user's email matches the invite.email? In v1, no:
 *   if Alice forwards her invite to Bob and Bob accepts, that's
 *   Alice's choice. v2 could add an opt-in "lock invites to the
 *   email" toggle on per-org basis.
 */
export async function acceptInvite(
  input: AcceptInviteInput,
): Promise<AcceptInviteResult | null> {
  if (!isMultiSeatEnabled()) {
    return null;
  }

  const token = requireNonEmpty("token", input.token);
  const userId = requireNonEmpty("userId", input.userId);

  return await db.transaction(async (tx) => {
    const inviteRows = await tx
      .select()
      .from(schema.organizationInvites)
      .where(eq(schema.organizationInvites.token, token))
      .limit(1);

    if (inviteRows.length === 0) {
      throw new OrgWriteError(
        "Invite not found",
        "INVITE_NOT_FOUND",
      );
    }
    const invite = inviteRows[0]!;

    if (invite.acceptedAt !== null) {
      throw new OrgWriteError(
        "Invite already accepted",
        "INVITE_ALREADY_ACCEPTED",
      );
    }

    if (invite.expiresAt < new Date()) {
      throw new OrgWriteError(
        "Invite expired",
        "INVITE_EXPIRED",
      );
    }

    // Check if the user is already a member (e.g. they accepted a
    // prior invite, then got a re-invite, then click both). Surface
    // ALREADY_MEMBER rather than throwing on the UNIQUE.
    const memberRows = await tx
      .select({ id: schema.organizationMembers.id })
      .from(schema.organizationMembers)
      .where(
        and(
          eq(
            schema.organizationMembers.organizationId,
            invite.organizationId,
          ),
          eq(schema.organizationMembers.userId, userId),
        ),
      )
      .limit(1);

    if (memberRows.length > 0) {
      // Mark the invite as accepted anyway (the user IS a member,
      // just from a different invite path) so it doesn't hang
      // around as "pending" forever.
      await tx
        .update(schema.organizationInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.organizationInvites.id, invite.id));
      throw new OrgWriteError(
        "User is already a member of this organization",
        "ALREADY_MEMBER",
      );
    }

    // Insert the membership + mark the invite accepted.
    await tx.insert(schema.organizationMembers).values({
      id: randomUUID(),
      organizationId: invite.organizationId,
      userId,
      role: invite.role,
    });
    await tx
      .update(schema.organizationInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.organizationInvites.id, invite.id));

    return { organizationId: invite.organizationId, role: invite.role };
  });
}

// ---------------------------------------------------------------------------
// shared validation
// ---------------------------------------------------------------------------

function requireNonEmpty(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OrgWriteError(`${name} is required`, "EMPTY_REQUIRED");
  }
  return value.trim();
}
