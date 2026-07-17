-- Baseline migration, backfilled 2026-07-17 during a full RLS audit.
--
-- `savings` predates this project's migrations folder — created outside
-- version control before migration tracking started. The earliest existing
-- migration touching this table is 20260420000000_savings_account_link.sql
-- (ADD COLUMN IF NOT EXISTS plaid_account_id/plaid_account_name — already
-- reflected below, so that ADD COLUMN stays a safe no-op on replay), and
-- 20260420000001_savings_reminders.sql has an FK to savings(id). Both
-- assume the table already exists. This file is timestamped before both
-- (and after the profiles/categories baselines, which savings' own FK
-- depends on) so a fresh replay creates tables in the right order.
-- No-op on the current live database (table already exists identically).
--
-- Columns/types/defaults/constraints captured directly from live
-- information_schema/pg_constraint, not inferred from application code.
CREATE TABLE IF NOT EXISTS savings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  target             NUMERIC DEFAULT 0,
  current            NUMERIC DEFAULT 0,
  icon               TEXT DEFAULT '🎯',
  color              TEXT DEFAULT '#00D4AA',
  created_at         TIMESTAMPTZ DEFAULT now(),
  plaid_account_id   TEXT,
  plaid_account_name TEXT
);

ALTER TABLE savings ENABLE ROW LEVEL SECURITY;

-- Legacy per-command policies — live in production, never captured in any
-- migration (only the newer consolidated "savings_owner_all" was, in
-- 20260601000000_final_qa_security.sql). Redundant but harmless (Postgres
-- ORs same-command policies) — reproduced verbatim, not redesigned.
DROP POLICY IF EXISTS "Users can view own savings" ON savings;
CREATE POLICY "Users can view own savings" ON savings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own savings" ON savings;
CREATE POLICY "Users can insert own savings" ON savings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own savings" ON savings;
CREATE POLICY "Users can update own savings" ON savings
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own savings" ON savings;
CREATE POLICY "Users can delete own savings" ON savings
  FOR DELETE USING (auth.uid() = user_id);
