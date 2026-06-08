-- 0032_users_low_credit_notice.sql
-- Lifecycle batch 8 / backlog D33 — low-credit nudge re-arm flag.
--
-- Background
-- ----------
-- The low-credit nudge emails a user once when their balance drops
-- BELOW the configured threshold (LOW_CREDIT_THRESHOLD, default 50)
-- crossing down from at/above it — i.e. a purchaser who is drawing
-- their pack down, not a free-trial user who starts at 5. To send it
-- exactly once per "ran low" episode (and to re-arm after a top-up) we
-- need a single nullable timestamp:
--
--   - SET to NOW(3) when we send the nudge (claim, scoped to
--     `low_credit_notified_at IS NULL` so concurrent spends can't
--     double-send).
--   - CLEARED back to NULL when a grant pushes the balance at/above
--     the threshold again (re-arm), so the next draw-down can nudge.
--
-- Additive, nullable, no default, no index — pure metadata ALTER, zero
-- downtime. Pre-migration rows read NULL = "never nudged / armed",
-- which is the correct initial posture for every existing user.
--
-- Rollback (if ever needed):
--   ALTER TABLE `users` DROP COLUMN `low_credit_notified_at`;

ALTER TABLE `users`
  ADD COLUMN `low_credit_notified_at` timestamp(3) NULL AFTER `email_normalized`;
