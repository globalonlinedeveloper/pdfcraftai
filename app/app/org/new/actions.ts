// Server Actions for /app/org/new. Wraps lib/orgs/writers.ts so the
// client form can submit without an explicit /api route. Server
// Actions can call DB writers directly + access the auth session.

"use server";

import { auth } from "@/auth";
import { recordOrgCreate, OrgWriteError } from "@/lib/orgs/writers";

export interface CreateOrgActionInput {
  name: string;
  billingMode: "central" | "per_seat" | "credit_pool";
}

export type CreateOrgActionResult =
  | { ok: true; organizationId: string; slug: string }
  | { ok: false; error: string };

/**
 * Server Action that wraps recordOrgCreate. Returns a discriminated
 * union the form can render directly.
 *
 * Auth: takes ownerUserId from session, NOT from the action input
 * (load-bearing — same anti-impersonation pattern as /api/admin/evals/grade).
 */
export async function createOrgAction(
  input: CreateOrgActionInput,
): Promise<CreateOrgActionResult> {
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (typeof userId !== "string") {
    return { ok: false, error: "You need to be signed in to create an organization." };
  }

  const name = (input.name ?? "").trim();
  if (name.length === 0) {
    return { ok: false, error: "Organization name is required." };
  }
  if (name.length > 255) {
    return {
      ok: false,
      error: "Organization name must be 255 characters or less.",
    };
  }

  try {
    const result = await recordOrgCreate({
      ownerUserId: userId,
      name,
      billingMode: input.billingMode,
    });
    if (result === null) {
      // MULTI_SEAT flag is off. Honest copy.
      return {
        ok: false,
        error:
          "The team plan isn't available on your account yet. We're rolling it out — try again in a few days.",
      };
    }
    return {
      ok: true,
      organizationId: result.organizationId,
      slug: result.slug,
    };
  } catch (err) {
    if (err instanceof OrgWriteError) {
      if (err.code === "SLUG_GENERATION_FAILED") {
        return {
          ok: false,
          error:
            "We couldn't generate a unique URL slug. Try a different organization name.",
        };
      }
      if (err.code === "EMPTY_REQUIRED") {
        return { ok: false, error: err.message };
      }
      return {
        ok: false,
        error: "Something went wrong creating the organization. Try again in a moment.",
      };
    }
    console.error("[createOrgAction] unexpected error:", err);
    return {
      ok: false,
      error: "Something went wrong on our side. Try again.",
    };
  }
}
