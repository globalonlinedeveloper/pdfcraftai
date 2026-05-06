// Client form for inviting a new member to an org. Posts to a
// Server Action that wraps lib/orgs/writers.ts:inviteMember.

"use client";

import { useState, useTransition } from "react";

import { inviteMemberAction } from "./actions";

interface Props {
  orgId: string;
  orgSlug: string;
}

export function InviteMemberForm({ orgId, orgSlug }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    inviteUrl: string;
    replacedPrior: boolean;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await inviteMemberAction({ orgId, email, role });
      if (result.ok) {
        const inviteUrl = `${window.location.origin}/invite/${result.token}`;
        setSuccess({
          inviteUrl,
          replacedPrior: result.replacedPrior,
        });
        setEmail("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: 8,
          alignItems: "stretch",
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          required
          maxLength={255}
          disabled={pending}
          style={{
            padding: "8px 10px",
            fontSize: 13,
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--fg)",
          }}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "member")}
          disabled={pending}
          style={{
            padding: "8px 10px",
            fontSize: 13,
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--fg)",
          }}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || email.trim().length === 0}
        >
          {pending ? "Inviting…" : "Invite"}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "8px 12px",
            fontSize: 12,
            borderRadius: 4,
            border: "1px solid #c00",
            background: "color-mix(in oklab, #c00 6%, transparent)",
            color: "#c00",
          }}
        >
          {error}
        </div>
      ) : null}

      {success ? (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 4,
            border: "1px solid #4caf50",
            background: "color-mix(in oklab, #4caf50 6%, transparent)",
            fontSize: 13,
          }}
        >
          <div style={{ marginBottom: 6, color: "#4caf50", fontWeight: 600 }}>
            ✓ Invite{" "}
            {success.replacedPrior ? "re-sent (prior link revoked)" : "created"}
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Copy this link and send it to the recipient. It expires in
            7 days.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <code
              style={{
                flex: 1,
                padding: "6px 8px",
                background: "var(--bg-2)",
                borderRadius: 4,
                fontSize: 11,
                wordBreak: "break-all",
              }}
            >
              {success.inviteUrl}
            </code>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() =>
                navigator.clipboard.writeText(success.inviteUrl).catch(() => {
                  alert("Couldn't copy. Select the link and Cmd-C / Ctrl-C.");
                })
              }
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
