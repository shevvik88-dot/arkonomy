-- Replaces passing the user's Supabase JWT as the Alpaca OAuth `state`
-- parameter (a live bearer credential travelling through a third party's
-- URL, access logs, browser history, and Referer headers — full account
-- takeover for anyone who obtains it). state is now a random opaque nonce
-- that maps to a user_id server-side, single-use, short-TTL.
--
-- No client-facing RLS policies, same pattern as plaid_items: only
-- service-role edge functions (alpaca-oauth-start, alpaca-oauth-callback)
-- ever touch this table.
CREATE TABLE public.oauth_nonces (
  nonce      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.oauth_nonces ENABLE ROW LEVEL SECURITY;
