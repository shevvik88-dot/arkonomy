import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// IP-keyed sibling of _shared/rateLimit.ts's enforceRateLimit — for pre-auth
// endpoints (signup, confirmation-email resend) where no user_id exists yet.
// Same 1-hour rolling window (check_and_increment_ip_rate_limit), same
// fail-open default: this is a cost/abuse guard, not access control, so a
// transient DB error shouldn't block a legitimate signup. A caller that
// needs a strict guarantee can pass { failClosed: true }.
//
// PENETRATION_TEST_PLAN.md 6.3.

const IP_RATE_LIMITS: Record<string, number> = {
  'auth-signup': 10, // new accounts per IP per hour
  'auth-resend': 5,  // confirmation-email resends per IP per hour
};

// Returns a Response (429 or, if failClosed, 503) when the IP is over its
// limit for this scope, otherwise null. Always increments the counter first
// (called before the request is proxied upstream), so invalid-body spam
// counts toward the limit too.
export async function enforceIpRateLimit(
  ip: string,
  scope: string,
  corsHeaders: Record<string, string>,
  options?: { failClosed?: boolean },
): Promise<Response | null> {
  const max = IP_RATE_LIMITS[scope];
  if (!max) return null; // No limit configured for this scope — allow.

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: count, error } = await supabase.rpc('check_and_increment_ip_rate_limit', {
    p_ip:    ip,
    p_scope: scope,
  });

  if (error) {
    console.error(`IP rate limit check failed for ${scope}:`, error.message);
    if (options?.failClosed) {
      return new Response(
        JSON.stringify({ error: 'Unable to verify rate limit right now. Please try again shortly.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    return null; // Fail open — matches enforceRateLimit.
  }

  if ((count as number) > max) {
    return new Response(
      JSON.stringify({ error: 'Too many attempts from your network. Please try again later.' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  return null;
}
