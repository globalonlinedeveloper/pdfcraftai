"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { deleteAccountAction, type DeleteState } from "@/lib/settings-actions";

const initial: DeleteState = { ok: false };

function DeleteButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-sm"
      disabled={disabled || pending}
      style={{
        background: "var(--red)",
        color: "white",
        borderColor: "var(--red)",
      }}
    >
      {pending ? "Deleting…" : "Delete my account"}
    </button>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, formAction] = useFormState(deleteAccountAction, initial);
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <form action={formAction}>
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 14 }}>
        This permanently deletes your account, all associated files, API keys, and
        credit balance. This action cannot be undone.
      </p>

      <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
        Type <strong>{email}</strong> to confirm:
      </label>
      <input
        className="input"
        name="confirmEmail"
        type="email"
        autoComplete="off"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        style={{ width: "100%", marginBottom: 14 }}
      />

      {state.error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>
          {state.error}
        </p>
      )}

      <DeleteButton disabled={!matches} />
    </form>
  );
}
