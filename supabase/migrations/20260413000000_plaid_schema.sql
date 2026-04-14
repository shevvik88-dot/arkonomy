-- Plaid schema: items table + plaid_transaction_id on transactions

-- ── plaid_items ─────────────────────────────────────────────────────────────
-- Stores one row per connected bank (access_token + sync cursor).
-- access_token is a Plaid secret — this table must NOT be readable by the
-- anon role. Only service-role (used by Edge Functions) can write/read it.

CREATE TABLE IF NOT EXISTS plaid_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id          TEXT        NOT NULL,
  access_token     TEXT        NOT NULL,
  institution_id   TEXT,
  institution_name TEXT,
  plaid_cursor     TEXT,                     -- transactions/sync pagination cursor
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, item_id)
);

ALTER TABLE plaid_items ENABLE ROW LEVEL SECURITY;

-- Users may only read their own rows (institution_name for the UI)
CREATE POLICY "users_read_own_plaid_items"
  ON plaid_items FOR SELECT
  USING (auth.uid() = user_id);

-- ── transactions: plaid_transaction_id ───────────────────────────────────────
-- Enables idempotent upserts from transactions/sync.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS plaid_transaction_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_plaid_tx_id_idx
  ON transactions (plaid_transaction_id)
  WHERE plaid_transaction_id IS NOT NULL;
