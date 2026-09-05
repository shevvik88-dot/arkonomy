-- IP-keyed rate limiting for pre-auth endpoints (signup, confirmation-email
-- resend) where no user_id exists yet to key on. Sibling of `rate_limits` /
-- `check_and_increment_rate_limit` (per-user, keyed on UUID) — same 1-hour
-- rolling-window logic, TEXT key instead of UUID.
--
-- PENETRATION_TEST_PLAN.md 6.3: signup had no throttle at all (20/20
-- back-to-back from one IP, zero 429). The `auth-signup` edge function calls
-- check_and_increment_ip_rate_limit before proxying to GoTrue.

CREATE TABLE IF NOT EXISTS ip_rate_limits (
  ip            TEXT    NOT NULL,
  scope         TEXT    NOT NULL,          -- 'auth-signup', 'auth-resend', ...
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ip, scope)
);

ALTER TABLE ip_rate_limits ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies — accessed exclusively via service role from
-- edge functions (same posture as rate_limits / login_attempts).

-- Atomically increments the counter for an (ip, scope) pair within the
-- current 1-hour window, resetting the window when it expires. Returns the
-- updated request_count so the caller can compare against its own limit.
CREATE OR REPLACE FUNCTION check_and_increment_ip_rate_limit(
  p_ip    TEXT,
  p_scope TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO ip_rate_limits (ip, scope, request_count, window_start)
  VALUES (p_ip, p_scope, 1, NOW())
  ON CONFLICT (ip, scope) DO UPDATE SET
    request_count = CASE
      WHEN ip_rate_limits.window_start < NOW() - INTERVAL '1 hour' THEN 1
      ELSE ip_rate_limits.request_count + 1
    END,
    window_start = CASE
      WHEN ip_rate_limits.window_start < NOW() - INTERVAL '1 hour' THEN NOW()
      ELSE ip_rate_limits.window_start
    END
  RETURNING request_count INTO v_count;

  RETURN v_count;
END;
$$;

-- SECURITY DEFINER + service-role-only, same lockdown as
-- check_and_increment_rate_limit (migration 20260717000000) — a client must
-- never be able to call this directly via PostgREST RPC to burn or inspect
-- an arbitrary IP's window.
REVOKE EXECUTE ON FUNCTION check_and_increment_ip_rate_limit(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION check_and_increment_ip_rate_limit(TEXT, TEXT) TO service_role;
