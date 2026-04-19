"use client";

import { useFormState, useFormStatus } from "react-dom";
import { deleteFileAction, type DeleteFileState } from "@/lib/files-actions";
import { I } from "@/components/icons/Icons";

const initial: DeleteFileState = { ok: false };

function Btn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label="Delete file"
      className="btn btn-ghost btn-sm"
      disabled={pending}
      style={{
        padding: 6,
        color: pending ? "var(--fg-subtle)" : "var(--fg-muted)",
      }}
    >
      <I.Trash size={14} />
    </button>
  );
}

export function DeleteFileButton({ id }: { id: string }) {
  const [, formAction] = useFormState(deleteFileAction, initial);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Btn />
    </form>
  );
}
