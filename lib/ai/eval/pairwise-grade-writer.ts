// Pairwise grade writer (Phase G-2 final, 2026-05-07).
//
// Pairs with lib/ai/eval/human-grade-writer.ts (single-output
// Likert grading). This writer captures preference between TWO
// configs on the same (op × fixture).
//
// Canonical ordering
// ------------------
// At write time the (left, right) pair is sorted alphabetically
// by (provider_id, model). So submitting (anthropic/claude-haiku
// vs openai/gpt-4o-mini) and (openai/gpt-4o-mini vs anthropic/
// claude-haiku) both end up as the same canonical pair. The
// caller's "preference" value is auto-flipped on swap so the
// semantic outcome is preserved:
//   - submit: (right=openai, left=anthropic, pref=right)
//   - canonicalize: pair sorted alphabetically → left=anthropic,
//     right=openai, pref=right (no flip needed since anthropic <
//     openai)
//   - submit: (left=openai, right=anthropic, pref=left)
//   - canonicalize: pair flipped → left=anthropic, right=openai,
//     pref=right (auto-flipped)
//
// This makes "which combo wins more pairwise comparisons" a
// straightforward GROUP BY, no orientation gymnastics in the
// reader.

import "server-only";

import { randomUUID } from "node:crypto";

import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";

export type PairwisePreference = "left" | "right" | "tie" | "both_bad";

export interface RecordPairwiseGradeInput {
  goldenSetId: string;
  op: string;
  leftProviderId: string;
  leftModel: string;
  rightProviderId: string;
  rightModel: string;
  graderUserId: string;
  preference: PairwisePreference;
  /** Optional 1-5 absolute Likert. NULL = grader didn't score
   *  absolutely (preference-only grading). */
  leftOverallScore?: number | null;
  rightOverallScore?: number | null;
  notes?: string | null;
  leftOutputExcerpt?: string | null;
  rightOutputExcerpt?: string | null;
  /** When true, allow overwriting an existing row for the same
   *  (fixture × pair × op × grader). Default false — duplicate
   *  submissions error with DUPLICATE so the UI can prompt
   *  "Replace prior grade?". */
  replace?: boolean;
}

export class PairwiseGradeWriteError extends Error {
  readonly code:
    | "INVALID_PREFERENCE"
    | "INVALID_SCORE"
    | "DUPLICATE"
    | "EMPTY_REQUIRED"
    | "SAME_CONFIG"
    | "DB_ERROR";
  constructor(message: string, code: PairwiseGradeWriteError["code"]) {
    super(message);
    this.name = "PairwiseGradeWriteError";
    this.code = code;
  }
}

const PREFERENCE_ALLOWED: ReadonlyArray<PairwisePreference> = [
  "left",
  "right",
  "tie",
  "both_bad",
];

function requireNonEmpty(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PairwiseGradeWriteError(
      `${name} is required`,
      "EMPTY_REQUIRED",
    );
  }
  return value.trim();
}

function validateOptionalScore(
  name: string,
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > 5
  ) {
    throw new PairwiseGradeWriteError(
      `${name} must be an integer 1..5 (got ${String(value)})`,
      "INVALID_SCORE",
    );
  }
  return value;
}

/**
 * Canonicalize the (left, right) pair by alphabetical ordering on
 * (provider_id, model). Returns the canonical row + a possibly-
 * flipped preference. left/right output excerpts are also swapped
 * so they line up with the canonical configs.
 */
export function canonicalizePair(input: RecordPairwiseGradeInput): {
  leftProviderId: string;
  leftModel: string;
  rightProviderId: string;
  rightModel: string;
  preference: PairwisePreference;
  leftOverallScore: number | null;
  rightOverallScore: number | null;
  leftOutputExcerpt: string | null;
  rightOutputExcerpt: string | null;
} {
  const leftKey = `${input.leftProviderId}|${input.leftModel}`;
  const rightKey = `${input.rightProviderId}|${input.rightModel}`;

  const shouldSwap = leftKey > rightKey;
  if (!shouldSwap) {
    return {
      leftProviderId: input.leftProviderId,
      leftModel: input.leftModel,
      rightProviderId: input.rightProviderId,
      rightModel: input.rightModel,
      preference: input.preference,
      leftOverallScore: input.leftOverallScore ?? null,
      rightOverallScore: input.rightOverallScore ?? null,
      leftOutputExcerpt: input.leftOutputExcerpt ?? null,
      rightOutputExcerpt: input.rightOutputExcerpt ?? null,
    };
  }

  // Swap orientation. Flip preference if it was "left" or "right";
  // tie / both_bad are orientation-independent.
  const flipped: PairwisePreference =
    input.preference === "left"
      ? "right"
      : input.preference === "right"
      ? "left"
      : input.preference;

  return {
    leftProviderId: input.rightProviderId,
    leftModel: input.rightModel,
    rightProviderId: input.leftProviderId,
    rightModel: input.leftModel,
    preference: flipped,
    leftOverallScore: input.rightOverallScore ?? null,
    rightOverallScore: input.leftOverallScore ?? null,
    leftOutputExcerpt: input.rightOutputExcerpt ?? null,
    rightOutputExcerpt: input.leftOutputExcerpt ?? null,
  };
}

