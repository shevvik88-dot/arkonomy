-- The profiles column-grant lockdown (20260730000000/1) revoked SELECT on
-- alpaca_access_token from `authenticated`. has_alpaca_token() was
-- deliberately NOT SECURITY DEFINER (20260717000001), running as the calling
-- role instead — so it broke too: confirmed live, 403
-- "permission denied for table profiles" on every call after the lockdown.
--
-- Fix: make it SECURITY DEFINER so it can read the column regardless of the
-- caller's own grants. Safe because it stays parameterless and keeps the
-- exact same `WHERE id = auth.uid()` — it can only ever report on the
-- caller's own row, identical guarantee to before, just enforced by the
-- WHERE clause instead of by column grant now that both exist together.
CREATE OR REPLACE FUNCTION has_alpaca_token()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT alpaca_access_token IS NOT NULL FROM profiles WHERE id = auth.uid();
$$;
