// supabase/functions/check-bank-connection/index.ts
// Returns { connected: bool, institution_name: string|null } for the authenticated user.
// Uses service role to query plaid_items — never exposes access_token to the client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

Deno.serve(async (req) => {
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
      .select('institution_name')
      .eq('user_id', user.id)
      .limit(10);

    if (error) throw error;

    const connected = items != null && items.length > 0;
    return json({
      connected,
      institution_name: connected ? items[0].institution_name ?? null : null,
      count: items?.length ?? 0,
    });

  } catch (err) {
    console.error('check-bank-connection error:', err);
    return json({ error: "Internal Server Error" }, 500);
  }
});
