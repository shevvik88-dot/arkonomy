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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;
    const clientId  = Deno.env.get('PLAID_CLIENT_ID')!;
    const secret    = Deno.env.get('PLAID_SECRET')!;

    // Fetch all connected Plaid items for this user
    const { data: items, error: itemsErr } = await supabase
      .from('plaid_items')
      .select('id, access_token, institution_name')
      .eq('user_id', user.id);

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) return json({ accounts: [] });

    const allAccounts: object[] = [];

    for (const item of items) {
      try {
        const res = await fetch(`${plaidBase}/accounts/balance/get`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            client_id:    clientId,
            secret,
            access_token: item.access_token,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.accounts) {
          console.error(`Plaid accounts error for item ${item.id}:`, data.error_code);
          continue;
        }

        for (const acc of data.accounts) {
          // Only include depository accounts (checking, savings) — skip credit/loan/investment
          if (acc.type !== 'depository') continue;

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
      } catch (err) {
        console.error(`Failed to fetch accounts for item ${item.id}:`, err);
      }
    }

    return json({ accounts: allAccounts });

  } catch (err) {
    console.error('plaid-get-accounts error:', err);
    return json({ error: String(err) }, 500);
  }
});
