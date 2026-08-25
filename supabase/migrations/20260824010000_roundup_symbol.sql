-- Spare Change Investing: lets a user pick which asset round-ups buy,
-- instead of the SPY-only hardcode in App.jsx's investAlpaca(). Existing
-- rows get 'SPY' via the column DEFAULT below — zero action needed from
-- current users, identical behavior to today.
--
-- Format constraint mirrors alpaca-invest's own client-side regex
-- (/^[A-Z]{1,5}$/, supabase/functions/alpaca-invest/index.ts) — defense-
-- in-depth at the DB layer, not a replacement for that check (alpaca-invest
-- still validates independently before ever calling Alpaca).
ALTER TABLE public.profiles
  ADD COLUMN roundup_symbol TEXT NOT NULL DEFAULT 'SPY'
  CHECK (roundup_symbol ~ '^[A-Z]{1,5}$');

-- profiles has column-level GRANT allow-lists (20260730000000 +
-- 20260730000001, added after a live exploit let any authenticated user
-- UPDATE plan/stripe_customer_id on their own row via raw RLS) — a new
-- column is neither selectable nor updatable by the client until it's
-- explicitly listed here; GRANT is not additive per-column in Postgres, so
-- the full list must be re-issued each time, not just the new column.
--
-- Lists below verified directly against the live DB right before writing
-- this migration (information_schema.column_privileges), not copied from
-- the prior migration files — confirming they still matched before adding
-- roundup_symbol to each.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (
  last_synced_at,
  monthly_budget,
  push_subscription,
  roundup_enabled,
  roundup_symbol,
  savings_goal,
  tutorial_completed,
  watchlist
) ON public.profiles TO authenticated;

REVOKE SELECT ON public.profiles FROM authenticated, anon;
GRANT SELECT (
  alpaca_account_id,
  alpaca_connected_at,
  avatar_url,
  created_at,
  email,
  full_name,
  id,
  last_balance_refresh_at,
  last_synced_at,
  monthly_budget,
  plan,
  push_subscription,
  roundup_enabled,
  roundup_symbol,
  savings_goal,
  stripe_customer_id,
  trial_ends_at,
  trial_web_search_count,
  tutorial_completed,
  watchlist
) ON public.profiles TO authenticated;
