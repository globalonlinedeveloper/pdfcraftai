// Phase 6.1 — Macro CRUD server actions.
//
// Macros are user-owned named presets for AI tools. Each row in
// `user_macros` is one user's saved `(toolId, paramsJson)` pair under a
// user-picked `name`. Apply = load params into the tool's form state.
//
// Why the per-tool params live as a JSON column (not separate columns):
//   Different tools have different shapes — summarize needs `depth`,
//   translate needs `targetLang`, OCR has no params. A JSON blob keeps
//   the schema flat without a migration every time a new tool joins.
//   Shape validation happens here in the action layer via a discriminated
//   union on `toolId`; the DB trusts the actions.
//
// Why the actions live in /lib and not /app:
//   Matches the existing pattern for all server actions in this repo
//   (lib/chat-actions.ts, lib/tool-result-actions.ts, etc.). Client
//   components import from @/lib/* paths uniformly.
//
// Supported tools in Phase 6.1:
//   - ai-summarize → { depth: SummarizeDepth }
//   - ai-translate → { targetLang: CommonTargetLanguageCode }
// Compare and OCR have no user-facing parameters, so macros don't apply.

"use server";

import "server-only";

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { db, schema } from "@/db/client";
import { COMMON_TARGET_LANGUAGES } from "@/lib/ai/translate-langs";

// ---- Types -----------------------------------------------------------

/** Per-tool params, validated by `paramsByTool` below. */
export type MacroParams =
  | { toolId: "ai-summarize"; params: { depth: "tldr" | "standard" | "detailed" } }
  | { toolId: "ai-translate"; params: { targetLang: string } };

/** Row shape returned to the client. `params` is typed loosely here
 * (Record<string, unknown>) because the caller narrows via toolId. */
export type MacroRow = {
  id: string;
  toolId: "ai-summarize" | "ai-translate";
  name: string;
  params: Record<string, unknown>;
  updatedAt: Date;
};

export type MacroActionResult<T extends object = {}> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

// ---- Validation ------------------------------------------------------

const SUPPORTED_TOOL_IDS = ["ai-summarize", "ai-translate"] as const;
type SupportedToolId = (typeof SUPPORTED_TOOL_IDS)[number];

const TARGET_LANG_CODES = COMMON_TARGET_LANGUAGES.map((l) => l.code) as unknown as [
  string,
  ...string[],
];

const summarizeParamsSchema = z.object({
  depth: z.enum(["tldr", "standard", "detailed"]),
});

const translateParamsSchema = z.object({
  targetLang: z.enum(TARGET_LANG_CODES),
});

// Discriminated-union validator so the toolId guarantees the params shape.
const macroInputSchema = z.discriminatedUnion("toolId", [
  z.object({
    toolId: z.literal("ai-summarize"),
    name: z.string().trim().min(1).max(80),
    params: summarizeParamsSchema,
  }),
  z.object({
    toolId: z.literal("ai-translate"),
    name: z.string().trim().min(1).max(80),
    params: translateParamsSchema,
  }),
]);

function isSupportedToolId(id: string): id is SupportedToolId {
  return (SUPPORTED_TOOL_IDS as readonly string[]).includes(id);
}

// MySQL ER_DUP_ENTRY for the unique (userId, toolId, name) index.
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number };
  return e.code === "ER_DUP_ENTRY" || e.errno === 1062;
}

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user ? (session.user as { id?: string }).id : undefined;
  return userId ?? null;
}

// ---- Actions ---------------------------------------------------------

/**
 * Create a new macro for the signed-in user. Rejects:
 *   - not signed in                         → "not_authenticated"
 *   - unsupported toolId or bad params      → "invalid_macro"
 *   - duplicate name within (user, tool)    → "duplicate_name"
 *
 * On success returns the inserted row. Caller prepends it to local state.
 */
export async function createMacroAction(input: {
  toolId: string;
  name: string;
  params: unknown;
}): Promise<MacroActionResult<{ macro: MacroRow }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "not_authenticated" };

  const parsed = macroInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_macro" };
  }

  const id = randomUUID();
  try {
    await db.insert(schema.userMacros).values({
      id,
      userId,
      toolId: parsed.data.toolId,
      name: parsed.data.name,
      paramsJson: parsed.data.params,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return { ok: false, error: "duplicate_name" };
    }
    console.error("[createMacroAction] insert failed", err);
    return { ok: false, error: "db_error" };
  }

  // Revalidate the tool page so the server-rendered list (if any) stays fresh.
  revalidatePath(`/tool/${parsed.data.toolId}`);

  return {
    ok: true,
    macro: {
      id,
      toolId: parsed.data.toolId,
      name: parsed.data.name,
      params: parsed.data.params as Record<string, unknown>,
      updatedAt: new Date(),
    },
  };
}

