-- Alpaca OAuth tokens per user
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS alpaca_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS alpaca_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS alpaca_account_id    TEXT,
  ADD COLUMN IF NOT EXISTS alpaca_connected_at  TIMESTAMPTZ;
