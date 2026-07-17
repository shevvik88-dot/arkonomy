-- Baseline migration, backfilled 2026-07-17 during a full RLS audit.
--
-- `profiles` predates this project's migrations folder — it was created
-- outside version control (Supabase Studio) before migration tracking
-- started, so no CREATE TABLE for it existed anywhere. The earliest real
-- migration (20260412063904_add_push_subscription.sql) already assumes
-- `profiles` exists (`ALTER TABLE profiles ADD COLUMN ...`), so this file
-- is deliberately timestamped BEFORE it — on a fresh `supabase db reset`
-- replay, migrations apply in filename order, so this must run first.
-- On the current live database CREATE TABLE IF NOT EXISTS is a no-op
-- (the table already exists) — this is purely a replay-correctness fix,
-- not a schema change.
--
-- Columns/types/defaults captured directly from live information_schema,
-- not inferred from application code.
CREATE TABLE IF NOT EXISTS profiles (
  id                     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                  TEXT,
  full_name              TEXT,
  avatar_url             TEXT,
  monthly_budget         NUMERIC DEFAULT 3000,
  savings_goal           NUMERIC DEFAULT 10000,
  roundup_enabled        BOOLEAN DEFAULT true,
  created_at             TIMESTAMPTZ DEFAULT now(),
  plan                   TEXT DEFAULT 'free',
  push_subscription      JSONB,
  watchlist              JSONB DEFAULT '["SPY", "QQQ", "BTC", "ETH"]'::jsonb,
  stripe_customer_id     TEXT,
  tutorial_completed     BOOLEAN NOT NULL DEFAULT false,
  last_synced_at         TIMESTAMPTZ,
  trial_ends_at          TIMESTAMPTZ,
  trial_web_search_count INTEGER NOT NULL DEFAULT 0,
  alpaca_access_token    TEXT,
  alpaca_refresh_token   TEXT,
  alpaca_account_id      TEXT,
  alpaca_connected_at    TIMESTAMPTZ
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policies are NOT recreated here — profiles_owner_select/profiles_owner_update
-- are already correctly tracked in 20260423000000_profiles_last_synced_rls.sql
-- and re-asserted in 20260531000000_fix_rls_token_exposure.sql. Only the
-- CREATE TABLE itself was missing.
