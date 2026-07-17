-- Baseline migration, backfilled 2026-07-17 during a full RLS audit.
--
-- `investments` predates this project's migrations folder — created
-- outside version control before migration tracking started. This is the
-- table the original audit finding named explicitly: the only existing
-- migration referencing it is 20260531000000_fix_rls_token_exposure.sql,
-- and it's defensive — wrapped in `IF EXISTS (SELECT FROM pg_tables ...)`,
-- meaning it was written already assuming the table might not exist. This
-- file supplies the actual CREATE TABLE, timestamped before it.
--
-- Columns/types/defaults/constraints captured directly from live
-- information_schema/pg_constraint, not inferred from application code.
-- Note: user_id here references auth.users(id) directly (no ON DELETE
-- clause), unlike categories/savings/transactions which reference
-- profiles(id) ON DELETE CASCADE — reproducing what's actually live,
-- not normalizing it to match the other tables.
CREATE TABLE IF NOT EXISTS investments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id),
  symbol     TEXT NOT NULL,
  amount     NUMERIC NOT NULL,
  order_id   TEXT,
  status     TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE investments ENABLE ROW LEVEL SECURITY;

-- Legacy per-command policies — live in production, never captured in any
-- migration (only investments_owner_select/investments_owner_insert were,
-- conditionally, in 20260531000000_fix_rls_token_exposure.sql). No
-- UPDATE/DELETE policy either here or there — append-only by design,
-- confirmed: inserts/deletes only happen server-side via service role
-- (alpaca-invest, delete-account), never a client UPDATE.
DROP POLICY IF EXISTS "Users can view own investments" ON investments;
CREATE POLICY "Users can view own investments" ON investments
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own investments" ON investments;
CREATE POLICY "Users can insert own investments" ON investments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
