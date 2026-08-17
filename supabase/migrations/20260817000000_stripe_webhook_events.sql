-- Closes FINDING-B (SECURITY_THREAT_MODEL.md / race-condition audit,
-- 2026-08-17): stripe-webhook had no event_id dedup, so a Stripe retry
-- (or manual dashboard resend) of checkout.session.completed would
-- recompute trial_ends_at = now() + 7 days on every redelivery, silently
-- extending a user's trial indefinitely with zero attacker action needed.
--
-- Standard idempotency-key-table pattern: insert event_id first, before
-- any side effect; a PRIMARY KEY conflict means this event was already
-- processed, so the handler can short-circuit.
--
-- No client-facing RLS policies — same pattern as oauth_nonces/plaid_items:
-- only the service-role stripe-webhook function ever touches this table.
CREATE TABLE public.stripe_webhook_events (
  event_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
