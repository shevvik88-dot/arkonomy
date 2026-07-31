-- Marks which Plaid environment a given item was connected through.
-- All real users are 'production' (the default). The demo@arkonomy.com
-- account's item is 'sandbox' — it was deliberately connected to Plaid
-- Sandbox for App Store review purposes, but PLAID_ENV is 'production'
-- app-wide, so any automated sync path (daily cron, Plaid webhooks) that
-- reaches this item throws "provided access token is for the wrong Plaid
-- environment" — confirmed live via a Sentry event from the sync_item
-- webhook-triggered path. Sync code now checks this column and skips
-- non-production items instead of attempting (and failing) the call.
ALTER TABLE public.plaid_items
  ADD COLUMN plaid_environment text NOT NULL DEFAULT 'production';

UPDATE public.plaid_items
SET plaid_environment = 'sandbox'
WHERE id = 'b9608965-177a-4702-9b14-34bdf266343d'; -- demo@arkonomy.com's First Platypus Bank item
