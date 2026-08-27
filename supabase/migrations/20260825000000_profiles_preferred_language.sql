-- App.jsx already referenced profiles.preferred_language (select at load,
-- update from the globe/language picker) but the column never existed —
-- confirmed via information_schema.columns against the live DB. The SELECT
-- silently returned undefined (column not even in the select() list either)
-- and the UPDATE silently failed (fire-and-forget, no await/error handling,
-- and would have additionally been rejected by the column-level GRANT
-- allow-list below even once the column existed). Net effect: a user's
-- language choice never persisted server-side, only in that browser's
-- localStorage — root cause of AI chat replying in the wrong language after
-- a cache clear / new device (see ai-chat language-matching investigation,
-- 2026-08-25).
--
-- Nullable, no default: NULL means "user has never explicitly chosen" —
-- distinct from an explicit 'en' choice, so client-side fallback logic
-- (browser-locale detection) can tell the two apart.
ALTER TABLE public.profiles
  ADD COLUMN preferred_language TEXT
  CHECK (preferred_language IS NULL OR preferred_language IN ('en', 'ru', 'es', 'pt'));

-- profiles has column-level GRANT allow-lists (20260730000000 +
-- 20260730000001) — a new column is neither selectable nor updatable by the
-- client until it's explicitly listed here; GRANT is not additive
-- per-column in Postgres, so the full list must be re-issued each time.
--
-- Lists below verified directly against the live DB right before writing
-- this migration (information_schema.column_privileges), matched the prior
-- migration (20260824010000_roundup_symbol.sql) exactly before adding
-- preferred_language to each.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (
  last_synced_at,
  monthly_budget,
  preferred_language,
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
  preferred_language,
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
