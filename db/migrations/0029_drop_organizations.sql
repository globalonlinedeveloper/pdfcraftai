-- Migration 0029 — drop organizations, organization_members,
-- organization_invites (2026-05-07).
--
-- Reverses migration 0025 (multi-seat foundation). Multi-seat /
-- Phase F-4 was scoped + shipped behind the MULTI_SEAT flag but
-- never activated for users. Removed at founder request as not
-- required for current product roadmap.
--
-- Pre-drop verification (run on prod 2026-05-07):
--   organizations: 0 rows
--   organization_members: 0 rows
--   organization_invites: 0 rows
-- Zero data loss.
--
-- Drop order matters even without FK cascades — children first,
-- parent last. Defensive even though migration 0025 didn't define
-- FK constraints (varchar org_id columns without REFERENCES).

DROP TABLE IF EXISTS organization_invites;
DROP TABLE IF EXISTS organization_members;
DROP TABLE IF EXISTS organizations;
