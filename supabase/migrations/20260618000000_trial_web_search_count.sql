ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_web_search_count INT NOT NULL DEFAULT 0;

-- Atomically increments the trial web-search counter if count < 5.
-- Returns TRUE  → request allowed, counter was incremented.
-- Returns FALSE → limit reached, counter unchanged.
CREATE OR REPLACE FUNCTION public.increment_trial_web_search(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE profiles
  SET trial_web_search_count = trial_web_search_count + 1
  WHERE id = p_user_id
    AND trial_web_search_count < 5;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_trial_web_search(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_trial_web_search(UUID) TO service_role;
