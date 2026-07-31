-- Fix for the previous migration's SELECT restriction: column-level REVOKE
-- cannot subtract a column from an existing TABLE-level SELECT grant in
-- Postgres (attacl stayed null — confirmed via pg_attribute after the first
-- attempt, and via a live PostgREST call that still returned the token).
-- Correct pattern: revoke SELECT at the table level, then re-grant it
-- explicitly on every column except the two secrets.

REVOKE SELECT ON public.profiles FROM authenticated, anon;

GRANT SELECT (
  id, email, full_name, avatar_url, monthly_budget, savings_goal,
  roundup_enabled, created_at, plan, push_subscription, watchlist,
  stripe_customer_id, tutorial_completed, last_synced_at, trial_ends_at,
  trial_web_search_count, alpaca_account_id, alpaca_connected_at,
  last_balance_refresh_at
) ON public.profiles TO authenticated;
