import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RATE_LIMITS: Record<string, number> = {
  'ai-chat':           20,
  'stock-ai-analysis': 10,
  'get-insights':      30,
  // market-data proxies a single shared FINNHUB_API_KEY (60 req/min app-wide,
  // no batch endpoint — one Finnhub call per ticker). A full Markets home
  // load alone is ~28 calls; this caps one user's hourly total well above
  // realistic heavy browsing (~200/hr) while still bounding how much of the
  // shared quota a single runaway/scripted client can burn.
  'market-data':       300,
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

// Returns a 429 Response if the user has exceeded their hourly limit, otherwise null.
// Uses service role so it bypasses RLS on rate_limits.
//
// failClosed (default false, preserves existing behavior for every current
// caller): on a DB error, the default is to fail OPEN — this is a cost/abuse
// guard, not access control, so a transient DB hiccup shouldn't block
// legitimate users from an AI chat or a market quote. A future call site that
// gates a money-moving action should pass `{ failClosed: true }` explicitly
// instead — that risk tradeoff belongs to the caller, not a single blanket
// policy here.
export async function enforceRateLimit(
  userId: string,
  functionName: string,
  options?: { failClosed?: boolean },
): Promise<Response | null> {
  const maxRequests = RATE_LIMITS[functionName];
  if (!maxRequests) return null; // No limit configured — allow.

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: count, error } = await supabase.rpc('check_and_increment_rate_limit', {
    p_user_id:       userId,
    p_function_name: functionName,
  });

  if (error) {
    console.error(`Rate limit check failed for ${functionName}:`, error);
    if (options?.failClosed) {
      return new Response(
        JSON.stringify({ error: 'Unable to verify rate limit right now. Please try again shortly.' }),
        { status: 503, headers: corsHeaders() },
      );
    }
    return null; // Fail open — don't block users if the DB call errors.
  }

  if ((count as number) > maxRequests) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
      { status: 429, headers: corsHeaders() },
    );
  }

  return null;
}
