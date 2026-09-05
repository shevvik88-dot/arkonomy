-- Test-only compensating grants.
--
-- On a fresh `supabase db reset`, service_role has NO SELECT/INSERT/UPDATE/
-- DELETE on the public tables — only postgres (the migration role) does. The
-- production database has the standard Supabase
--   GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role
-- applied out-of-band (Studio, pre-migrations), and every migration since —
-- including the 20260730 column-level REVOKE/GRANT pair on profiles — assumes
-- it. It is never re-asserted in a migration, so a from-scratch replay
-- produces a database where PostgREST and the service-role edge functions
-- cannot touch these tables at all.
--
-- That is a real replay-correctness gap in the migrations (same class as the
-- plaid_items unique-constraint fix), tracked separately — see README.md.
-- This file only makes the local edge-function tests runnable; it grants the
-- minimum the harness needs (service_role DML) and deliberately does NOT
-- re-widen authenticated/anon, so the column-level lockdown those migrations
-- add stays intact.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;
