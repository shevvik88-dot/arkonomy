-- Rate limiting table and atomic increment function

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id       UUID    NOT NULL,
  function_name TEXT    NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, function_name)
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies — accessed exclusively via service role from edge functions.

-- Atomically increments the counter for a (user, function) pair within the
-- current 1-hour window, resetting the window when it expires.
-- Returns the updated request_count so the caller can compare against the limit.
CREATE OR REPLACE FUNCTION check_and_increment_rate_limit(
  p_user_id       UUID,
  p_function_name TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO rate_limits (user_id, function_name, request_count, window_start)
  VALUES (p_user_id, p_function_name, 1, NOW())
  ON CONFLICT (user_id, function_name) DO UPDATE SET
    request_count = CASE
      WHEN rate_limits.window_start < NOW() - INTERVAL '1 hour' THEN 1
      ELSE rate_limits.request_count + 1
    END,
    window_start = CASE
      WHEN rate_limits.window_start < NOW() - INTERVAL '1 hour' THEN NOW()
      ELSE rate_limits.window_start
    END
  RETURNING request_count INTO v_count;

  RETURN v_count;
END;
$$;
