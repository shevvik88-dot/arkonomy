// supabase/functions/plaid-get-accounts/index.ts
// Returns all Plaid accounts for the authenticated user.
// Deployed with --no-verify-jwt: Supabase gateway passes ES256 tokens through;
// auth is handled internally via supabase.auth.getUser(token), same pattern
// as plaid-sync-transactions.
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

    // Auth: same pattern as plaid-sync-transactions
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;
    const clientId  = Deno.env.get('PLAID_CLIENT_ID')!;
    const secret    = Deno.env.get('PLAID_SECRET')!;

    const { data: items, error: itemsErr } = await supabase
      .from('plaid_items')
      .select('id, access_token, institution_name')
      .eq('user_id', user.id);

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) return json({ accounts: [] });

    const allAccounts: object[] = [];

    for (const item of items) {
      let data: any;

      // /accounts/get returns balance_current + balance_available without
      // requiring the Balance product — avoids 400 INVALID_PRODUCT errors.
      try {
        const res = await fetch(`${plaidBase}/accounts/get`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ client_id: clientId, secret, access_token: item.access_token }),
        });
        data = await res.json();
        if (!res.ok) {
          console.warn(`[plaid-get-accounts] /accounts/get → ${res.status} ${data?.error_code ?? ''}`);
          continue;
        }
      } catch (fetchErr) {
        console.error('[plaid-get-accounts] fetch error:', fetchErr);
        continue;
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
