-- Closes the gap independent-audit finding #2 identified in FINDING-B's
-- original fix (20260817000000_stripe_webhook_events.sql): the dedup
-- table only recorded THAT an event_id had been seen, not whether its
-- side effect actually completed. A DB write failure between the dedup
-- insert and the profile update left the row inserted but the effect
-- unapplied — Stripe's retry of the same event.id then short-circuited on
-- the dedup row and never reapplied anything.
--
-- 'status' turns the table into a real processing-state record:
--   'processing' — dedup row inserted, side effect not yet confirmed applied.
--   'completed'  — side effect applied; a later redelivery is a pure no-op.
-- stripe-webhook/index.ts now: treats a 'processing' row younger than its
-- staleness window as a genuinely concurrent in-flight delivery (ack
-- without reapplying — preserves the exactly-once behavior under a race);
-- treats an older 'processing' row as a crashed/never-finished attempt and
-- actually retries the side effect; and deletes the row outright on a
-- handled failure so an immediate retry isn't stuck waiting out that
-- window. processed_at (existing column, set at insert time) doubles as
-- "processing started at" for that staleness check.
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN status TEXT NOT NULL DEFAULT 'processing';

ALTER TABLE public.stripe_webhook_events
  ADD CONSTRAINT stripe_webhook_events_status_check
  CHECK (status IN ('processing', 'completed'));
