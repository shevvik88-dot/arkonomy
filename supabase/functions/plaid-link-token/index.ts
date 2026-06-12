// supabase/functions/plaid-link-token/index.ts
// Creates a Plaid Link token for the authenticated user.
//
// POST { redirect_uri?: string }
// → { link_token: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

    if (authErr || !user) {
      return json({ error: 'Unauthorized' }, 401, corsHeaders);
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const redirect_uri = typeof body.redirect_uri === 'string' ? body.redirect_uri : undefined;
    const isUpdateMode = body.mode === 'update';

    // ── Plaid request ─────────────────────────────────────────────────────────
    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;

    let plaidBody: Record<string, unknown>;

    if (isUpdateMode) {
      // Update mode: fetch existing access_token and create a reconnect link token.
      // This triggers Plaid's HISTORICAL_UPDATE cycle on the existing item.
      const { data: item, error: itemErr } = await supabase
        .from('plaid_items')
        .select('access_token')
        .eq('user_id', user.id)
        .limit(1)
        .single();

      if (itemErr || !item?.access_token) {
        return json({ error: 'No connected bank found' }, 404, corsHeaders);
      }

      plaidBody = {
        client_id:     Deno.env.get('PLAID_CLIENT_ID'),
        secret:        Deno.env.get('PLAID_SECRET'),
        client_name:   'Arkonomy',
        user:          { client_user_id: user.id },
        access_token:  item.access_token,
        country_codes: ['US'],
        language:      'en',
      };
    } else {
      plaidBody = {
        client_id:     Deno.env.get('PLAID_CLIENT_ID'),
        secret:        Deno.env.get('PLAID_SECRET'),
        client_name:   'Arkonomy',
        user:          { client_user_id: user.id },
        products:      ['transactions'],
        country_codes: ['US'],
        language:      'en',
      };
      if (redirect_uri) plaidBody.redirect_uri = redirect_uri;
    }

    const plaidRes  = await fetch(`${plaidBase}/link/token/create`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(plaidBody),
    });

    const plaidData = await plaidRes.json();

    if (!plaidRes.ok) {
      console.error('plaid /link/token/create error:', plaidData);
      return json(
        { error: plaidData.error_message ?? plaidData.error_code ?? 'Plaid error' },
        502,
        corsHeaders,
      );
    }

    return json({ link_token: plaidData.link_token }, 200, corsHeaders);

  } catch (err) {
    console.error('plaid-link-token error:', err);
    return json({ error: "Internal Server Error" }, 500, corsHeaders);
  }
});
