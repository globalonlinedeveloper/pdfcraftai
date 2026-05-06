// app/invite/[token]/page.tsx — Accept-invite landing (PENDING §3b
// Phase F-2 partial, 2026-05-05).
//
// Pairs with `lib/orgs/writers.ts:acceptInvite`. When someone clicks
// the invite link from their email (`/invite/<token>`), they land
// here. Three paths:
//
//   1. Not signed in → redirect to /login?callbackUrl=/invite/<token>
//      so they sign in (or create an account) and come right back.
//   2. Signed in + valid invite + not yet a member → call acceptInvite
//      (which atomically creates the membership + marks the invite
//      acceptedAt) → redirect to /app/dashboard with a "you joined
//      <org>" toast.
//   3. Signed in + invite invalid/expired/already-accepted/already-
//      a-member → render appropriate messaging, NO write attempted.
//
// We render the page as a Server Component that performs the writes
// directly (rather than a form-POST flow). The token in the URL IS
// the action — no additional intent needed. Same UX pattern as
// /verify-email and /reset-password.
//
// What this page does NOT do
// --------------------------
// - Match the accepting user's email against `invite.email`. v1
//   accepts whoever clicks the link (Alice forwarding to Bob is
//   Alice's choice). v2 could add per-org "lock invites to email"
//   toggle.
// - Show org details before accepting. The token is the action; if
//   they don't trust it they shouldn't have clicked. Future
//   enhancement: show org name + inviter name + member count
//   before the auto-accept.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  acceptInvite,
  OrgWriteError,
} from "@/lib/orgs/writers";
import { lookupInvite } from "@/lib/orgs/queries";

export const metadata: Metadata = {
  title: "Accept invitation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Params {
  token: string;
}

export default async function AcceptInvitePage({
  params,
}: {
  params: Params;
}) {
  const token = String(params.token ?? "");

  // -- 1. Auth gate ---------------------------------------------------
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (typeof userId !== "string" || userId.length === 0) {
    // Round-trip preservation: send them to /login with the full
    // /invite/<token> URL as callbackUrl so they land back here
    // post-signin and the auto-accept runs.
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`,
    );
  }

  // -- 2. Pre-check: is the invite even valid? ------------------------
  // We do a read-only lookupInvite() FIRST so we can render a
  // graceful "invite expired" / "invite not found" page instead of
  // throwing. acceptInvite would also catch these, but doing the
  // check up front lets us avoid a useless transaction.
  const invitePreview = await lookupInvite(token);

  // -- 3. Attempt the write -------------------------------------------
  let outcome:
    | { kind: "joined"; organizationId: string; role: string }
    | { kind: "already_member" }
    | { kind: "invalid"; reason: string }
    | { kind: "expired" }
    | { kind: "already_accepted" }
    | { kind: "disabled" };

  if (!invitePreview) {
    // Could be: token typo, token never existed, OR the invite
    // expired (lookupInvite returns null on expired too). We
    // distinguish via a fresh write attempt — acceptInvite throws
    // INVITE_NOT_FOUND vs INVITE_EXPIRED with different codes.
    // Since lookupInvite already filtered both into null, we
    // surface a generic "invalid or expired" message here.
    outcome = {
      kind: "invalid",
      reason: "This invitation link is invalid or has expired.",
    };
  } else {
    try {
      const result = await acceptInvite({ token, userId });
      if (result === null) {
        // MULTI_SEAT flag is off — Phase F-2 can't yet ship to
        // users. Honest copy.
        outcome = { kind: "disabled" };
      } else {
        outcome = {
          kind: "joined",
          organizationId: result.organizationId,
          role: result.role,
        };
      }
    } catch (err) {
      if (err instanceof OrgWriteError) {
        if (err.code === "INVITE_EXPIRED") {
          outcome = { kind: "expired" };
        } else if (err.code === "INVITE_ALREADY_ACCEPTED") {
          outcome = { kind: "already_accepted" };
        } else if (err.code === "ALREADY_MEMBER") {
          outcome = { kind: "already_member" };
        } else if (err.code === "INVITE_NOT_FOUND") {
          outcome = { kind: "invalid", reason: "Invitation not found." };
        } else {
          outcome = {
            kind: "invalid",
            reason: `Couldn't accept invitation: ${err.code}`,
          };
        }
      } else {
        // Unknown error — log + surface a generic message rather
        // than 500'ing the page. The user can try the link again.
        console.error("[invite] acceptInvite threw:", err);
        outcome = {
          kind: "invalid",
          reason: "Something went wrong on our side. Try the link again in a moment.",
        };
      }
    }
  }

  return (
    <main
      className="container-x"
      style={{
        padding: "120px 28px",
        textAlign: "center",
        maxWidth: 540,
        margin: "0 auto",
      }}
    >
      {outcome.kind === "joined" ? (
        <>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            JOINED
          </div>
          <h1 style={{ fontSize: 32, marginBottom: 12 }}>
            Welcome to the team
          </h1>
          <p
            className="muted"
            style={{ fontSize: 16, marginBottom: 24, lineHeight: 1.6 }}
          >
            You&rsquo;ve been added to the organization as a{" "}
            <strong>{outcome.role}</strong>. Head to your dashboard to
            see shared resources.
          </p>
          <Link href="/app/dashboard" className="btn btn-lg btn-primary">
            Go to dashboard
          </Link>
        </>
      ) : outcome.kind === "already_member" ? (
        <>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>
            You&rsquo;re already a member
          </h1>
          <p className="muted" style={{ fontSize: 15, marginBottom: 24 }}>
            You&rsquo;ve already joined this organization via a different
            invite. No action needed.
          </p>
          <Link href="/app/dashboard" className="btn btn-lg btn-primary">
            Go to dashboard
          </Link>
        </>
      ) : outcome.kind === "expired" ? (
        <>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>
            Invitation expired
          </h1>
          <p className="muted" style={{ fontSize: 15, marginBottom: 24 }}>
            This invite is past its expiration date. Ask whoever invited
            you to send a fresh one.
          </p>
          <Link href="/" className="btn btn-lg btn-outline">
            Back home
          </Link>
        </>
      ) : outcome.kind === "already_accepted" ? (
        <>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>
            Invitation already used
          </h1>
          <p className="muted" style={{ fontSize: 15, marginBottom: 24 }}>
            This invite link has already been used. If that wasn&rsquo;t
            you, contact whoever sent it.
          </p>
          <Link href="/app/dashboard" className="btn btn-lg btn-outline">
            Go to dashboard
          </Link>
        </>
      ) : outcome.kind === "disabled" ? (
        <>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>
            Team plan not yet available
          </h1>
          <p className="muted" style={{ fontSize: 15, marginBottom: 24 }}>
            We&rsquo;re still rolling out the team plan. Your invite will
            work once we go live; check back in a few days.
          </p>
          <Link href="/" className="btn btn-lg btn-outline">
            Back home
          </Link>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>
            Couldn&rsquo;t accept invitation
          </h1>
          <p className="muted" style={{ fontSize: 15, marginBottom: 24 }}>
            {outcome.reason}
          </p>
          <Link href="/" className="btn btn-lg btn-outline">
            Back home
          </Link>
        </>
      )}
    </main>
  );
}