/**
 * Insert a pairwise grade row. Throws PairwiseGradeWriteError on
 * validation failure or duplicate. Uses the same MySQL ER_DUP_ENTRY
 * detection pattern as recordHumanGrade so the UI can offer a
 * "Replace prior grade?" path on conflict.
 */
export async function recordPairwiseGrade(
  input: RecordPairwiseGradeInput,
): Promise<{ ok: true; id: string }> {
  // Validate inputs
  const goldenSetId = requireNonEmpty("goldenSetId", input.goldenSetId);
  const op = requireNonEmpty("op", input.op);
  const leftProviderId = requireNonEmpty(
    "leftProviderId",
    input.leftProviderId,
  );
  const leftModel = requireNonEmpty("leftModel", input.leftModel);
  const rightProviderId = requireNonEmpty(
    "rightProviderId",
    input.rightProviderId,
  );
  const rightModel = requireNonEmpty("rightModel", input.rightModel);
  const graderUserId = requireNonEmpty("graderUserId", input.graderUserId);

  if (!PREFERENCE_ALLOWED.includes(input.preference)) {
    throw new PairwiseGradeWriteError(
      `preference must be one of ${PREFERENCE_ALLOWED.join("/")} (got ${String(input.preference)})`,
      "INVALID_PREFERENCE",
    );
  }

  // Reject same-config comparison (would yield trivial preference)
  if (
    leftProviderId === rightProviderId &&
    leftModel === rightModel
  ) {
    throw new PairwiseGradeWriteError(
      "Left and right configs must differ — pairwise comparison of the same model is meaningless.",
      "SAME_CONFIG",
    );
  }

  const leftScore = validateOptionalScore(
    "leftOverallScore",
    input.leftOverallScore ?? null,
  );
  const rightScore = validateOptionalScore(
    "rightOverallScore",
    input.rightOverallScore ?? null,
  );

  // Canonicalize the pair so (A vs B) and (B vs A) end up the same
  const canon = canonicalizePair({
    ...input,
    leftProviderId,
    leftModel,
    rightProviderId,
    rightModel,
    leftOverallScore: leftScore,
    rightOverallScore: rightScore,
  });

  const id = randomUUID();

  try {
    if (input.replace === true) {
      // Replace path: delete any existing row first, then insert.
      // In a tx so a partial failure can't leave the prior row
      // deleted but new one missing.
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.evalPairwiseGrades)
          .where(
            and(
              eq(schema.evalPairwiseGrades.goldenSetId, goldenSetId),
              eq(
                schema.evalPairwiseGrades.leftProviderId,
                canon.leftProviderId,
              ),
              eq(schema.evalPairwiseGrades.leftModel, canon.leftModel),
              eq(
                schema.evalPairwiseGrades.rightProviderId,
                canon.rightProviderId,
              ),
              eq(schema.evalPairwiseGrades.rightModel, canon.rightModel),
              eq(schema.evalPairwiseGrades.op, op),
              eq(schema.evalPairwiseGrades.graderUserId, graderUserId),
            ),
          );
        await tx.insert(schema.evalPairwiseGrades).values({
          id,
          goldenSetId,
          op,
          leftProviderId: canon.leftProviderId,
          leftModel: canon.leftModel,
          rightProviderId: canon.rightProviderId,
          rightModel: canon.rightModel,
          graderUserId,
          preference: canon.preference,
          leftOverallScore: canon.leftOverallScore,
          rightOverallScore: canon.rightOverallScore,
          notes: input.notes ?? null,
          leftOutputExcerpt: canon.leftOutputExcerpt,
          rightOutputExcerpt: canon.rightOutputExcerpt,
        });
      });
    } else {
      await db.insert(schema.evalPairwiseGrades).values({
        id,
        goldenSetId,
        op,
        leftProviderId: canon.leftProviderId,
        leftModel: canon.leftModel,
        rightProviderId: canon.rightProviderId,
        rightModel: canon.rightModel,
        graderUserId,
        preference: canon.preference,
        leftOverallScore: canon.leftOverallScore,
        rightOverallScore: canon.rightOverallScore,
        notes: input.notes ?? null,
        leftOutputExcerpt: canon.leftOutputExcerpt,
        rightOutputExcerpt: canon.rightOutputExcerpt,
      });
    }
    return { ok: true, id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Duplicate entry") || msg.includes("ER_DUP_ENTRY")) {
      throw new PairwiseGradeWriteError(
        "A pairwise grade for this (fixture × pair × op × grader) already exists. Pass replace=true to overwrite.",
        "DUPLICATE",
      );
    }
    throw new PairwiseGradeWriteError(
      `Failed to record pairwise grade: ${msg}`,
      "DB_ERROR",
    );
  }
}
