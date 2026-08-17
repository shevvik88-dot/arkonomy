-- Closes FINDING-A (SECURITY_THREAT_MODEL.md race-condition audit,
-- 2026-08-17): alpaca-invest's duplicate-order check was a SELECT-then-
-- later-INSERT with two Alpaca network calls (account fetch + order
-- placement) in between — a real TOCTOU gap. Two near-simultaneous
-- requests (e.g. a fast double-click) could both pass the SELECT before
-- either had written its row, both reach Alpaca, and both place a real
-- order.
--
-- window_bucket is populated by the app as Math.floor(Date.now() / 60_000)
-- — the exact same per-minute bucket alpaca-invest already used for
-- Alpaca's own client_order_id idempotency key, reused here rather than
-- inventing a second definition of "window". This constraint is what
-- makes the new pending-row insert (in alpaca-invest/index.ts) an atomic
-- check-and-reserve instead of a racy read-then-write.
ALTER TABLE investments ADD COLUMN window_bucket BIGINT;

ALTER TABLE investments
  ADD CONSTRAINT investments_user_symbol_amount_window_key
  UNIQUE (user_id, symbol, amount, window_bucket);

-- Also from the original FINDING-A plan: order_id uniqueness. Postgres
-- treats multiple NULLs as distinct for UNIQUE, so this doesn't affect the
-- pending row before Alpaca responds — it only guards against the same
-- real Alpaca order_id ever being written to two rows.
ALTER TABLE investments
  ADD CONSTRAINT investments_order_id_key
  UNIQUE (order_id);
