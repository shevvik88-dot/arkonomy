-- supabase/migrations/20260802000000_large_transaction_alerts.sql
--
-- Adds the toggle (default on, matches include_spending/include_balance's
-- convention) and the cross-channel dedup flag for the new large-transaction
-- email alert feature (large-transaction-alert edge function).

ALTER TABLE public.notification_preferences
  ADD COLUMN large_transaction_alerts BOOLEAN NOT NULL DEFAULT true;

-- Shared across BOTH the existing client-side Autopilot large-tx toast/push
-- (App.jsx) and the new server-side email alert — whichever channel fires
-- first for a given transaction sets this, so the other doesn't also notify
-- for the same transaction.
ALTER TABLE public.transactions
  ADD COLUMN large_tx_notified BOOLEAN NOT NULL DEFAULT false;
