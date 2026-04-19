"use server";

import "server-only";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, schema } from "@/db/client";
import { auth } from "@/auth";

async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user ? (session.user as { id?: string }).id : undefined;
  if (!id) redirect("/login");
  return id;
}

// --- Register file metadata (no bytes stored server-side in Phase 2) ---

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB soft cap for metadata
const MAX_NAME_LEN = 512;

const registerSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LEN),
  mime: z.string().min(1).max(128).default("application/pdf"),
  sizeBytes: z.number().int().min(0).max(MAX_SIZE_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "Invalid sha256"),
});

export type RegisterFileState = { ok: boolean; error?: string; id?: string };

export async function registerFileAction(
  _prev: RegisterFileState | undefined,
  formData: FormData
): Promise<RegisterFileState> {
  const userId = await requireUserId();

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    mime: formData.get("mime") ?? "application/pdf",
    sizeBytes: Number(formData.get("sizeBytes") ?? 0),
    sha256: formData.get("sha256"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid file metadata.",
    };
  }

  const id = randomUUID();
  try {
    await db.insert(schema.files).values({
      id,
      userId,
      name: parsed.data.name,
      mime: parsed.data.mime,
      sizeBytes: parsed.data.sizeBytes,
      sha256: parsed.data.sha256,
      status: "pending",
    });
  } catch (err) {
    console.error("registerFile failed:", err);
    return { ok: false, error: "Could not save file." };
  }

  revalidatePath("/app/files");
  revalidatePath("/app/dashboard");
  return { ok: true, id };
}

// --- Delete file ---

export type DeleteFileState = { ok: boolean; error?: string };

export async function deleteFileAction(
  _prev: DeleteFileState | undefined,
  formData: FormData
): Promise<DeleteFileState> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing file id." };

  try {
    await db
      .delete(schema.files)
      .where(and(eq(schema.files.id, id), eq(schema.files.userId, userId)));
  } catch (err) {
    console.error("deleteFile failed:", err);
    return { ok: false, error: "Could not delete file." };
  }

  revalidatePath("/app/files");
  revalidatePath("/app/dashboard");
  return { ok: true };
}
