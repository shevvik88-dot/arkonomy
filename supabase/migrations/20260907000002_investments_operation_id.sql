-- Independent audit re-verification 2026-09-08, finding #4 / REQ-3 (full scope).
--
-- The partial index from 20260907000001 dedups only UNRESOLVED operations
-- (status IN ('pending','unknown')). It does NOT cover this case:
--
--   1. Alpaca accepts the order.
--   2. alpaca-invest writes status='accepted' and prepares HTTP 200.
--   3. The 200 never reaches the client (connection dropped after the
--      response, client crash, app backgrounded).
--   4. The client retries the SAME intentional purchase — but the request
--      only carries {amount, symbol}, and the now-'accepted' row is outside
--      the partial index. The reservation INSERT succeeds, a new row and a
--      new client_order_id are minted, and a SECOND real order is placed.
--
-- Fix: the client now generates an operation_id (UUID) for each intentional
-- purchase and reuses it on every retry of that same operation. The server
-- enforces one row per (user_id, operation_id) REGARDLESS of status, so a
-- retry after 'accepted' resolves to the original row and replays its
-- outcome instead of acting again. A new intentional purchase carries a new
-- operation_id and is unaffected.
--
-- ── ADDITIVE / BACKWARD-COMPATIBLE ──────────────────────────────────────
-- operation_id is NULLABLE and the index is PARTIAL (WHERE operation_id IS
-- NOT NULL):
--   * The currently-deployed handler and older app clients never send an
--     operation_id — their rows keep operation_id NULL, stay out of this
--     index, and fall back to the (user_id, symbol, amount) partial-index
--     behaviour from 20260907000001. No regression during rollout.
--   * A newer client hitting the older handler is also fine: the older
--     handler simply ignores the extra body field.
-- Deployment order: apply this migration, then deploy the handler, then
-- ship the client. Each step is safe against the previous state.
--
-- No RLS change: `investments` RLS is unchanged. No grant change:
-- alpaca-invest runs under the service role, which already has DML here.

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS operation_id UUID;

-- One operation per client-supplied key, for the key's whole lifetime —
-- not scoped to unresolved rows. A plain INSERT that would create a second
-- row for the same (user_id, operation_id) raises 23505; alpaca-invest
-- catches it and replays the existing operation's state.
CREATE UNIQUE INDEX IF NOT EXISTS investments_user_operation_key
  ON public.investments (user_id, operation_id)
  WHERE operation_id IS NOT NULL;
