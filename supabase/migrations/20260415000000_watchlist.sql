-- supabase/migrations/20260415000000_watchlist.sql
-- Adds watchlist column to profiles for the Markets & Investing screen.
-- Stores an ordered JSON array of ticker symbols, e.g. ["SPY","QQQ","BTC","ETH"]

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS watchlist JSONB
    DEFAULT '["SPY","QQQ","BTC","ETH"]'::jsonb;
