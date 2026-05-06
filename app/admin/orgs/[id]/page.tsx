// app/admin/orgs/[id]/page.tsx — Per-org admin drill-down (Phase F-4
// observability, 2026-05-06).
//
// Shows ops the full state of an org: header (name + slug + owner +
// billing mode + created), member directory with email + role +
// last-30d usage, pending invites with email + role + created, and
// total-org-usage stats.
//
// Differs from /app/org/<slug> in three ways:
//   1. Admin gate (requireAdmin) — only platform admins reach this
//   2. Routes by org id (stable across renames) — slug is the user-
//      facing URL identifier and could theoretically change in a
//      future migration
//   3. Read-only — no Manage / Invite / Settings affordances. Admins
//      drill in to debug or audit, not to act on the org's behalf
//      (acting on the org would require impersonation which we
//      don't do; admins click through to /app/org/<slug> if they
//      need the user-facing UI in the org owner's seat).

import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/admin/guard";
import {
  loadOrgById,
  loadOrgInvites,
  loadOrgMemberUsage,
  loadOrgMembersWithUsers,
} from "@/lib/orgs/queries";
import { formatUtcDate, formatUtcDateTime } from "@/lib/admin/format";
import { SectionTitle, Td, Th, tableStyle } from "@/components/admin/ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Params {
  id: string;
}

function memberLabel(m: {
  email: string | null;
  name: string | null;
  userId: string;
}): string {
  if (m.email && m.email.length > 0) return m.email;
  if (m.name && m.name.length > 0) return m.name;
  return m.userId.length > 16
    ? `${m.userId.slice(0, 8)}…${m.userId.slice(-4)}`
    : m.userId;
}

export default async function AdminOrgDetailPage({
  params,
}: {
  params: Params;
}) {
  await requireAdmin();

  const org = await loadOrgById(params.id);
  if (!org) notFound();

  const [members, pendingInvites, memberUsage] = await Promise.all([
    loadOrgMembersWithUsers(org.id),
    loadOrgInvites(org.id, { includeAccepted: false }),
    loadOrgMemberUsage(org.id, 30),
  ]);

  const usageByUserId = new Map(memberUsage.map((u) => [u.userId, u]));
  const totalCalls = memberUsage.reduce((acc, u) => acc + u.calls, 0);
  const totalCredits = memberUsage.reduce(
    (acc, u) => acc + u.creditsSpent,
    0,
  );

  const ownerMember = members.find((m) => m.userId === org.ownerUserId);
  const ownerLabel = ownerMember ? memberLabel(ownerMember) : org.ownerUserId;

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>
          {org.name}
        </h1>
        <p className="muted" style={{ marginTop: 4 }}>
          <code style={{ fontSize: 12 }}>{org.slug}</code> · created{" "}
          {formatUtcDate(org.createdAt)} · billing mode{" "}
          <code style={{ fontSize: 12 }}>{org.billingMode}</code> · owner{" "}
          <strong>{ownerLabel}</strong> · org id{" "}
          <code style={{ fontSize: 11 }}>{org.id}</code>
        </p>
        <p style={{ marginTop: 8, fontSize: 13 }}>
          <Link
            href={`/app/org/${org.slug}`}
            style={{ color: "var(--accent)" }}
          >
            View as user →
          </Link>{" "}
          <span className="muted">
            (you&rsquo;ll see the org-landing in your own seat — your
            membership/role determines what you can do there)
          </span>
        </p>
      </header>

      {/* Aggregate usage stats */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div className="card" style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            MEMBERS
          </div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>
            {members.length}
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            CALLS (30d)
          </div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>
            {totalCalls.toLocaleString()}
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            CREDITS (30d)
          </div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>
            {totalCredits.toLocaleString()}
          </div>
        </div>
      </section>

      {/* Member directory + per-member 30d usage */}
      <section style={{ marginBottom: 24 }}>
        <SectionTitle>Members ({members.length})</SectionTitle>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Joined</Th>
                <Th align="right">Calls (30d)</Th>
                <Th align="right">Credits (30d)</Th>
                <Th>Drill-in</Th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const u = usageByUserId.get(m.userId);
                return (
                  <tr key={m.id}>
                    <Td>
                      <div>{memberLabel(m)}</div>
                      {m.name && m.email && m.name !== m.email ? (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {m.name}
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: 0.4,
                          textTransform: "uppercase",
                          color:
                            m.role === "owner"
                              ? "#4caf50"
                              : m.role === "admin"
                              ? "var(--accent)"
                              : "var(--fg-subtle)",
                        }}
                      >
                        {m.role}
                      </span>
                    </Td>
                    <Td>{formatUtcDate(m.joinedAt)}</Td>
                    <Td align="right">
                      <code style={{ fontSize: 12 }}>
                        {(u?.calls ?? 0).toLocaleString()}
                      </code>
                    </Td>
                    <Td align="right">
                      <code style={{ fontSize: 12 }}>
                        {(u?.creditsSpent ?? 0).toLocaleString()}
                      </code>
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/users/${m.userId}`}
                        style={{
                          color: "var(--accent)",
                          fontSize: 12,
                        }}
                      >
                        view user →
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending invites — full table for admin audit */}
      <section>
        <SectionTitle>Pending invites ({pendingInvites.length})</SectionTitle>
        {pendingInvites.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No outstanding invites.
          </p>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Invited by</Th>
                  <Th>Created</Th>
                  <Th>Expires</Th>
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((inv) => (
                  <tr key={inv.id}>
                    <Td>{inv.email}</Td>
                    <Td>
                      <code style={{ fontSize: 11 }}>{inv.role}</code>
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/users/${inv.invitedByUserId}`}
                        style={{
                          color: "var(--accent)",
                          fontSize: 12,
                        }}
                      >
                        {inv.invitedByUserId.length > 16
                          ? `${inv.invitedByUserId.slice(
                              0,
                              8,
                            )}…${inv.invitedByUserId.slice(-4)}`
                          : inv.invitedByUserId}
                      </Link>
                    </Td>
                    <Td>{formatUtcDateTime(inv.createdAt)}</Td>
                    <Td>{formatUtcDate(inv.expiresAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div style={{ marginTop: 24 }}>
        <Link
          href="/admin/orgs"
          className="muted"
          style={{ fontSize: 13 }}
        >
          ← Back to all organizations
        </Link>
      </div>
    </div>
  );
}
