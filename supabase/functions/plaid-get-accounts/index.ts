// supabase/functions/plaid-get-accounts/index.ts
// Returns all Plaid accounts for the authenticated user.
// Deployed with --no-verify-jwt: Supabase gateway passes ES256 tokens through;
// auth is handled internally via supabase.auth.getUser(token), same pattern
// as plaid-sync-transactions.
//
// POST {} with user Bearer token
// → { accounts: [{ account_id, name, mask, type, subtype, balance_current, balance_available }] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('plaid-get-accounts');

// Same allow-list pattern as auth-login/check-bank-connection/market-data —
// preview deployments get a fresh random subdomain hash on every push, so a
// single static origin can't cover them.
const PROD_ORIGIN = Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com';
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  PROD_ORIGIN,
  /^https:\/\/arkonomy-[a-z0-9-]+-shevvik88-dots-projects\.vercel\.app$/,
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

    // Auth: same pattern as plaid-sync-transactions
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    // Production and Sandbox are separate Plaid environments — different
    // hosts AND different `secret` (client_id is shared). demo@arkonomy.com's
    // item is deliberately Sandbox (plaid_environment column, see
    // 20260731000000_plaid_items_environment_marker.sql) — resolved per-item
    // below instead of one plaidBase for the whole request, so its real
    // balances actually load instead of silently returning nothing.
    const prodClientId    = Deno.env.get('PLAID_CLIENT_ID')!;
    const prodSecret      = Deno.env.get('PLAID_SECRET')!;
    const sandboxClientId = Deno.env.get('PLAID_SANDBOX_CLIENT_ID')!;
    const sandboxSecret   = Deno.env.get('PLAID_SANDBOX_SECRET')!;

    const { data: items, error: itemsErr } = await supabase
      .from('plaid_items')
      .select('id, access_token, institution_name, plaid_environment')
      .eq('user_id', user.id);

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) return json({ accounts: [] });

    const allAccounts: object[] = [];

    for (const item of items) {
      const isProduction = item.plaid_environment === 'production';
      const itemPlaidBase = `https://${isProduction ? 'production' : 'sandbox'}.plaid.com`;
      const clientId       = isProduction ? prodClientId : sandboxClientId;
      const secret         = isProduction ? prodSecret   : sandboxSecret;

      let data: any;

      // /accounts/get returns balance_current + balance_available without
      // requiring the Balance product — avoids 400 INVALID_PRODUCT errors.
      try {
        const res = await fetch(`${itemPlaidBase}/accounts/get`, {
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
    await captureAndFlush(err, { function_name: 'plaid-get-accounts' });
    return json({ error: "Internal Server Error" }, 500);
  }
});
