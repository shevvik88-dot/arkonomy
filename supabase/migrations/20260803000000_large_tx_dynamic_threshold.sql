-- supabase/migrations/20260803000000_large_tx_dynamic_threshold.sql
--
-- Caches the per-user dynamic large-transaction threshold (mean + 2*stddev
-- of 90-day non-recurring expenses, floored at $200, falls back to $500 for
-- users without enough history) so large-transaction-alert doesn't re-run
-- the aggregate stats query on every 4-hourly scan — only when the cache is
-- older than 24h (see getOrRefreshThreshold in the function).

ALTER TABLE public.notification_preferences
  ADD COLUMN large_tx_threshold NUMERIC(10,2),
  ADD COLUMN large_tx_threshold_computed_at TIMESTAMPTZ;
