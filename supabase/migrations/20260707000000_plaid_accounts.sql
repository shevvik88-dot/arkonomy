-- plaid_accounts: real Plaid account balances, persisted per account (not per item).
-- One Item can hold multiple accounts (checking/savings/credit); multi-bank support
-- means a user can have multiple Items too — this table lets consumers aggregate
-- real cash across all depository accounts of all Items for a user.
--
-- No SELECT policy for anon/authenticated — same posture as plaid_items
-- (see CLAUDE.md: "Never add a SELECT policy back"). Read only via service-role
-- from Edge Functions (get-insights, plaid-get-accounts, weekly-report, etc).

CREATE TABLE IF NOT EXISTS plaid_accounts (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id            UUID        NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
  account_id         TEXT        NOT NULL,
  name               TEXT,
  official_name      TEXT,
  mask               TEXT,
  type               TEXT,
  subtype            TEXT,
  balance_current    NUMERIC,
  balance_available  NUMERIC,
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id)
);

ALTER TABLE plaid_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS plaid_accounts_user_idx ON plaid_accounts (user_id);
