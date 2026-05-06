// app/app/org/[slug]/settings/page.tsx — Org settings (Phase F-4
// follow-on, 2026-05-06).
//
// Owner-only surface for renaming + deleting the org. Hidden from
// non-owners by:
//   1. Render-time gate: getMemberRole === "owner" → notFound() else
//      (notFound() rather than 403 — same anti-existence-leak stance
//      as the org-landing page; we don't tell admins/members that
//      the settings page exists they just can't reach it).
//   2. Server Actions (separate file) re-check ownership before
//      writing (defense-in-depth — a stale tab from before a
//      transferOwnership shouldn't be able to keep mutating).
//
// Why notFound() not forbidden() for non-owners
// ---------------------------------------------
// On the org-landing page, members + admins SHOULD see the page (just
// without the manage-UI). But on the SETTINGS page, only owner has
// any business there at all — so routing them away with 404 keeps the
// surface simple. Admins land on the org page where their actions
// live anyway.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  getMemberRole,
  isMultiSeatEnabled,
  loadOrgBySlug,
  loadOrgMembers,
} from "@/lib/orgs/queries";
import { DeleteOrgForm } from "./DeleteOrgForm";
import { RenameOrgForm } from "./RenameOrgForm";

export const metadata: Metadata = {
  title: "Organization settings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Params {
  slug: string;
}

export default async function OrgSettingsPage({
  params,
}: {
  params: Params;
}) {
  const slug = String(params.slug ?? "");

  // 1. Auth gate
  const session = await auth();
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : undefined;
  if (typeof userId !== "string") {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(
        `/app/org/${slug}/settings`,
      )}`,
    );
  }

  // 2. Resolve slug → org
  const org = await loadOrgBySlug(slug);
  if (!org) notFound();

  // 3. Owner-only gate. notFound() not forbidden() (anti-existence-leak).
  const role = await getMemberRole(org.id, userId);
  if (role !== "owner") notFound();

  const enabled = isMultiSeatEnabled(userId);

  // Member count — used by the Details block below. Cheap query
  // (small table, indexed on organization_id). Owners need this
  // for support emails ("we have 8 seats"); it's always-relevant
  // metadata for any settings/lifecycle action.
  const members = await loadOrgMembers(org.id);
  const memberCount = members.length;

  // Human-readable description of the billing mode. The 3 values
  // ("central"|"per_seat"|"credit_pool") are placeholders today —
  // the credit_ledger doesn't yet route by mode (Phase F-4 billing
  // wire-up). Surfacing the mode + the honest "not yet enforced"
  // copy here so owners aren't surprised if their per-seat org
  // still bills against their personal balance.
  const billingModeLabel: Record<string, string> = {
    central: "Central — owner pays, members consume from a shared pool",
    per_seat: "Per seat — each member has their own pool",
    credit_pool: "Shared pool — pooled balance with per-member tracking",
  };
  const billingModeDescription =
    billingModeLabel[org.billingMode] ?? org.billingMode;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 720,
      }}
    >
      <header>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          ORGANIZATION SETTINGS
        </div>
        <h1 style={{ fontSize: 24, letterSpacing: "-0.02em", margin: 0 }}>
          {org.name}
        </h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          <code style={{ fontSize: 12 }}>{org.slug}</code> · You are the
          owner
        </p>
      </header>

      {!enabled ? (
        <div
          role="status"
          className="card"
          style={{
            padding: "10px 14px",
            borderColor: "#f57c00",
            background: "color-mix(in oklab, #f57c00 8%, transparent)",
            fontSize: 13,
            color: "#f57c00",
          }}
        >
          <strong>Beta:</strong> the team plan is staged but not yet
          live for users. Settings actions are real, but the create-org
          flow is not yet exposed publicly.
        </div>
      ) : null}

      {/* Details — read-only metadata. Owners need this for
          support emails, accounting reconciliation, and to
          confirm the billing mode they're on. */}
      <section className="card" style={{ padding: 20 }}>
        <h2
          style={{
            fontSize: 16,
            margin: "0 0 12px",
            fontWeight: 700,
          }}
        >
          Details
        </h2>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            gap: "8px 16px",
            margin: 0,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <dt className="muted">Organization id</dt>
          <dd style={{ margin: 0 }}>
            <code style={{ fontSize: 12 }}>{org.id}</code>
          </dd>

          <dt className="muted">URL slug</dt>
          <dd style={{ margin: 0 }}>
            <code style={{ fontSize: 12 }}>/{org.slug}</code>
          </dd>

          <dt className="muted">Created</dt>
          <dd style={{ margin: 0 }}>
            {org.createdAt.toISOString().slice(0, 10)}
          </dd>

          <dt className="muted">Members</dt>
          <dd style={{ margin: 0 }}>
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </dd>

          <dt className="muted">Billing mode</dt>
          <dd style={{ margin: 0 }}>
            <code style={{ fontSize: 12 }}>{org.billingMode}</code>
            <span
              className="muted"
              style={{ fontSize: 12, marginLeft: 8 }}
            >
              — {billingModeDescription}
            </span>
            <p
              className="muted"
              style={{
                fontSize: 11,
                marginTop: 6,
                lineHeight: 1.4,
                fontStyle: "italic",
              }}
            >
              Note: today the billing mode is a metadata column;
              credit_ledger routing against the org&rsquo;s payment
              method is Phase F-4 follow-on work. Members in any
              billing mode currently bill against their own
              balance.
            </p>
          </dd>
        </dl>
      </section>

      {/* Rename */}
      <section className="card" style={{ padding: 20 }}>
        <h2
          style={{
            fontSize: 16,
            margin: "0 0 4px",
            fontWeight: 700,
          }}
        >
          Rename organization
        </h2>
        <p
          className="muted"
          style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}
        >
          Updates the display name. The URL slug{" "}
          <code style={{ fontSize: 11 }}>/{org.slug}</code> stays the
          same so existing bookmarks and shared links keep working.
        </p>
        <RenameOrgForm
          orgId={org.id}
          currentName={org.name}
          slug={org.slug}
        />
      </section>

      {/* Delete — danger zone */}
      <section
        className="card"
        style={{
          padding: 20,
          borderColor: "#c00",
          background: "color-mix(in oklab, #c00 4%, transparent)",
        }}
      >
        <h2
          style={{
            fontSize: 16,
            margin: "0 0 4px",
            fontWeight: 700,
            color: "#c00",
          }}
        >
          Danger zone — delete organization
        </h2>
        <p
          className="muted"
          style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}
        >
          Permanently delete this organization. All members + pending
          invites are removed. Personal usage history (your AI calls,
          credits, files) stays on each member&rsquo;s account — only
          the org-level resources are deleted. <strong>This cannot be
          undone.</strong>
        </p>
        <DeleteOrgForm orgId={org.id} orgName={org.name} />
      </section>

      {/* Back link */}
      <div>
        <Link
          href={`/app/org/${org.slug}`}
          className="muted"
          style={{ fontSize: 13 }}
        >
          ← Back to organization
        </Link>
      </div>
    </div>
  );
}