/**
 * Rename an existing macro. The (id, userId) filter is our ownership
 * guard — users cannot rename another user's macro even with a guessed
 * id. Returns "not_found" when the pair misses (wrong id or wrong user).
 * Returns "duplicate_name" if the new name collides within (user, tool).
 */
export async function renameMacroAction(input: {
  id: string;
  name: string;
}): Promise<MacroActionResult<{ macro: MacroRow }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "not_authenticated" };

  const parsed = z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  // Load first so we can (a) confirm ownership and (b) revalidate the
  // right tool path after the rename.
  const existing = await db
    .select()
    .from(schema.userMacros)
    .where(
      and(
        eq(schema.userMacros.id, parsed.data.id),
        eq(schema.userMacros.userId, userId)
      )
    )
    .limit(1);
  const row = existing[0];
  if (!row) return { ok: false, error: "not_found" };

  try {
    await db
      .update(schema.userMacros)
      .set({ name: parsed.data.name })
      .where(
        and(
          eq(schema.userMacros.id, parsed.data.id),
          eq(schema.userMacros.userId, userId)
        )
      );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return { ok: false, error: "duplicate_name" };
    }
    console.error("[renameMacroAction] update failed", err);
    return { ok: false, error: "db_error" };
  }

  revalidatePath(`/tool/${row.toolId}`);

  return {
    ok: true,
    macro: {
      id: row.id,
      toolId: row.toolId as SupportedToolId,
      name: parsed.data.name,
      params: (row.paramsJson ?? {}) as Record<string, unknown>,
      updatedAt: new Date(),
    },
  };
}

/**
 * Delete a macro owned by the signed-in user. Silent on miss — if the
 * row doesn't exist (already deleted, or wrong user), we still return
 * `{ ok: true }` because the desired state ("this id is not in my
 * macros") already holds. The UI can safely remove the chip without
 * waiting to verify.
 */
export async function deleteMacroAction(input: {
  id: string;
}): Promise<MacroActionResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "not_authenticated" };

  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  // Pull toolId for revalidation before the delete (after-the-fact we'd
  // have no row to read). Using the same (id, userId) filter is the
  // ownership guard.
  const existing = await db
    .select({ toolId: schema.userMacros.toolId })
    .from(schema.userMacros)
    .where(
      and(
        eq(schema.userMacros.id, parsed.data.id),
        eq(schema.userMacros.userId, userId)
      )
    )
    .limit(1);

  try {
    await db
      .delete(schema.userMacros)
      .where(
        and(
          eq(schema.userMacros.id, parsed.data.id),
          eq(schema.userMacros.userId, userId)
        )
      );
  } catch (err) {
    console.error("[deleteMacroAction] delete failed", err);
    return { ok: false, error: "db_error" };
  }

  const toolId = existing[0]?.toolId;
  if (toolId) revalidatePath(`/tool/${toolId}`);

  return { ok: true };
}

/**
 * List all macros for the signed-in user scoped to a single tool.
 * Returns `[]` for anonymous callers — the MacroBar just renders empty.
 * Orders by updatedAt desc so the most recently touched macro sits first
 * (matches how chip rows typically want to show "recent").
 *
 * The `canSave` flag lets client components distinguish "user is signed
 * in but has no macros yet" (show the Save-current button) from "user
 * is anonymous" (hide it entirely). Returning it here avoids a second
 * round-trip or threading session state through every tool page.
 */
export async function listMacrosForToolAction(input: {
  toolId: string;
}): Promise<MacroActionResult<{ macros: MacroRow[]; canSave: boolean }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: true, macros: [], canSave: false };

  if (!isSupportedToolId(input.toolId)) {
    return { ok: false, error: "unsupported_tool" };
  }

  const rows = await db
    .select({
      id: schema.userMacros.id,
      toolId: schema.userMacros.toolId,
      name: schema.userMacros.name,
      paramsJson: schema.userMacros.paramsJson,
      updatedAt: schema.userMacros.updatedAt,
    })
    .from(schema.userMacros)
    .where(
      and(
        eq(schema.userMacros.userId, userId),
        eq(schema.userMacros.toolId, input.toolId)
      )
    )
    .orderBy(desc(schema.userMacros.updatedAt));

  return {
    ok: true,
    canSave: true,
    macros: rows.map((r) => ({
      id: r.id,
      toolId: r.toolId as SupportedToolId,
      name: r.name,
      params: (r.paramsJson ?? {}) as Record<string, unknown>,
      updatedAt: r.updatedAt,
    })),
  };
}
