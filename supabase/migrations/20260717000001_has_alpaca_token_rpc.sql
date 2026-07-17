-- RLS audit found profiles' explicit SELECT column list in App.jsx included
-- alpaca_access_token (a live Alpaca trading OAuth token) purely to derive a
-- boolean "is Alpaca connected" flag client-side. This RPC returns just the
-- boolean so the token itself never needs to reach the browser.
--
-- No SECURITY DEFINER and no parameters, unlike check_and_increment_rate_limit
-- (see 20260717000000) — this runs as the calling role (authenticated),
-- subject to the existing profiles_owner_select RLS policy (auth.uid() = id),
-- so it can only ever report on the caller's own row. Safe to leave EXECUTE
-- at its default PUBLIC grant.
CREATE OR REPLACE FUNCTION has_alpaca_token()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT alpaca_access_token IS NOT NULL FROM profiles WHERE id = auth.uid();
$$;
