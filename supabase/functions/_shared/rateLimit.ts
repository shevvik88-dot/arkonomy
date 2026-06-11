import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RATE_LIMITS: Record<string, number> = {
  'ai-chat':           20,
  'stock-ai-analysis': 10,
  'get-insights':      30,
};

// Returns a 429 Response if the user has exceeded their hourly limit, otherwise null.
// Uses service role so it bypasses RLS on rate_limits.
export async function enforceRateLimit(
  userId: string,
  functionName: string,
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
    return null; // Fail open — don't block users if the DB call errors.
  }

  if ((count as number) > maxRequests) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        },
      },
    );
  }

  return null;
}
