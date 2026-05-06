// Server Actions for /app/org/[slug]. Permission-gated wrapper
// around lib/orgs/writers.ts:inviteMember.
//
// Permission model: only owners + admins can invite members.
// Pinned via canManageMembers() — same helper /app/org/[slug]/page.tsx
// uses to decide whether to RENDER the invite form. Belt + braces:
// even if a malicious admin client somehow renders the form, the
// server action re-checks before writing.

"use server";

import { auth } from "@/auth";
import { canManageMembers } from "@/lib/orgs/queries";
import { OrgWriteError, inviteMember } from "@/lib/orgs/writers";

export interface InviteMemberActionInput {
  orgId: string;
  email: string;
  role: "admin" | "member";
}

export type InviteMemberActionResult =
  | { ok: true; token: string; expiresAt: Date; replacedPrior: boolean }
  | { ok: false; error: string };

export async function inviteMemberAction(
  input: InviteMemberActionInput,
): Promise<InviteMemberActionResult> {
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (typeof userId !== "string") {
    return { ok: false, error: "You need to be signed in." };
  }

  // Permission re-check at write time (in addition to the page-
  // render-time hide of the form). Anyone hitting this action
  // who isn't an owner/admin gets a generic 403-equivalent —
  // we don't say "you're not an admin" specifically because that
  // leaks role info.
  const canManage = await canManageMembers(input.orgId, userId);
  if (!canManage) {
    return {
      ok: false,
      error: "You don't have permission to invite members in this organization.",
    };
  }

  const email = (input.email ?? "").trim();
  if (email.length === 0) {
    return { ok: false, error: "Email is required." };
  }
  // Cheap email-shape check. Not RFC 5322; just "looks like an
  // email" to catch typos. The writer doesn't validate format.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That doesn't look like a valid email address." };
  }
  if (input.role !== "admin" && input.role !== "member") {
    return { ok: false, error: "Invalid role." };
  }

  try {
    const result = await inviteMember({
      organizationId: input.orgId,
      email,
      role: input.role,
      invitedByUserId: userId,
    });
    if (result === null) {
      // MULTI_SEAT flag is off. Honest copy.
      return {
        ok: false,
        error: "Inviting members isn't available on your account yet.",
      };
    }
    return {
      ok: true,
      token: result.token,
      expiresAt: result.expiresAt,
      replacedPrior: result.replacedPrior,
    };
  } catch (err) {
    if (err instanceof OrgWriteError) {
      return {
        ok: false,
        error: `Couldn't send invite: ${err.message}`,
      };
    }
    console.error("[inviteMemberAction] unexpected error:", err);
    return {
      ok: false,
      error: "Something went wrong on our side. Try again.",
    };
  }
}
