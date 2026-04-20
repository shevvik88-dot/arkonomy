-- Link savings goals to a specific Plaid bank account.
-- plaid_account_id  — the Plaid account_id string (e.g. "BxBXbv3vMDTmjpEAZe5g")
-- plaid_account_name — human-readable label stored at goal-creation time
--                      (e.g. "Checking ••••1234") so we can display it even
--                      if the Plaid item is later disconnected.
ALTER TABLE savings
  ADD COLUMN IF NOT EXISTS plaid_account_id   TEXT,
  ADD COLUMN IF NOT EXISTS plaid_account_name TEXT;
