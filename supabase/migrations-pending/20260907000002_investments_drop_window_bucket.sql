-- Independent audit 2026-09-07, finding #4 (alpaca-invest) — PHASE B (destructive cleanup).
--
--   ┌─────────────────────────────────────────────────────────────────────┐
--   │  DO NOT APPLY YET.                                                   │
--   │  This file lives in supabase/migrations-pending/ ON PURPOSE — the    │
--   │  Supabase CLI only reads supabase/migrations/, so nothing here runs  │
--   │  on `supabase db push` / `migration up`.                            │
--   └─────────────────────────────────────────────────────────────────────┘
--
-- Prerequisite: the alpaca-invest handler shipped with PHASE A
-- (supabase/migrations/20260907000001_investments_stable_idempotency.sql)
-- must be confirmed LIVE in production and exercised (at least one real
-- order placed through it) before this is applied.
--
-- Why it is safe once that prerequisite holds:
--   * Nothing writes window_bucket any more — the new handler dropped it,
--     and it was only ever populated by alpaca-invest.
--   * The old 4-column UNIQUE `investments_user_symbol_amount_window_key`,
--     now only ever seeing NULL in window_bucket, enforces nothing
--     (Postgres treats every NULL as distinct). The PHASE A partial index
--     `investments_user_symbol_amount_open_key` is the sole pending-row
--     dedup from here on.
--
-- To apply: move this file into supabase/migrations/ (keeping the
-- timestamped filename), verify the SQL with a human per repo policy, apply
-- to a disposable/local project first, then production.

ALTER TABLE public.investments
  DROP CONSTRAINT IF EXISTS investments_user_symbol_amount_window_key;

ALTER TABLE public.investments
  DROP COLUMN IF EXISTS window_bucket;
