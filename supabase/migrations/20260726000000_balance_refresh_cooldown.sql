ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_balance_refresh_at TIMESTAMPTZ;

-- Atomically checks the 5-minute cooldown for the "Refresh balance now"
-- button and updates the timestamp if allowed, in one statement (avoids a
-- race condition on a rapid double-click, unlike a separate read-then-write).
-- Returns TRUE  -> request allowed, timestamp updated to now().
-- Returns FALSE -> still in cooldown, timestamp unchanged.
CREATE OR REPLACE FUNCTION public.check_and_set_balance_refresh(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE profiles
  SET last_balance_refresh_at = NOW()
  WHERE id = p_user_id
    AND (last_balance_refresh_at IS NULL OR last_balance_refresh_at < NOW() - INTERVAL '5 minutes');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_and_set_balance_refresh(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_set_balance_refresh(UUID) TO service_role;
