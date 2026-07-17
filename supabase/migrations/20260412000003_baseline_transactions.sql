-- Baseline migration, backfilled 2026-07-17 during a full RLS audit.
--
-- `transactions` predates this project's migrations folder — created
-- outside version control before migration tracking started. The earliest
-- existing migration touching this table is 20260413000000_plaid_schema.sql
-- (ADD COLUMN IF NOT EXISTS plaid_transaction_id + a second, partial unique
-- index transactions_plaid_tx_id_idx) — it assumes the table already
-- exists. This file is timestamped before it (and after the profiles/
-- categories baselines, which transactions' own FKs depend on).
--
-- Note on plaid_transaction_id uniqueness: live production has TWO unique
-- indexes on this column — transactions_plaid_transaction_id_key (a plain
-- UNIQUE constraint) and transactions_plaid_tx_id_idx (a partial unique
-- index, WHERE plaid_transaction_id IS NOT NULL, created by
-- 20260413000000_plaid_schema.sql). Declaring the column UNIQUE below
-- reproduces the first one under Postgres's default constraint-naming
-- convention (<table>_<column>_key) exactly; the second is left to the
-- existing migration that already creates it. Not consolidated into one —
-- reproducing production exactly, not redesigning it.
--
-- Columns/types/defaults/constraints captured directly from live
-- information_schema/pg_constraint, not inferred from application code.
CREATE TABLE IF NOT EXISTS transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES profiles(id) ON DELETE CASCADE,
  amount               NUMERIC NOT NULL,
  description          TEXT,
  category_id          UUID REFERENCES categories(id) ON DELETE SET NULL,
  category_name        TEXT,
  date                 DATE DEFAULT CURRENT_DATE,
  type                 TEXT DEFAULT 'expense' CHECK (type IN ('expense', 'income')),
  source               TEXT DEFAULT 'manual',
  created_at           TIMESTAMPTZ DEFAULT now(),
  plaid_transaction_id TEXT UNIQUE,
  account_id           TEXT,
  pending              BOOLEAN DEFAULT false,
  merchant_name        TEXT
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Legacy per-command policies — live in production, never captured in any
-- migration (only the newer consolidated "transactions_owner_all" was, in
-- 20260601000000_final_qa_security.sql). Redundant but harmless (Postgres
-- ORs same-command policies) — reproduced verbatim, not redesigned.
DROP POLICY IF EXISTS "Users can view own transactions" ON transactions;
CREATE POLICY "Users can view own transactions" ON transactions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own transactions" ON transactions;
CREATE POLICY "Users can insert own transactions" ON transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own transactions" ON transactions;
CREATE POLICY "Users can update own transactions" ON transactions
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own transactions" ON transactions;
CREATE POLICY "Users can delete own transactions" ON transactions
  FOR DELETE USING (auth.uid() = user_id);
