// MemberActions — per-member-row management buttons (Phase F-4,
// 2026-05-05).
//
// Renders inline next to each member row. Visibility is computed
// client-side from the actor's role (passed via props) using the
// same rank semantics the server-side writer enforces. The server
// ALSO re-checks permissions (defense-in-depth — see
// app/app/org/[slug]/actions.ts), so even a hostile client that
// renders the buttons can't bypass the writer's strict-outrank +
// authority-to-grant predicates.
//
// Buttons rendered:
//   - "Make admin" / "Make member" — only when actor strictly
//     outranks target AND has authority to grant the new role.
//   - "Remove" — only when actor strictly outranks target. (Owner
//     can't be removed; UI hides the button when target.role ===
//     'owner', writer also rejects.)
//   - "Transfer ownership →" — only when actor.role === 'owner' AND
//     target.role !== 'owner'.
//   - "Leave organization" — only when target === actor AND
//     actor.role !== 'owner' (owner must transfer first).
//
// All actions go through router.refresh() on success so the page
// re-renders with the updated member directory.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  changeRoleAction,
  removeMemberAction,
  transferOwnershipAction,
} from "./actions";

// Role-rank lookup — mirrors lib/orgs/writers.ts:ROLE_RANK so
// client-side hides match server-side rejects. Pinned by CI.
const RANK: Record<string, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};
function rankOf(role: string): number {
  return RANK[role] ?? 0;
}

interface Props {
  orgId: string;
  /** The actor (current viewer). */
  actorUserId: string;
  actorRole: string;
  /** The target (the member this row belongs to). */
  targetUserId: string;
  targetRole: string;
}

export function MemberActions({
  orgId,
  actorUserId,
  actorRole,
  targetUserId,
  targetRole,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "role" | "remove" | "transfer">(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isSelf = actorUserId === targetUserId;
  const actorRank = rankOf(actorRole);
  const targetRank = rankOf(targetRole);
  const strictOutrank = actorRank > targetRank;

  // What the role-toggle button should say (and grant). Admins ↔
  // members. We hide the button entirely if the actor doesn't have
  // authority for the proposed new role.
  const proposedRole: "admin" | "member" =
    targetRole === "admin" ? "member" : "admin";
  const canGrantNewRole =
    actorRank >= rankOf(proposedRole) && strictOutrank && !isSelf;

  // "Remove" semantics:
  //   - Cross-user: must strictly outrank target AND target !== owner.
  //   - Self: allowed for non-owners only (writer rejects owner self-
  //     leave). UI separates this into the "Leave organization" button.
  const canRemoveOther =
    !isSelf && strictOutrank && targetRole !== "owner";
  const canSelfLeave = isSelf && actorRole !== "owner";

  // Transfer ownership: actor must BE owner, target must NOT be.
  const canTransfer =
    actorRole === "owner" && targetRole !== "owner" && !isSelf;

  // Nothing to render — common case for member-viewing-member or
  // member-viewing-admin.
  if (!canGrantNewRole && !canRemoveOther && !canSelfLeave && !canTransfer) {
    return null;
  }

  function handleChangeRole() {
    setError(null);
    setBusy("role");
    startTransition(async () => {
      const result = await changeRoleAction({
        orgId,
        targetUserId,
        newRole: proposedRole,
      });
      setBusy(null);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleRemove() {
    setError(null);
    if (
      !confirm(
        isSelf
          ? "Leave this organization? You'll lose access until someone re-invites you."
          : `Remove this member from the organization? They'll lose access immediately.`,
      )
    ) {
      return;
    }
    setBusy("remove");
    startTransition(async () => {
      const result = await removeMemberAction({ orgId, targetUserId });
      setBusy(null);
      if (result.ok) {
        if (result.selfLeave) {
          // Self-leave: dashboard view since the org listing won't
          // include this org anymore.
          router.push("/app/dashboard");
        } else {
          router.refresh();
        }
      } else {
        setError(result.error);
      }
    });
  }

  function handleTransfer() {
    setError(null);
    if (
      !confirm(
        "Transfer ownership of this organization? You'll be demoted to admin and the new owner gets full control. This cannot be undone without a new transfer.",
      )
    ) {
      return;
    }
    setBusy("transfer");
    startTransition(async () => {
      const result = await transferOwnershipAction({
        orgId,
        toUserId: targetUserId,
      });
      setBusy(null);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const disabled = pending || busy !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {canGrantNewRole ? (
          <button
            type="button"
            className="btn btn-outline"
            style={{ fontSize: 12, padding: "4px 8px" }}
            onClick={handleChangeRole}
            disabled={disabled}
          >
            {busy === "role"
              ? "Saving…"
              : proposedRole === "admin"
              ? "Make admin"
              : "Make member"}
          </button>
        ) : null}
        {canTransfer ? (
          <button
            type="button"
            className="btn btn-outline"
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderColor: "#f57c00",
              color: "#f57c00",
            }}
            onClick={handleTransfer}
            disabled={disabled}
          >
            {busy === "transfer" ? "Transferring…" : "Transfer ownership →"}
          </button>
        ) : null}
        {canRemoveOther ? (
          <button
            type="button"
            className="btn btn-outline"
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderColor: "#c00",
              color: "#c00",
            }}
            onClick={handleRemove}
            disabled={disabled}
          >
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        ) : null}
        {canSelfLeave ? (
          <button
            type="button"
            className="btn btn-outline"
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderColor: "#c00",
              color: "#c00",
            }}
            onClick={handleRemove}
            disabled={disabled}
          >
            {busy === "remove" ? "Leaving…" : "Leave organization"}
          </button>
        ) : null}
      </div>
      {error ? (
        <div
          role="alert"
          style={{
            fontSize: 11,
            color: "#c00",
            padding: "4px 8px",
            background: "color-mix(in oklab, #c00 6%, transparent)",
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
