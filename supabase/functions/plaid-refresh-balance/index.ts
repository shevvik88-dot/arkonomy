// supabase/functions/plaid-refresh-balance/index.ts
// Forces Plaid to re-poll the connected bank(s) via /transactions/refresh —
// distinct from /transactions/sync, which only reads what Plaid already
// has cached. /transactions/refresh is async: Plaid acknowledges the
// request immediately here, then fires a SYNC_UPDATES_AVAILABLE webhook
// once the real re-poll completes — already handled end-to-end by
// plaid-webhook -> sync_item, the same path the normal incremental sync
// uses. This function does not wait for that to happen.
//
// POST {} with user Bearer token
// → { requested: N }                              — N = plaid_items refreshed
// → 429 { error: 'cooldown' }                      — server-side 5-min cooldown
//   (see check_and_set_balance_refresh RPC, profiles.last_balance_refresh_at)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('plaid-refresh-balance');

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

    // Auth: same pattern as plaid-get-accounts/plaid-sync-transactions
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    // Check for connected banks BEFORE consuming the cooldown — a user with
    // no plaid_items makes zero Plaid calls, so there's nothing to protect
    // Plaid's own per-Item rate limit from yet; no reason to lock them out
    // of a real attempt for 5 minutes. Once we do reach Plaid below, the
    // cooldown stays consumed even if every call fails (a failed API call
    // still counts against Plaid's own limit, so it must still count here).
    const { data: items, error: itemsErr } = await supabase
      .from('plaid_items')
      .select('access_token')
      .eq('user_id', user.id);
    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) return json({ requested: 0 });

    // Server-side cooldown — client also disables the button, but this is
    // the real enforcement (client-side alone could be bypassed). Fails
    // CLOSED (throws → 500) on a DB error, unlike _shared/rateLimit.ts's
    // fail-open: that RPC only guards Claude API cost, whereas this one
    // guards Plaid's own daily per-Item refresh quota — a real external
    // resource that's harder to recover from exhausting than a blocked
    // button click.
    const { data: allowed, error: cooldownErr } = await supabase.rpc(
      'check_and_set_balance_refresh',
      { p_user_id: user.id },
    );
    if (cooldownErr) throw cooldownErr;
    if (!allowed) {
      return json({ error: 'cooldown', message: 'Please wait a few minutes before refreshing again.' }, 429);
    }

    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;
    const clientId  = Deno.env.get('PLAID_CLIENT_ID')!;
    const secret    = Deno.env.get('PLAID_SECRET')!;

    let requested = 0;
    for (const item of items) {
      try {
        const res = await fetch(`${plaidBase}/transactions/refresh`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ client_id: clientId, secret, access_token: item.access_token }),
        });
        if (res.ok) {
          requested++;
        } else {
          console.warn('[plaid-refresh-balance] /transactions/refresh failed:', res.status, await res.text());
        }
      } catch (fetchErr) {
        console.error('[plaid-refresh-balance] fetch error:', fetchErr);
      }
    }

    return json({ requested });

  } catch (err) {
    console.error('plaid-refresh-balance error:', err);
    await captureAndFlush(err, { function_name: 'plaid-refresh-balance' });
    return json({ error: "Internal Server Error" }, 500);
  }
});
