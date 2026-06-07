// supabase/functions/plaid-link-token/index.ts
// Creates a Plaid Link token for the authenticated user.
//
// POST { redirect_uri?: string }
// → { link_token: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://app.arkonomy.com',
  'http://localhost:5173',   // Vite dev
  'http://localhost:4173',   // Vite preview
  'http://localhost:3000',
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

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
      return json({ error: 'Unauthorized' }, 401, cors);
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const redirect_uri = typeof body.redirect_uri === 'string' ? body.redirect_uri : undefined;

    // ── Plaid request ─────────────────────────────────────────────────────────
    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;

    const plaidBody: Record<string, unknown> = {
      client_id:    Deno.env.get('PLAID_CLIENT_ID'),
      secret:       Deno.env.get('PLAID_SECRET'),
      client_name:  'Arkonomy',
      user:         { client_user_id: user.id },
      products:     ['transactions'],
      country_codes: ['US'],
      language:     'en',
    };

    if (redirect_uri) plaidBody.redirect_uri = redirect_uri;

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
        cors,
      );
    }

    return json({ link_token: plaidData.link_token }, 200, cors);

  } catch (err) {
    console.error('plaid-link-token error:', err);
    return json({ error: String(err) }, 500, cors);
  }
});
