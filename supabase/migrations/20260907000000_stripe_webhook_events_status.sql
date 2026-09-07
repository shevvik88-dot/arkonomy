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

-- Backfill (code-reviewer finding, 2026-09-07): every row that already
-- existed before this migration was inserted under the OLD, insert-only
-- scheme — its mere existence meant "this event.id was already fully
-- processed" (the old code inserted the dedup row, then ran the side
-- effect; if the side effect failed, the whole request errored, but
-- nothing ever went back and deleted that already-inserted row). Left at
-- this column's default, every one of those historical rows would read as
-- 'processing' with a long-since-stale processed_at — and the very next
-- redelivery of any of them (a manual Stripe-dashboard resend, a routine
-- support/debug action) would be treated as a crashed attempt and have its
-- side effect RE-applied, reopening the exact trial-extension bug
-- (FINDING-B) this table exists to prevent, just via the new mechanism.
-- Mark every pre-existing row 'completed' — safe because that's what its
-- mere presence already meant under the scheme that created it.
UPDATE public.stripe_webhook_events SET status = 'completed' WHERE status = 'processing';
