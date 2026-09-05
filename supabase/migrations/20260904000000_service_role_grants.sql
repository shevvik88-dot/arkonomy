-- Codifies the service_role grants that currently exist only as manual,
-- out-of-band prod state (applied once via Studio/CLI before this project
-- had a migrations folder, per BACKLOG.md #22). Confirmed live via
-- information_schema.role_table_grants / role_routine_grants / pg_sequences
-- on 2026-09-04: service_role already has the full ALL-privileges set below
-- on every one of the 19 public tables and all 11 routines (public schema
-- currently has zero sequences — every table uses a UUID default, not
-- serial/identity — the sequence lines are included anyway so a future
-- table with one isn't silently missed the same way).
--
-- On a from-scratch `supabase db reset`, only the migration role (postgres)
-- has DML on these tables — service_role gets none of it, because it was
-- never re-asserted in a migration. Every service-role edge function
-- (webhooks, cron jobs, admin resync) would fail with "permission denied"
-- on a disaster-recovery restore or a fresh environment. This is the same
-- class of replay-correctness gap as 20260413000002_plaid_items_unique.sql,
-- just at the grant level instead of the constraint level.
--
-- Deliberately scoped to service_role only. GRANT/REVOKE and
-- ALTER DEFAULT PRIVILEGES are per-role and strictly additive for the role
-- named — this cannot touch anon/authenticated's existing privileges, so it
-- cannot re-widen the column-level lockdown on profiles from
-- 20260730000000_profiles_column_grants.sql /
-- 20260730000001_profiles_select_column_grants_fix.sql (verified after
-- applying, see PR description).
--
-- No existence-check/IF NOT EXISTS wrapper (unlike the plaid_items
-- constraint fix): GRANT, REVOKE, and ALTER DEFAULT PRIVILEGES are already
-- idempotent in Postgres — re-running them changes no state and never
-- errors, whether run once, twice, or (as on prod, where the equivalent
-- grant already exists) redundantly. The IF NOT EXISTS pattern is only
-- needed for DDL that errors on a duplicate name, like ADD CONSTRAINT.

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;
