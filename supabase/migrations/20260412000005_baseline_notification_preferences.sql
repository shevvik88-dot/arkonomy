-- Baseline migration, backfilled 2026-07-17 during a full RLS audit.
--
-- `notification_preferences` predates this project's migrations folder —
-- created outside version control before migration tracking started. The
-- only existing migration touching this table is
-- 20260601000000_final_qa_security.sql (enables RLS, adds the consolidated
-- notification_prefs_owner_all policy) — it assumes the table already
-- exists. This file is timestamped before it.
--
-- Columns/types/defaults/constraints captured directly from live
-- information_schema/pg_constraint, not inferred from application code.
-- Note: user_id is the PRIMARY KEY itself (one row per user), not a
-- separate id column with a user_id FK like the other 5 baselines.
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  frequency              TEXT NOT NULL DEFAULT 'weekly',
  include_spending       BOOLEAN NOT NULL DEFAULT true,
  include_balance        BOOLEAN NOT NULL DEFAULT true,
  include_upcoming_bills BOOLEAN NOT NULL DEFAULT true,
  include_ai_tip         BOOLEAN NOT NULL DEFAULT true,
  include_market_update  BOOLEAN NOT NULL DEFAULT false,
  excel_frequency        TEXT NOT NULL DEFAULT 'monthly',
  next_digest_at         TIMESTAMPTZ,
  next_excel_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Legacy per-command policies — live in production, never captured in any
-- migration (only the newer consolidated "notification_prefs_owner_all"
-- was, in 20260601000000_final_qa_security.sql). Redundant but harmless
-- (Postgres ORs same-command policies) — reproduced verbatim.
DROP POLICY IF EXISTS "notif_prefs_owner_select" ON notification_preferences;
CREATE POLICY "notif_prefs_owner_select" ON notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_prefs_owner_insert" ON notification_preferences;
CREATE POLICY "notif_prefs_owner_insert" ON notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_prefs_owner_update" ON notification_preferences;
CREATE POLICY "notif_prefs_owner_update" ON notification_preferences
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_prefs_owner_delete" ON notification_preferences;
CREATE POLICY "notif_prefs_owner_delete" ON notification_preferences
  FOR DELETE USING (auth.uid() = user_id);
