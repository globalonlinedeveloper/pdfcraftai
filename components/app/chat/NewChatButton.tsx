// Creates a new chat session, then redirects into it.

"use client";

import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { useEffect } from "react";

import {
  createChatSessionAction,
  type CreateChatSessionState,
} from "@/lib/chat-actions";
import { I } from "@/components/icons/Icons";

const initial: CreateChatSessionState = { ok: false };

function Btn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-primary btn-sm"
      disabled={pending}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <I.Plus size={14} />
      {pending ? "Creating…" : "New chat"}
    </button>
  );
}

export function NewChatButton({
  fileId,
  label,
}: {
  /** Pre-associate this session with a file (e.g. from /app/files). */
  fileId?: string;
  label?: string;
}) {
  const [state, formAction] = useFormState(createChatSessionAction, initial);
  const router = useRouter();

  // Navigate to the new session as soon as the action reports success.
  // (We don't call `redirect()` in the action because that prevents
  // useActionState from surfacing errors to the user.)
  useEffect(() => {
    if (state.ok && state.id) {
      router.push(`/app/chat/${state.id}`);
    }
  }, [state, router]);

  return (
    <form action={formAction}>
      {fileId ? <input type="hidden" name="fileId" value={fileId} /> : null}
      {label ? <input type="hidden" name="title" value={label} /> : null}
      <Btn />
      {state.error ? (
        <div className="subtle" style={{ fontSize: 12, color: "#c00", marginTop: 6 }}>
          {state.error}
        </div>
      ) : null}
    </form>
  );
}
