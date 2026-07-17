-- check_and_increment_rate_limit is SECURITY DEFINER but was never REVOKEd
-- from PUBLIC/anon/authenticated (unlike login_attempts' equivalent
-- functions) — any logged-in client could call it directly via PostgREST
-- RPC with an arbitrary p_user_id and burn a victim's rate-limit window.
-- Only _shared/rateLimit.ts (service role, called after the edge function's
-- own auth.getUser(token) check) is meant to call this.
REVOKE EXECUTE ON FUNCTION check_and_increment_rate_limit(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_and_increment_rate_limit(UUID, TEXT) TO service_role;
