// Server actions for chat sessions.
//
// The /api/ai/chat streaming endpoint handles the turn-by-turn message
// flow; this file is for the management layer — creating, renaming,
// archiving, and deleting sessions. All actions are ownership-scoped
// via `requireUserId()` so a user can never mutate someone else's row.
//
// Why actions and not REST: the /app/chat list page is a React Server
// Component. Server actions let the Rename / Delete buttons live inline
// without an SPA layer, and revalidatePath flips the list atomically.

"use server";

import "server-only";

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import { db, schema } from "@/db/client";

async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user ? (session.user as { id?: string }).id : undefined;
  if (!id) redirect("/login");
  return id;
}

const MAX_TITLE_LEN = 256;

// --- Create session ---------------------------------------------------

const createSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LEN).optional(),
  // When the user clicks "Open in chat" on /app/files we pass the file id
  // so the session remembers which document it's attached to. Optional —
  // a freeform chat has no associated file.
  fileId: z
    .string()
    .trim()
    .length(36)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type CreateChatSessionState = {
  ok: boolean;
  error?: string;
  id?: string;
};

/**
 * Create a new chat session and (on success) redirect to it. If
 * `fileId` is passed, we verify the file belongs to the current user
 * before storing the link — otherwise we'd let someone leak the
 * existence of other users' files via 200-vs-404 timing.
 */
export async function createChatSessionAction(
  _prev: CreateChatSessionState | undefined,
  formData: FormData
): Promise<CreateChatSessionState> {
  const userId = await requireUserId();

  const parsed = createSchema.safeParse({
    title: formData.get("title") ?? undefined,
    fileId: formData.get("fileId") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  // If a fileId was passed, make sure this user owns it.
  let fileId: string | null = null;
  if (parsed.data.fileId) {
    const [row] = await db
      .select({ id: schema.files.id, name: schema.files.name })
      .from(schema.files)
      .where(
        and(
          eq(schema.files.id, parsed.data.fileId),
          eq(schema.files.userId, userId)
        )
      )
      .limit(1);
    if (!row) {
      // Don't leak "exists but not yours" vs "doesn't exist". Same error.
      return { ok: false, error: "File not found." };
    }
    fileId = row.id;
  }

  const id = randomUUID();
  try {
    await db.insert(schema.chatSessions).values({
      id,
      userId,
      fileId,
      title: parsed.data.title ?? "New chat",
    });
  } catch (err) {
    console.error("createChatSession failed:", err);
    return { ok: false, error: "Could not create chat." };
  }

  revalidatePath("/app/chat");
  revalidatePath("/app/dashboard");
  // Caller redirects; return id so the client form can navigate via
  // <Link> if it prefers. We don't `redirect()` here so useActionState
  // can surface errors.
  return { ok: true, id };
}

// --- Rename session ---------------------------------------------------

const renameSchema = z.object({
  id: z.string().trim().length(36),
  title: z.string().trim().min(1).max(MAX_TITLE_LEN),
});

export type RenameChatSessionState = {
  ok: boolean;
  error?: string;
};

export async function renameChatSessionAction(
  _prev: RenameChatSessionState | undefined,
  formData: FormData
): Promise<RenameChatSessionState> {
  const userId = await requireUserId();
  const parsed = renameSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    const result = await db
      .update(schema.chatSessions)
      .set({ title: parsed.data.title })
      .where(
        and(
          eq(schema.chatSessions.id, parsed.data.id),
          eq(schema.chatSessions.userId, userId)
        )
      );
    // mysql2 returns an array-ish result; no rowsAffected check needed
    // for a rename — idempotent. If the id is bogus we just no-op.
    void result;
  } catch (err) {
    console.error("renameChatSession failed:", err);
    return { ok: false, error: "Could not rename chat." };
  }

  revalidatePath("/app/chat");
  revalidatePath(`/app/chat/${parsed.data.id}`);
  return { ok: true };
}

// --- Archive session --------------------------------------------------

const archiveSchema = z.object({
  id: z.string().trim().length(36),
  /** "true" to archive, "false" to unarchive. */
  archive: z.enum(["true", "false"]).default("true"),
});

export type ArchiveChatSessionState = {
  ok: boolean;
  error?: string;
};

/**
 * Archive (hide from the default list) or unarchive a session. Soft-
 * delete is preferred over hard-delete for chats because the credit
 * ledger links back to message ids — hard-deleting the thread breaks
 * the audit trail for /app/billing.
 */
export async function archiveChatSessionAction(
  _prev: ArchiveChatSessionState | undefined,
  formData: FormData
): Promise<ArchiveChatSessionState> {
  const userId = await requireUserId();
  const parsed = archiveSchema.safeParse({
    id: formData.get("id"),
    archive: formData.get("archive") ?? "true",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const archivedAt = parsed.data.archive === "true" ? new Date() : null;
  try {
    await db
      .update(schema.chatSessions)
      .set({ archivedAt })
      .where(
        and(
          eq(schema.chatSessions.id, parsed.data.id),
          eq(schema.chatSessions.userId, userId)
        )
      );
  } catch (err) {
    console.error("archiveChatSession failed:", err);
    return { ok: false, error: "Could not archive chat." };
  }

  revalidatePath("/app/chat");
  revalidatePath(`/app/chat/${parsed.data.id}`);
  return { ok: true };
}

// --- Delete session ---------------------------------------------------

const deleteSchema = z.object({
  id: z.string().trim().length(36),
});

export type DeleteChatSessionState = {
  ok: boolean;
  error?: string;
};

/**
 * Hard-delete a chat session AND all its messages (ON DELETE CASCADE on
 * chat_messages.session_id handles the cascade at the DB layer). The
 * credit_ledger rows survive — they reference `reason = 'ai_chat_turn'`
 * and don't FK into chat_messages, so audit stays intact.
 *
 * Prefer archive for regular users; expose this for the explicit
 * "Delete forever" affordance.
 */
export async function deleteChatSessionAction(
  _prev: DeleteChatSessionState | undefined,
  formData: FormData
): Promise<DeleteChatSessionState> {
  const userId = await requireUserId();
  const parsed = deleteSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    await db
      .delete(schema.chatSessions)
      .where(
        and(
          eq(schema.chatSessions.id, parsed.data.id),
          eq(schema.chatSessions.userId, userId)
        )
      );
  } catch (err) {
    console.error("deleteChatSession failed:", err);
    return { ok: false, error: "Could not delete chat." };
  }

  revalidatePath("/app/chat");
  revalidatePath("/app/dashboard");
  return { ok: true };
}
