// Inline row actions for the /app/chat session list.
//
// Three verbs:
//   - Rename (prompt-driven; keeps the UI tiny)
//   - Archive / Unarchive (toggle based on row state)
//   - Delete (hard; confirm() before firing)
//
// Each verb is its own <form action={...}> so the component can live in
// a list of rows without bundling a modal library. Good enough for an
// internal tool; a modal comes in Phase 6 if users complain.

"use client";

import { useFormState, useFormStatus } from "react-dom";

import {
  archiveChatSessionAction,
  deleteChatSessionAction,
  renameChatSessionAction,
  type ArchiveChatSessionState,
  type DeleteChatSessionState,
  type RenameChatSessionState,
} from "@/lib/chat-actions";
import { I } from "@/components/icons/Icons";

const renameInitial: RenameChatSessionState = { ok: false };
const archiveInitial: ArchiveChatSessionState = { ok: false };
const deleteInitial: DeleteChatSessionState = { ok: false };

export function ChatRowActions({
  id,
  title,
  archived,
}: {
  id: string;
  title: string;
  archived: boolean;
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <RenameButton id={id} currentTitle={title} />
      <ArchiveButton id={id} archived={archived} />
      <DeleteButton id={id} />
    </div>
  );
}

function RenameButton({ id, currentTitle }: { id: string; currentTitle: string }) {
  const [, formAction] = useFormState(renameChatSessionAction, renameInitial);

  return (
    <form
      action={(fd: FormData) => {
        const next = window.prompt("Rename chat", currentTitle);
        if (!next || next.trim().length === 0) return;
        fd.set("id", id);
        fd.set("title", next.trim());
        formAction(fd);
      }}
    >
      <RowBtn ariaLabel="Rename chat">
        <I.Edit size={14} />
      </RowBtn>
    </form>
  );
}

function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const [, formAction] = useFormState(archiveChatSessionAction, archiveInitial);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="archive" value={archived ? "false" : "true"} />
      <RowBtn ariaLabel={archived ? "Unarchive chat" : "Archive chat"}>
        {archived ? <I.Refresh size={14} /> : <I.Clock size={14} />}
      </RowBtn>
    </form>
  );
}

function DeleteButton({ id }: { id: string }) {
  const [, formAction] = useFormState(deleteChatSessionAction, deleteInitial);
  return (
    <form
      action={(fd: FormData) => {
        const ok = window.confirm(
          "Delete this chat and all its messages? This cannot be undone."
        );
        if (!ok) return;
        fd.set("id", id);
        formAction(fd);
      }}
    >
      <RowBtn ariaLabel="Delete chat" danger>
        <I.Trash size={14} />
      </RowBtn>
    </form>
  );
}

function RowBtn({
  children,
  ariaLabel,
  danger,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label={ariaLabel}
      className="btn btn-ghost btn-sm"
      disabled={pending}
      style={{
        padding: 6,
        color: pending
          ? "var(--fg-subtle)"
          : danger
            ? "var(--fg-muted)"
            : "var(--fg-muted)",
      }}
    >
      {children}
    </button>
  );
}
