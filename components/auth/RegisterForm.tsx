"use client";

import { useFormState, useFormStatus } from "react-dom";
import { registerAction, type RegisterState } from "@/lib/auth-actions";
import { signIn } from "next-auth/react";

const initial: RegisterState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-primary"
      style={{ width: "100%", marginTop: 8 }}
      disabled={pending}
    >
      {pending ? "Creating account…" : "Create account"}
    </button>
  );
}

export function RegisterForm() {
  const [state, formAction] = useFormState(registerAction, initial);
  const fe = state.fieldErrors ?? {};

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ width: "100%", marginBottom: 16 }}
        onClick={() => signIn("google", { callbackUrl: "/app/dashboard" })}
      >
        <span style={{ marginRight: 8 }}>
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
        </span>
        Continue with Google
      </button>

      <div
        aria-hidden
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "16px 0",
          color: "var(--fg-subtle)",
          fontSize: 12,
        }}
      >
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        OR
        <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>

      <form action={formAction}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
          Name
        </label>
        <input
          className="input"
          type="text"
          name="name"
          autoComplete="name"
          required
          placeholder="Ada Lovelace"
          style={{ width: "100%", marginBottom: fe.name ? 4 : 14 }}
        />
        {fe.name && <FieldError msg={fe.name} />}

        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
          Email
        </label>
        <input
          className="input"
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          style={{ width: "100%", marginBottom: fe.email ? 4 : 14 }}
        />
        {fe.email && <FieldError msg={fe.email} />}

        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
          Password
        </label>
        <input
          className="input"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="At least 8 characters"
          style={{ width: "100%", marginBottom: 4 }}
        />
        {fe.password && <FieldError msg={fe.password} />}

        {state.error && !state.fieldErrors && (
          <p role="alert" style={{ color: "var(--danger, #ef4444)", fontSize: 13, marginTop: 10 }}>
            {state.error}
          </p>
        )}

        <SubmitButton />

        <p className="muted" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
          By creating an account you agree to our{" "}
          <a href="/terms" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Terms
          </a>{" "}
          and{" "}
          <a href="/privacy" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Privacy Policy
          </a>
          .
        </p>
      </form>
    </>
  );
}

function FieldError({ msg }: { msg: string }) {
  return (
    <p style={{ color: "var(--danger, #ef4444)", fontSize: 12, margin: "0 0 14px" }}>
      {msg}
    </p>
  );
}
