-- Baseline migration, backfilled 2026-07-17 during a full RLS audit.
--
-- `categories` predates this project's migrations folder — created outside
-- version control before migration tracking started. The only existing
-- migration touching this table is 20260601000000_final_qa_security.sql
-- (enables RLS, adds the consolidated categories_owner_all policy) — it
-- assumes the table already exists. This file is timestamped before it so
-- a fresh replay creates the table first. No-op on the current live
-- database (table already exists identically).
--
-- Columns/types/defaults/constraints captured directly from live
-- information_schema/pg_constraint, not inferred from application code.
CREATE TABLE IF NOT EXISTS categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  icon       TEXT,
  color      TEXT,
  budget     NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Legacy per-command policies — live in production, never captured in any
-- migration (only the newer consolidated "categories_owner_all" was, in
-- 20260601000000_final_qa_security.sql). Redundant with categories_owner_all
-- but harmless (Postgres ORs same-command policies) — recreated here
-- verbatim rather than dropped, to reproduce production exactly, not to
-- redesign it. DROP POLICY IF EXISTS first for idempotent re-runs.
DROP POLICY IF EXISTS "Users can view own categories" ON categories;
CREATE POLICY "Users can view own categories" ON categories
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own categories" ON categories;
CREATE POLICY "Users can insert own categories" ON categories
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own categories" ON categories;
CREATE POLICY "Users can update own categories" ON categories
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own categories" ON categories;
CREATE POLICY "Users can delete own categories" ON categories
  FOR DELETE USING (auth.uid() = user_id);
