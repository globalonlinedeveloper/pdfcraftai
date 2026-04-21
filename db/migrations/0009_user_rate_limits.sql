-- 0009_user_rate_limits.sql
-- Phase A / Task #12 — per-user daily cost ceiling + kill switches.
--
-- Background
-- ----------
-- The Net Margin plan mandates two kinds of spend circuit-breakers:
--
--   1. Operator-flipped kill switches (handled in code, no DB needed —
--      see `lib/ai/kill-switches.ts` reading `AI_KILL_{PROVIDER|OP}` env
--      vars).
--
--   2. Per-user daily cost ceiling. A user who hits the ceiling stops
--      being served for the rest of the UTC day with a 429 response.
--      Default cap is configurable via `USER_DAILY_COST_MICROS_CAP` env
--      (initial production value: 500000 µUSD = $0.50/user/day, tight
--      enough to catch runaway loops during rollout but loose enough
--      that a normal power user never trips it).
--
-- Why a new table, not another column on users
-- --------------------------------------------
-- Most users never need a custom cap — they're served under the global
-- env default forever. Adding a nullable `daily_cost_cap_micros` to the
-- `user` table would bloat every row with NULL for the 99%+ case and
-- force a schema change in an auth-sourced table (NextAuth owns that
-- shape; touching it means more surface area to get wrong on NextAuth
-- upgrades). A side table keyed on userId with rows only for the
-- overridden subset keeps the hot-path table narrow.
--
-- What the cap enforcement does
-- -----------------------------
-- `lib/ai/rate-limit.ts → checkUserDailyCost(userId)`:
--   1. Compute today's UTC window (00:00:00 → 24:00:00).
--   2. `SELECT COALESCE(SUM(cost_micros), 0) FROM ai_usage
--        WHERE user_id = ? AND created_at >= ? AND created_at < ?`
--   3. Look up this row's `daily_cost_cap_micros` override; fall back to
--      `process.env.USER_DAILY_COST_MICROS_CAP`.
--   4. If sum >= cap, throw `DailyCostCeilingExceededError`. Route
--      handler catches + returns 429 with `Retry-After: <seconds until
--      00:00 UTC>`.
--
-- The check runs BEFORE `spendCredits` in every op route handler, so a
-- capped user never burns credits on a call we were going to refuse
-- anyway.
--
-- Schema
-- ------
--   user_id                     varchar(255) PK → users.id ON DELETE CASCADE
--   daily_cost_cap_micros       bigint NOT NULL
--                                 (USD × 1e6 — same units as ai_usage.cost_micros)
--   notes                       varchar(256) NULL
--                                 (free-form operator note: "raised for enterprise pilot",
--                                  "temp block pending fraud review", etc.)
--   created_at                  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
--   updated_at                  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
--                                 ON UPDATE CURRENT_TIMESTAMP(3)
--
-- Single-row-per-user is enforced by the PK. Operator mutations happen
-- via admin SQL (Task #25 will add a proper /admin surface with audit
-- logging — that's Phase D work). For Task #12 the table is read-only
-- from the app and the admin UI shows the global env cap + per-user
-- override count.
--
-- Rollout safety
-- --------------
-- Empty table on creation → every user reads the env default, same
-- behavior as today (no caps enforced pre-migration). Zero write
-- amplification. The cap check's SELECT against ai_usage uses the
-- existing (user_id, created_at) index so the added per-request cost
-- is one indexed SUM aggregate.

CREATE TABLE `user_rate_limits` (
  `user_id` varchar(255) NOT NULL,
  `daily_cost_cap_micros` bigint NOT NULL,
  `notes` varchar(256) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_rate_limits_user_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
