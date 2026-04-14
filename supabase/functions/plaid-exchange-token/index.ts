// supabase/functions/plaid-exchange-token/index.ts
// Exchanges a Plaid public_token for a permanent access_token and stores
// the resulting item in plaid_items.
//
// POST { public_token: string, institution_name: string, institution_id: string }
// → { success: true }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://app.arkonomy.com',
  'http://localhost:5173',
  'http://localhost:4173',
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
    const body = await req.json() as {
      public_token:     string;
      institution_name: string;
      institution_id:   string;
    };

    if (!body.public_token) {
      return json({ error: 'public_token required' }, 400, cors);
    }

    // ── Plaid token exchange ──────────────────────────────────────────────────
    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;

    const exchangeRes = await fetch(`${plaidBase}/item/public_token/exchange`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:    Deno.env.get('PLAID_CLIENT_ID'),
        secret:       Deno.env.get('PLAID_SECRET'),
        public_token: body.public_token,
      }),
    });

    const exchangeData = await exchangeRes.json();

    if (!exchangeRes.ok) {
      console.error('plaid /item/public_token/exchange error:', exchangeData);
      return json(
        { error: exchangeData.error_message ?? exchangeData.error_code ?? 'Plaid exchange error' },
        502,
        cors,
      );
    }

    const { access_token, item_id } = exchangeData as {
      access_token: string;
      item_id:      string;
    };

    // ── Persist to plaid_items ────────────────────────────────────────────────
    const { error: upsertErr } = await supabase
      .from('plaid_items')
      .upsert(
        {
          user_id:          user.id,
          item_id,
          access_token,
          institution_id:   body.institution_id   ?? null,
          institution_name: body.institution_name ?? null,
          plaid_cursor:     null, // reset cursor so next sync fetches full history
        },
        { onConflict: 'user_id,item_id' },
      );

    if (upsertErr) {
      console.error('plaid_items upsert error:', upsertErr);
      return json({ error: 'Failed to save bank connection' }, 500, cors);
    }

    return json({ success: true }, 200, cors);

  } catch (err) {
    console.error('plaid-exchange-token error:', err);
    return json({ error: String(err) }, 500, cors);
  }
});
