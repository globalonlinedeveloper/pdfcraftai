"use client";

import { useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { changePasswordAction, type PasswordState } from "@/lib/settings-actions";

const initial: PasswordState = { ok: false };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
      {pending ? "Updating…" : "Change password"}
    </button>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState(
    async (prev: PasswordState | undefined, fd: FormData) => {
      const result = await changePasswordAction(prev, fd);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    initial
  );

  if (!hasPassword) {
    return (
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
        This account was created with Google, so there's no password to change
        here. Manage it in your Google account settings instead.
      </p>
    );
  }

  return (
    <form action={formAction} ref={formRef}>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Current password</label>
        <input
          className="input"
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>New password</label>
        <input
          className="input"
          type="password"
          name="newPassword"
          autoComplete="new-password"
          minLength={8}
          required
          style={{ width: "100%" }}
        />
        <p className="subtle" style={{ fontSize: 12, marginTop: 6 }}>
          At least 8 characters.
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

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 6,
};
