-- 0006_ai_daily_margin.sql
-- Phase A4 (MASTER_PLAN §7 gate #7 / task #22). Daily margin rollup table.
-- Schema companion to db/schema/app.ts → aiDailyMargin.
--
-- Why this table exists
-- ---------------------
-- ai_usage (0005) records every AI call individually, which is great for
-- per-call auditing but poor for trend analysis: a 7-day "was every slice
-- green?" query over millions of rows would be an O(n) table scan every
-- time. This table is the daily aggregate — one row per
-- (date, provider_id, model, operation) slice — so the green-streak query
-- becomes a cheap range scan over at most a few hundred rows per day.
--
-- Gate #7 closes when this table shows 7 consecutive days where EVERY
-- slice has `is_green = 1` (margin_bps >= floor_bps). A single red slice
-- resets the streak counter. The per-op floors live in
-- lib/ai/margin-rollup.ts (OP_MARGIN_FLOOR_BPS).
--
-- Columns
-- -------
--   id                   UUID — PK, so duplicate/retry inserts can be
--                        distinguished in the journal even though the
--                        business-key uniqueness is enforced on
--                        (date, provider_id, model, operation) below.
--   date                 Date — the day being summarised, in UTC. Stored
--                        as MySQL DATE (not DATETIME) to make dedup on
--                        the uniqueness constraint predictable across
--                        re-runs of the same day.
--   provider_id          AI provider that handled the slice (anthropic,
--                        openai, gemini, …). Matches ai_usage.provider_id.
--   model                Concrete model identifier (e.g. gpt-4o-mini,
--                        claude-sonnet-4-20250514).
--   operation            AIOperationId from lib/pricing.ts (free varchar —
--                        see 0005 for why we don't enum it).
--   call_count           Total number of ai_usage rows that rolled up into
--                        this slice.
--   success_count        Subset where success = 1.
--   error_count          call_count − success_count. Duplicated for
--                        monitoring-friendly queries (so the margin-flip
--                        dashboard can show "N errors contributed Y
--                        micros of cost with zero revenue").
--   input_tokens_sum,    Sum over the slice. bigint because a single
--   output_tokens_sum,   high-volume day can exceed int32 range in token
--   latency_ms_sum,      counts or micro-dollars.
--   credits_spent_sum,
--   cost_micros_sum,
--   revenue_micros_sum
--   margin_bps           (revenue - cost) / revenue * 10_000 clamped to
--                        [-10_000, +10_000]. Negative = cost exceeded
--                        revenue (red slice). Stored so downstream
--                        dashboards don't re-derive it. If
--                        revenue_micros_sum = 0 (zero-revenue slice, e.g.
--                        all errors), margin_bps = -10_000 by convention
--                        to make the slice unambiguously red.
--   floor_bps            The per-op minimum margin at time of rollup.
--                        Stored alongside so historical rows stay
--                        interpretable when the floor changes.
--   is_green             1 if margin_bps >= floor_bps, else 0. Computed
--                        once at rollup time so the green-streak query
--                        is an indexed boolean scan.
--   created_at           When this row was written (not the day being
--                        summarised — that's `date`).
--
-- Uniqueness
-- ----------
-- UNIQUE(date, provider_id, model, operation) lets the rollup cron safely
-- re-run the same day. ON DUPLICATE KEY UPDATE in lib/ai/margin-rollup.ts
-- overwrites the existing slice rather than inserting a new one, so
-- re-running after a partial-day backfill is idempotent.

CREATE TABLE IF NOT EXISTS `ai_daily_margin` (
  `id` varchar(36) NOT NULL,
  `date` date NOT NULL,
  `provider_id` varchar(32) NOT NULL,
  `model` varchar(128) NOT NULL,
  `operation` varchar(32) NOT NULL,
  `call_count` int NOT NULL DEFAULT 0,
  `success_count` int NOT NULL DEFAULT 0,
  `error_count` int NOT NULL DEFAULT 0,
  `input_tokens_sum` bigint NOT NULL DEFAULT 0,
  `output_tokens_sum` bigint NOT NULL DEFAULT 0,
  `latency_ms_sum` bigint NOT NULL DEFAULT 0,
  `credits_spent_sum` bigint NOT NULL DEFAULT 0,
  `cost_micros_sum` bigint NOT NULL DEFAULT 0,
  `revenue_micros_sum` bigint NOT NULL DEFAULT 0,
  `margin_bps` int NOT NULL,
  `floor_bps` int NOT NULL,
  `is_green` int NOT NULL DEFAULT 0,
  `created_at` timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
  CONSTRAINT `ai_daily_margin_id` PRIMARY KEY(`id`),
  CONSTRAINT `ai_daily_margin_slice_idx` UNIQUE(`date`, `provider_id`, `model`, `operation`)
);
--> statement-breakpoint
CREATE INDEX `ai_daily_margin_date_idx` ON `ai_daily_margin` (`date`);
--> statement-breakpoint
CREATE INDEX `ai_daily_margin_date_green_idx` ON `ai_daily_margin` (`date`, `is_green`);
--> statement-breakpoint
CREATE INDEX `ai_daily_margin_provider_date_idx` ON `ai_daily_margin` (`provider_id`, `date`);
