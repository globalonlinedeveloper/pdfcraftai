"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateProfileAction, type ProfileState } from "@/lib/settings-actions";

const initial: ProfileState = { ok: false };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, formAction] = useFormState(updateProfileAction, initial);

  return (
    <form action={formAction}>
      <div style={{ marginBottom: 16 }}>
        <label style={label}>Name</label>
        <input
          className="input"
          name="name"
          type="text"
          defaultValue={name}
          required
          maxLength={120}
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={label}>Email</label>
        <input
          className="input"
          type="email"
          defaultValue={email}
          disabled
          style={{ width: "100%", opacity: 0.6 }}
        />
        <p className="subtle" style={{ fontSize: 12, marginTop: 6 }}>
          Email changes aren't supported yet — contact support to update.
        </p>
      </div>

      {state.error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" style={{ color: "var(--green)", fontSize: 13, marginBottom: 10 }}>
          {state.message}
        </p>
      )}

      <SaveButton />
    </form>
  );
}

const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 6,
};
