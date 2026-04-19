"use server";

import "server-only";
import { randomUUID } from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/db/client";
import { auth } from "@/auth";

const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB ceiling on the metadata entry

const logSchema = z.object({
  toolId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(512),
  mime: z.string().min(1).max(128).default("application/pdf"),
  sizeBytes: z.number().int().min(0).max(MAX_SIZE_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "Invalid sha256"),
});

export type LogToolResultState = {
  ok: boolean;
  error?: string;
  id?: string;
  /** True when the user is signed in and a metadata row was actually inserted. */
  logged?: boolean;
};

/**
 * Record a tool-produced file's metadata in the files table.
 * - Anonymous users: no-op (returns { ok: true, logged: false }).
 * - Signed-in users: inserts a files row with source='tool', toolId set.
 *
 * No bytes are stored; only name, size, mime, and sha256.
 */
export async function logToolResultAction(input: {
  toolId: string;
  name: string;
  mime?: string;
  sizeBytes: number;
  sha256: string;
}): Promise<LogToolResultState> {
  const session = await auth();
  const userId = session?.user ? (session.user as { id?: string }).id : undefined;

  if (!userId) {
    // Anonymous — nothing to log, not an error.
    return { ok: true, logged: false };
  }

  const parsed = logSchema.safeParse({
    toolId: input.toolId,
    name: input.name,
    mime: input.mime ?? "application/pdf",
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid metadata." };
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
      status: "ready",
      source: "tool",
      toolId: parsed.data.toolId,
    });
  } catch (err) {
    console.error("logToolResult failed:", err);
    return { ok: false, error: "Could not log tool result." };
  }

  revalidatePath("/app/files");
  revalidatePath("/app/dashboard");
  return { ok: true, logged: true, id };
}
