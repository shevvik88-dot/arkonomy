-- Independent audit 2026-09-07, finding #4 (alpaca-invest): the per-minute
-- window_bucket used both for the pending-row dedup constraint and for
-- Alpaca's client_order_id meant a retry that landed in a different
-- calendar minute got a brand new client_order_id — Alpaca's own dedup
-- (client_order_id) couldn't catch it. Combined with the order-placement
-- catch block deleting the pending row on ANY failure, including a network
-- error where Alpaca may have already accepted the order, a retry after an
-- ambiguous network outcome could place a second real order.
--
-- window_bucket is retired — no longer populated by alpaca-invest/index.ts.
-- Postgres UNIQUE treats every NULL as distinct, so leaving the old
-- 4-column constraint in place unpopulated would silently stop enforcing
-- anything; drop it and the column together.
ALTER TABLE investments DROP CONSTRAINT IF EXISTS investments_user_symbol_amount_window_key;
ALTER TABLE investments DROP COLUMN IF EXISTS window_bucket;

-- Replacement: at most one UNRESOLVED (pending or unknown-outcome)
-- operation per (user, symbol, amount) at a time. alpaca-invest's pending-
-- row insert targets this via a plain INSERT (Postgres raises the same
-- 23505 as a full unique constraint on a partial one), so the app code
-- doesn't need ON CONFLICT to detect it.
--
-- Scoping to non-terminal statuses (not the full row) is what makes "a new
-- intentional purchase must remain possible" work: once a prior operation
-- for the same (user, symbol, amount) reaches a terminal status —
-- 'accepted'/whatever Alpaca's real order status ends up as, or 'failed'
-- for a confirmed rejection — it falls outside this index and no longer
-- blocks a brand new purchase of the same amount+symbol later. No stable
-- client_order_id column is needed either: investments.id (already a
-- stable UUID for the row's whole lifecycle) is what alpaca-invest now
-- sends as the Alpaca client_order_id.
CREATE UNIQUE INDEX IF NOT EXISTS investments_user_symbol_amount_open_key
  ON investments (user_id, symbol, amount)
  WHERE status IN ('pending', 'unknown');
