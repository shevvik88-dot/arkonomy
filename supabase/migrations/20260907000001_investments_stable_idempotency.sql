-- Independent audit 2026-09-07, finding #4 (alpaca-invest) — PHASE A (additive, backward-compatible).
--
-- Root cause: alpaca-invest keyed BOTH the pending-row dedup constraint and
-- Alpaca's client_order_id off a per-minute window_bucket. A retry that
-- landed in a different calendar minute got a fresh client_order_id, so
-- Alpaca's own client_order_id dedup couldn't catch it; combined with the
-- order-placement catch deleting the pending row on ANY failure (including a
-- network error where Alpaca may already have accepted the order), a retry
-- after an ambiguous outcome could place a second real order.
--
-- Fix (alpaca-invest/index.ts): investments.id — a stable UUID for the
-- row's whole lifetime — is now the Alpaca client_order_id, and the dedup
-- key becomes a PARTIAL unique index over UNRESOLVED rows only
-- (status IN ('pending','unknown')). Once an operation reaches a terminal
-- status it falls outside the index, so a brand-new intentional purchase of
-- the same (symbol, amount) later is never blocked.
--
-- ── PHASED ROLLOUT ────────────────────────────────────────────────────────
-- This migration is ADDITIVE ONLY. It deliberately does NOT drop the old
-- `window_bucket` column or its constraint
-- `investments_user_symbol_amount_window_key`:
--
--   * The currently-deployed handler still writes window_bucket and relies
--     on that 4-column UNIQUE. Dropping either before the new handler is
--     live in production would break in-flight order placement.
--   * window_bucket is NULLABLE with no default, so the NEW handler (which
--     stops populating it) inserts fine while the column still exists, and
--     the old 4-column UNIQUE — now only ever seeing NULL in its last
--     column — stops constraining new rows without erroring (Postgres
--     treats every NULL as distinct). The new partial index below is what
--     actually enforces dedup from here on.
--
-- The DROPs are staged in a SEPARATE, NOT-YET-APPLIED migration:
--   supabase/migrations-pending/20260907000002_investments_drop_window_bucket.sql
-- Move it into supabase/migrations/ and apply it only AFTER the new
-- alpaca-invest handler is confirmed live in production and exercised.
--
-- ── PRE-EXISTING-DATA GUARD ───────────────────────────────────────────────
-- The old 4-column UNIQUE permitted two unresolved rows for the same
-- (user_id, symbol, amount) as long as their window_bucket differed (e.g. a
-- user retrying the same buy a minute later while the first was still
-- pending). If any such pair exists when this runs, CREATE UNIQUE INDEX
-- would abort the whole migration. Fail loudly first, naming the exact
-- offending keys, so a human resolves them (mark the stale pending/unknown
-- rows terminal) before re-running — a migration must never silently mutate
-- investment rows.

DO $$
DECLARE
  dup   RECORD;
  found BOOLEAN := FALSE;
BEGIN
  -- Idempotent re-run: if the index already exists there is nothing to check.
  IF to_regclass('public.investments_user_symbol_amount_open_key') IS NOT NULL THEN
    RETURN;
  END IF;

  FOR dup IN
    SELECT user_id, symbol, amount, count(*) AS n
    FROM public.investments
    WHERE status IN ('pending', 'unknown')
    GROUP BY user_id, symbol, amount
    HAVING count(*) > 1
  LOOP
    found := TRUE;
    RAISE WARNING 'investments idempotency conflict: user_id=% symbol=% amount=% has % unresolved rows',
      dup.user_id, dup.symbol, dup.amount, dup.n;
  END LOOP;

  IF found THEN
    RAISE EXCEPTION
      'Cannot create investments_user_symbol_amount_open_key: unresolved-row duplicates exist (see WARNINGs above). Resolve the stale pending/unknown rows, then re-run.';
  END IF;
END $$;

-- Replacement dedup key: at most one UNRESOLVED (pending or unknown-outcome)
-- operation per (user, symbol, amount) at a time. alpaca-invest's pending-
-- row insert targets this via a plain INSERT (Postgres raises the same 23505
-- for a partial unique index as for a full constraint), so the app code
-- doesn't need ON CONFLICT to detect it.
--
-- No RLS change needed: `investments` RLS is unchanged, and this is an index
-- not a policy. No grant change needed: alpaca-invest runs under the service
-- role, which already has DML on the table in production.
CREATE UNIQUE INDEX IF NOT EXISTS investments_user_symbol_amount_open_key
  ON public.investments (user_id, symbol, amount)
  WHERE status IN ('pending', 'unknown');
