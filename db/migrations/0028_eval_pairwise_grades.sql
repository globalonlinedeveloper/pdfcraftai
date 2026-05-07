-- Migration 0028 — eval_pairwise_grades for Phase G-2 side-by-side
-- comparison grader (PENDING §6a final, 2026-05-07).
--
-- Pairs with eval_human_grades (migration 0026, single-output Likert
-- grading). This table captures preference between TWO outputs from
-- different (provider × model) configs on the same op + fixture.
-- Used by ops to answer "is Claude Haiku 4.5 actually better than
-- gpt-4o-mini on summarize for long inputs?" — the pairwise signal
-- is harder to game than absolute Likert because graders compare
-- side-by-side rather than judging in isolation.
--
-- Preference enum (varchar, app-layer enforced):
--   "left"      — left config's output wins
--   "right"     — right config's output wins
--   "tie"       — both equivalent quality
--   "both_bad"  — neither acceptable (signals fixture is broken
--                  or both models are degraded for this case)
--
-- left_* and right_* are alphabetically-sorted by (provider_id,
-- model) at write time so the same pair always ends up with the
-- same orientation regardless of how the grader landed on the
-- page. Prevents (A vs B) and (B vs A) being recorded as
-- different rows. Pinned by writer + CI assertion.
--
-- Two separate Likert score columns (left_overall_score +
-- right_overall_score, 1-5) give absolute quality signal in
-- ADDITION to relative preference — e.g. "left wins" + "left=4,
-- right=2" tells a different story than "left wins" + "left=5,
-- right=4.5" (tie at top of scale vs clear preference).
--
-- UNIQUE on (golden_set_id, left_provider_id, left_model,
-- right_provider_id, right_model, op, grader_user_id) — one
-- pairwise grade per pair per op per grader. Replace path
-- handles intentional re-grading (same shape as eval_human_grades).

CREATE TABLE eval_pairwise_grades (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  golden_set_id VARCHAR(255) NOT NULL,
  op VARCHAR(64) NOT NULL,
  left_provider_id VARCHAR(64) NOT NULL,
  left_model VARCHAR(255) NOT NULL,
  right_provider_id VARCHAR(64) NOT NULL,
  right_model VARCHAR(255) NOT NULL,
  grader_user_id VARCHAR(255) NOT NULL,
  preference VARCHAR(16) NOT NULL,
  left_overall_score TINYINT NULL,
  right_overall_score TINYINT NULL,
  notes TEXT NULL,
  left_output_excerpt TEXT NULL,
  right_output_excerpt TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY eval_pairwise_grades_unique (
    golden_set_id, left_provider_id, left_model,
    right_provider_id, right_model, op, grader_user_id
  ),
  INDEX eval_pairwise_grades_pair_idx (
    op, left_provider_id, left_model,
    right_provider_id, right_model
  ),
  INDEX eval_pairwise_grades_grader_idx (grader_user_id, created_at)
);
