-- Column-level lockdown on profiles. RLS is row-level only — the existing
-- profiles_owner_update policy (auth.uid() = id) lets an authenticated user
-- UPDATE every column of their own row, including plan, stripe_customer_id,
-- trial_ends_at, trial_web_search_count, and the raw alpaca_access_token /
-- alpaca_refresh_token secrets. Confirmed live and exploitable from the
-- browser console: supabase.from('profiles').update({plan:'pro'})...
--
-- Client code only ever writes: monthly_budget, savings_goal, roundup_enabled,
-- watchlist, tutorial_completed, last_synced_at, push_subscription (grepped
-- src/ for every profiles.update() call site). Everything else (billing,
-- trial, plan, Alpaca tokens) must go through service-role edge functions.

REVOKE UPDATE ON public.profiles FROM authenticated, anon;

GRANT UPDATE (
  monthly_budget,
  savings_goal,
  roundup_enabled,
  watchlist,
  tutorial_completed,
  last_synced_at,
  push_subscription
) ON public.profiles TO authenticated;

-- alpaca_access_token / alpaca_refresh_token: client already never SELECTs
-- these (App.jsx's profiles query omits them; has_alpaca_token() RPC is the
-- documented access path per CLAUDE.md) — this just makes that a real DB
-- control instead of a convention a raw .select() call could bypass.
REVOKE SELECT (alpaca_access_token, alpaca_refresh_token) ON public.profiles FROM authenticated, anon;
