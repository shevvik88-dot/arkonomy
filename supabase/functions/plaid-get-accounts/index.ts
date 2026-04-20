// supabase/functions/plaid-get-accounts/index.ts
// Returns all Plaid accounts for the authenticated user with live balances.
// Calls /accounts/balance/get for each connected Plaid item.
//
// POST {} with user Bearer token
// → { accounts: [{ account_id, name, mask, type, subtype, balance_current, balance_available }] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
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
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();

    // Allow service-role key for debug/admin calls; resolve user_id from body
    let userId: string;
    const body = await req.json().catch(() => ({})) as Record<string, string>;
    if (token === serviceKey) {
      if (!body.user_id) return json({ error: 'user_id required when using service role' }, 400);
      userId = body.user_id;
    } else {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return json({ error: 'Unauthorized' }, 401);
      userId = user.id;
    }

    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;
    const clientId  = Deno.env.get('PLAID_CLIENT_ID')!;
    const secret    = Deno.env.get('PLAID_SECRET')!;

    // Fetch all connected Plaid items for this user
    const { data: items, error: itemsErr } = await supabase
      .from('plaid_items')
      .select('id, access_token, institution_name')
      .eq('user_id', userId);

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) return json({ accounts: [], _debug: 'no_plaid_items' });

    const allAccounts: object[] = [];

    for (const item of items) {
      let data: any;
      let status: number;

      // Try /accounts/balance/get first (includes live balances).
      // Falls back to /accounts/get if the Balance product isn't enabled on this Plaid app.
      for (const endpoint of ['/accounts/balance/get', '/accounts/get']) {
        try {
          const res = await fetch(`${plaidBase}${endpoint}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ client_id: clientId, secret, access_token: item.access_token }),
          });
          status = res.status;
          data = await res.json();
        } catch (fetchErr) {
          console.error(`[plaid-get-accounts] fetch threw for ${endpoint}:`, fetchErr);
          continue;
        }

        if (status === 200 && data.accounts) break;  // success — stop trying

        const code = data?.error_code ?? '';
        console.warn(`[plaid-get-accounts] ${endpoint} returned ${status} ${code} — ${code === 'INVALID_PRODUCT' ? 'falling back to /accounts/get' : 'skipping item'}`);
        if (code !== 'INVALID_PRODUCT') break; // non-product error, no point retrying
      }

      if (!data?.accounts) continue;

      for (const acc of data.accounts) {
        allAccounts.push({
          account_id:        acc.account_id,
          name:              acc.name,
          official_name:     acc.official_name ?? null,
          mask:              acc.mask ?? null,
          type:              acc.type,
          subtype:           acc.subtype,
          institution_name:  item.institution_name ?? null,
          balance_current:   acc.balances?.current   ?? null,
          balance_available: acc.balances?.available ?? null,
        });
      }
    }

    return json({ accounts: allAccounts });

  } catch (err) {
    console.error('plaid-get-accounts error:', err);
    return json({ error: String(err) }, 500);
  }
});
