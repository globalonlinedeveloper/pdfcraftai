// "Open in chat" action on /app/files.
//
// Clicks create a chat session linked to this file id and redirect to
// /app/chat/:sessionId. The file bytes aren't uploaded here — the user
// re-attaches the PDF on their first turn (we're pre-S3). The stored
// file_id on chat_sessions gives the chat page enough to show "attached:
// <filename>" in its header.

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";

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
      aria-label="Open in chat"
      className="btn btn-ghost btn-sm"
      disabled={pending}
      title="Open in chat"
      style={{
        padding: 6,
        color: pending ? "var(--fg-subtle)" : "var(--fg-muted)",
      }}
    >
      <I.Chat size={14} />
    </button>
  );
}

export function OpenInChatButton({
  fileId,
  fileName,
}: {
  fileId: string;
  fileName: string;
}) {
  const [state, formAction] = useFormState(createChatSessionAction, initial);
  const router = useRouter();

  useEffect(() => {
    if (state.ok && state.id) {
      router.push(`/app/chat/${state.id}`);
    }
  }, [state, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="fileId" value={fileId} />
      <input
        type="hidden"
        name="title"
        // Default session title to the filename; users can rename later.
        value={`Chat: ${fileName}`.slice(0, 256)}
      />
      <Btn />
    </form>
  );
}
