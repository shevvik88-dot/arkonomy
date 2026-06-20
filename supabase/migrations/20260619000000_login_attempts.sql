CREATE TABLE IF NOT EXISTS login_attempts (
  key           TEXT PRIMARY KEY,           -- "email::ip"
  attempt_count INT NOT NULL DEFAULT 1,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lockout_until TIMESTAMPTZ
);
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies — service role only.

-- Returns { locked: bool, lockout_seconds: int }
CREATE OR REPLACE FUNCTION check_login_lockout(p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row login_attempts;
BEGIN
  SELECT * INTO v_row FROM login_attempts WHERE key = p_key;
  IF NOT FOUND OR v_row.lockout_until IS NULL OR v_row.lockout_until <= NOW() THEN
    RETURN jsonb_build_object('locked', false, 'lockout_seconds', 0);
  END IF;
  RETURN jsonb_build_object(
    'locked', true,
    'lockout_seconds', GREATEST(0, EXTRACT(EPOCH FROM (v_row.lockout_until - NOW()))::INT)
  );
END;
$$;

-- Call after a failed attempt. Returns { locked: bool, lockout_seconds: int }
-- Resets window after 15 min of inactivity; locks out after 5 failures in the window.
CREATE OR REPLACE FUNCTION record_login_failure(p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max_attempts INT := 5;
  v_window_min   INT := 15;
  v_lockout_min  INT := 15;
  v_now TIMESTAMPTZ := NOW();
  v_new_count INT;
  v_lockout TIMESTAMPTZ;
BEGIN
  INSERT INTO login_attempts (key, attempt_count, window_start, lockout_until)
  VALUES (p_key, 1, v_now, NULL)
  ON CONFLICT (key) DO UPDATE SET
    attempt_count = CASE
      WHEN login_attempts.window_start < v_now - (v_window_min || ' minutes')::INTERVAL THEN 1
      ELSE login_attempts.attempt_count + 1
    END,
    window_start = CASE
      WHEN login_attempts.window_start < v_now - (v_window_min || ' minutes')::INTERVAL THEN v_now
      ELSE login_attempts.window_start
    END,
    lockout_until = CASE
      WHEN login_attempts.window_start < v_now - (v_window_min || ' minutes')::INTERVAL THEN NULL
      WHEN (login_attempts.attempt_count + 1) >= v_max_attempts
        THEN v_now + (v_lockout_min || ' minutes')::INTERVAL
      ELSE NULL
    END
  RETURNING attempt_count, lockout_until INTO v_new_count, v_lockout;

  IF v_lockout IS NOT NULL AND v_lockout > v_now THEN
    RETURN jsonb_build_object(
      'locked', true,
      'lockout_seconds', EXTRACT(EPOCH FROM (v_lockout - v_now))::INT
    );
  END IF;
  RETURN jsonb_build_object('locked', false, 'lockout_seconds', 0);
END;
$$;

-- Call after a successful login to clear the slate.
CREATE OR REPLACE FUNCTION clear_login_attempts(p_key TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM login_attempts WHERE key = p_key;
$$;

REVOKE EXECUTE ON FUNCTION check_login_lockout(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_login_failure(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION clear_login_attempts(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_login_lockout(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION record_login_failure(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION clear_login_attempts(TEXT) TO service_role;
