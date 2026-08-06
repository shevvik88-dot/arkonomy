// supabase/functions/check-bank-connection/index.ts
// Returns { connected: bool, institution_name: string|null } for the authenticated user.
// Uses service role to query plaid_items — never exposes access_token to the client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('check-bank-connection');

// Same allow-list pattern as auth-login (see that file for the full
// rationale) — preview deployments get a fresh random subdomain hash on
// every push, so a single static origin can't cover them.
const PROD_ORIGIN = Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com';
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  PROD_ORIGIN,
  /^https:\/\/arkonomy-[a-z0-9]+-shevvik88-dots-projects\.vercel\.app$/,
];

function resolveCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowedOrigin = ALLOWED_ORIGINS.some(o => typeof o === 'string' ? o === origin : o.test(origin))
    ? origin
    : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req) => {
  const CORS = resolveCorsHeaders(req);
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { data: items, error } = await supabase
      .from('plaid_items')
      .select('institution_name, error_code')
      .eq('user_id', user.id)
      .limit(10);

    if (error) throw error;

    const connected = items != null && items.length > 0;
    return json({
      connected,
      institution_name: connected ? items[0].institution_name ?? null : null,
      count: items?.length ?? 0,
      error_code: connected ? items[0].error_code ?? null : null,
    });

  } catch (err) {
    console.error('check-bank-connection error:', err);
    await captureAndFlush(err, { function_name: 'check-bank-connection' });
    return json({ error: "Internal Server Error" }, 500);
  }
});
