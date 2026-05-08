// 2026-05-08 — Delete affordance for AI artifacts on the
// /app/files/[id]/preview page. Compounds the AI History →
// preview navigation: artifacts are now reachable from AI History,
// editable (copy/download), AND removable without bouncing back to
// /app/files.
//
// Why a separate component from `DeleteFileButton`:
//   1. Different UX — preview-page delete is a destructive action on
//      a focused single-artifact surface, so it warrants a confirm
//      step. The /app/files row delete is one-click because the user
//      is in a list and re-finds-and-undeletes is much harder mid-
//      list (we don't have an undo).
//   2. Different post-action target — DeleteFileButton stays on
//      /app/files (the file disappears from the rendered list on
//      the next render). Preview delete navigates back to
//      /app/ai-history because the user came from there and
//      the now-deleted preview is a 404.
//   3. Different visual weight — preview's delete button is a
//      labeled destructive action, not a small trash icon.
//
// Two-click confirm is the pattern: first click arms the button,
// second click actually submits. 4-second timeout disarms if the
// user moves on. Better than a modal dialog (interrupts flow more
// than the deletion warrants) and better than a native
// `window.confirm` (which is blocking, ugly, and skipped by some
// keyboard users).

"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { deleteFileAction, type DeleteFileState } from "@/lib/files-actions";
import { I } from "@/components/icons/Icons";

const initial: DeleteFileState = { ok: false };

function ArmedButton({ armed, onArm }: { armed: boolean; onArm: () => void }) {
  // useFormStatus hook fires while the form's action is in flight —
  // disable the button + show "Deleting…" so a user spamming the
  // button doesn't double-fire (the action is idempotent at the DB
  // level, but the UX should signal pending state).
  const { pending } = useFormStatus();

  if (!armed) {
    return (
      <button
        type="button"
        onClick={onArm}
        className="btn btn-ghost btn-sm"
        aria-label="Delete this AI artifact"
        style={{ gap: 6, color: "var(--fg-muted)" }}
      >
        <I.Trash size={13} />
        Delete
      </button>
    );
  }

  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-sm"
      aria-label="Confirm delete — this cannot be undone"
      style={{
        gap: 6,
        // Destructive styling — accent the action so the user
        // visibly sees they're past the confirm threshold and
        // committing to it.
        background: "var(--red, #d4493c)",
        color: "white",
        borderColor: "var(--red, #d4493c)",
      }}
    >
      <I.Trash size={13} />
      {pending ? "Deleting…" : "Click again to confirm"}
    </button>
  );
}

export function DeleteAiArtifactButton({ id }: { id: string }) {
  const [state, formAction] = useFormState(deleteFileAction, initial);
  const [armed, setArmed] = useState(false);
  const router = useRouter();
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-disarm after 4s — if the user clicks delete then walks
  // away or moves on to another action, we don't want the next
  // click anywhere near this region to fire the destructive
  // submit.
  useEffect(() => {
    if (!armed) return;
    armedTimerRef.current = setTimeout(() => setArmed(false), 4000);
    return () => {
      if (armedTimerRef.current) clearTimeout(armedTimerRef.current);
    };
  }, [armed]);

  // Navigate away on successful delete. The preview page becomes a
  // 404 on the next request (revalidatePath will have busted the
  // /app/ai-history cache so the row is gone there too), and
  // staying on a stale-data view is a worse UX than punting back
  // to the index. router.push is preferred over window.location
  // because it preserves React state on the new page (the AI
  // History page can re-render without a full navigation flash).
  useEffect(() => {
    if (state.ok) {
      router.push("/app/ai-history");
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <ArmedButton armed={armed} onArm={() => setArmed(true)} />
      {state.error ? (
        <span
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--red, #d4493c)",
            marginLeft: 8,
          }}
        >
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
