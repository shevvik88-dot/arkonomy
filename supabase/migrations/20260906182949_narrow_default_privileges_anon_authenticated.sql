-- BACKLOG.md #22b — narrow ALTER DEFAULT PRIVILEGES so a FUTURE public table
-- or sequence is NOT automatically full-DML-accessible to anon/authenticated.
--
-- Context: the standard Supabase bootstrap ran, for BOTH the `postgres` and
-- `supabase_admin` roles,
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON TABLES/SEQUENCES/FUNCTIONS TO postgres, anon, authenticated, service_role;
-- Net effect before this migration: every new table a migration creates is
-- readable+writable by any authenticated user across all rows unless RLS is
-- enabled AND correctly scoped — the table-level GRANT is implicit and never
-- visible in the CREATE TABLE migration. Same silent-over-exposure class as
-- the "tables with no policy" findings in BACKLOG #13. Not one of the 19
-- existing public tables carries an explicit `GRANT ... TO authenticated` in
-- migration history — every one relies on this implicit default plus RLS.
--
-- Pre-flight verified on prod (hvnkxxazjfesbxdkzuba) 2026-09-06 via
-- pg_default_acl / pg_tables / pg_has_role:
--   * all 19 existing public tables are owned by `postgres`;
--   * migrations (this one included) run as current_user = session_user =
--     `postgres`, so `FOR ROLE postgres` is the entry that governs every
--     future CREATE TABLE in this repo;
--   * `postgres` is NOT a member of `supabase_admin`, so the parallel
--     `supabase_admin` default-ACL entry cannot be altered from a migration
--     (permission denied). It is left as a documented residual: it would
--     only ever apply to a table created directly AS supabase_admin, which
--     has never happened here (0/19 tables) and is not part of any workflow
--     (CLI `db push`, `db reset`, and the Studio SQL editor all run as
--     `postgres`).
--
-- Scope: TABLES + SEQUENCES only. ROUTINES/FUNCTIONS are deliberately NOT
-- touched — Postgres grants EXECUTE to PUBLIC on every new function
-- regardless of ALTER DEFAULT PRIVILEGES, so a REVOKE here would be an
-- incomplete half-measure. The project already does a targeted
-- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` per sensitive RPC,
-- and has_alpaca_token() (the only client-called RPC) intentionally relies
-- on the default PUBLIC execute (see 20260717000001).
--
-- Does NOT affect the 19 existing tables: ALTER DEFAULT PRIVILEGES only
-- applies at CREATE time; their ACLs are already materialized in
-- pg_class.relacl. Production behavior and a fresh `supabase db reset` of
-- the current migration set are both unchanged. The only new rule this
-- introduces: every FUTURE client-facing table's migration must issue its
-- own explicit GRANT ... TO authenticated (column-scoped, per the profiles
-- pattern in 20260730000000 / 20260730000001). A forgotten GRANT now fails
-- loudly (PostgREST "permission denied for table X") instead of silently
-- over-exposing the table.
--
-- Idempotent: re-running REVOKE on an already-revoked default privilege is a
-- no-op and never errors (same rationale as 20260904000000's GRANTs).

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
