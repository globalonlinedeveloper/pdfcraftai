-- 0022_ai_feedback.sql — thumbs ↑/↓ feedback on AI outputs
--
-- Plan ref: docs/PENDING_WORK_ANALYSIS.md §6b. AI quality currently
-- has zero subjective signal — quality is measured at the structured
-- level (JSON shape compliance, response length sanity) but no user-
-- side "this answer was bad" path exists. This table is the data
-- flywheel foundation: persist every thumbs ↑/↓ click so we can:
--   - Surface bad outputs in /admin/ai-feedback
--   - Compute per-(provider, model, operation) NPS
--   - Detect "user X got 5 thumbs-down in a row" → re-route or alert
--   - Use as eval signal for prompt registry A/B tests
--
-- New table: ai_feedback
--   Append-only audit log. One row per user click. Users can flip
--   their vote (the route handler upserts on (user_id, ai_usage_id);
--   the row stays + updated_at moves) but we never delete — flips
--   are signal.
--
-- Columns
--   id                 varchar(36)   PK (UUID v4 minted by route)
--   user_id            varchar(255)  FK → users.id (cascade delete on
--                                    GDPR/DPDP account-delete)
--   ai_usage_id        varchar(36)   FK → ai_usage.id (cascade delete
--                                    on usage rotation; we don't keep
--                                    feedback for rows we threw away)
--                                    OR NULL when feedback is on a
--                                    file-bound ai_outputs row that
--                                    pre-dates ai_usage row capture
--   file_id            varchar(36)   FK → files.id; NULL for feedback
--                                    on chat_turn (no file)
--   operation          varchar(32)   denormalized from ai_usage.operation
--                                    so /admin/ai-feedback can filter
--                                    by op without join (operation is
--                                    a free varchar in ai_usage too)
--   verdict            varchar(8)    "up" | "down" — kept as varchar
--                                    not enum so future "n/a" or
--                                    "flag" verdicts don't need ALTER
--   reason             varchar(128)  optional — when user picks a
--                                    canned reason chip ("incorrect",
--                                    "incomplete", "off-topic", etc.)
--   note               text          optional — user-typed free text
--                                    (capped at 1000 chars by zod)
--   provider_id        varchar(32)   denormalized from ai_usage so
--                                    admin "all bad outputs from
--                                    Anthropic this week" doesn't
--                                    require a join + NULL-check
--   model              varchar(128)  same — denormalized
--   created_at         timestamp(3)  click time
--   updated_at         timestamp(3)  last flip time (auto-updates on
--                                    upsert)
--
-- Indexes
--   UNIQUE (user_id, ai_usage_id)  — at-most-one feedback per
--                                    (user, ai-call) pair; the route
--                                    upserts via INSERT ... ON
--                                    DUPLICATE KEY UPDATE
--   (created_at)                   — admin "newest first" sort
--   (verdict, created_at)          — admin "show only thumbs-down"
--   (operation, created_at)        — per-op rollup (NPS by op)
--   (provider_id, model, created_at) — per-(provider, model) NPS
--
-- Rollout safety
-- --------------
-- New table only — zero existing-row impact. FKs are CASCADE on the
-- "we don't want orphans" relationships (user delete, ai_usage delete)
-- and SET NULL via app-layer logic on file_id (we don't drop files
-- without going through the GDPR export path which already touches
-- ai_outputs). All indexes built on empty table — sub-second migration.

CREATE TABLE `ai_feedback` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(255) NOT NULL,
  `ai_usage_id` varchar(36) DEFAULT NULL,
  `file_id` varchar(36) DEFAULT NULL,
  `operation` varchar(32) NOT NULL,
  `verdict` varchar(8) NOT NULL,
  `reason` varchar(128) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `provider_id` varchar(32) DEFAULT NULL,
  `model` varchar(128) DEFAULT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `ai_feedback_id` PRIMARY KEY (`id`),
  CONSTRAINT `ai_feedback_user_fk` FOREIGN KEY (`user_id`)
    REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ai_feedback_ai_usage_fk` FOREIGN KEY (`ai_usage_id`)
    REFERENCES `ai_usage`(`id`) ON DELETE CASCADE
);

-- At-most-one feedback row per (user, ai-call). Route does
-- `INSERT ... ON DUPLICATE KEY UPDATE verdict = VALUES(verdict)`
-- so a flip from up → down updates the row in place + auto-bumps
-- updated_at via the column's ON UPDATE clause.
CREATE UNIQUE INDEX `ai_feedback_user_call_uq`
  ON `ai_feedback` (`user_id`, `ai_usage_id`);

CREATE INDEX `ai_feedback_created_idx`
  ON `ai_feedback` (`created_at`);

CREATE INDEX `ai_feedback_verdict_created_idx`
  ON `ai_feedback` (`verdict`, `created_at`);

CREATE INDEX `ai_feedback_op_created_idx`
  ON `ai_feedback` (`operation`, `created_at`);

CREATE INDEX `ai_feedback_provider_model_created_idx`
  ON `ai_feedback` (`provider_id`, `model`, `created_at`);
