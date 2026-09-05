import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';
import { requirePaidPlan } from '../_shared/requirePaidPlan.ts';

initSentry('alpaca-portfolio');

// Same allow-list pattern as auth-login/check-bank-connection/market-data/
// plaid-get-accounts/get-insights — preview deployments get a fresh random
// subdomain hash on every push, so a single static origin can't cover them.
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
    // Security-auditor findings, 2026-08-24 (hardening, no active hole
    // found — client uses POST and the service worker skips supabase.co,
    // so nothing was actually caching this today).
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}

const BASE_URL = 'https://api.alpaca.markets';

Deno.serve(async (req) => {
  const corsHeaders = resolveCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Brokerage data is a paid-Pro feature. Read-only (no money moves here),
    // but a downgraded ex-Pro shouldn't keep pulling portfolio data — same
    // server-side gate as alpaca-invest / alpaca-oauth-start.
    // PENETRATION_TEST_PLAN.md 6.4 / SECURITY_THREAT_MODEL.md E4.
    const planBlock = await requirePaidPlan(supabase, user.id, corsHeaders);
    if (planBlock) return planBlock;

    const { data: profile } = await supabase
      .from('profiles')
      .select('alpaca_access_token')
      .eq('id', user.id)
      .single();

    if (!profile?.alpaca_access_token) {
      return new Response(JSON.stringify({ error: 'alpaca_not_connected' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const alpacaToken = profile.alpaca_access_token;

    const [accountRes, positionsRes, openOrdersRes] = await Promise.all([
      fetch(`${BASE_URL}/v2/account`, {
        headers: { Authorization: `Bearer ${alpacaToken}` },
      }),
      fetch(`${BASE_URL}/v2/positions`, {
        headers: { Authorization: `Bearer ${alpacaToken}` },
      }),
      // Visibility fix (2026-08-24): a submitted-but-unfilled order (e.g.
      // placed after hours, waiting for the next market open) previously
      // never showed up anywhere in the app — /v2/positions only returns
      // real filled positions, so the only way to see a pending order
      // existed was a direct Alpaca API call. status=open covers every
      // non-terminal order state (new/accepted/pending_new/partially_filled/...).
      // NOTE (security-auditor, 2026-08-24): Alpaca defaults this endpoint
      // to limit=50 with no explicit param here — a user with >50 open
      // orders gets a silently truncated list. Not paginating for v1 by
      // design (this app only ever places a handful of small fractional
      // buys), but flagging so a future increase in usage doesn't quietly
      // hide orders forever.
      fetch(`${BASE_URL}/v2/orders?status=open`, {
        headers: { Authorization: `Bearer ${alpacaToken}` },
      }),
    ]);

    if (!accountRes.ok) {
      // The other two fetches already went out (Promise.all) — draining
      // their bodies before returning avoids leaking the underlying
      // connections in the Deno isolate now that there are 3 requests
      // instead of 2 (security-auditor finding, 2026-08-24).
      await Promise.allSettled([positionsRes.body?.cancel(), openOrdersRes.body?.cancel()]);
      if (accountRes.status === 401 || accountRes.status === 403) {
        await supabase.from('profiles').update({
          alpaca_access_token:  null,
          alpaca_refresh_token: null,
          alpaca_account_id:    null,
          alpaca_connected_at:  null,
        }).eq('id', user.id);
        return new Response(JSON.stringify({ error: 'alpaca_not_connected' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Alpaca account error' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const account = await accountRes.json();
    // .catch(() => []) on the parse itself, not just the .ok check — a 200
    // with a malformed/truncated body would otherwise throw here, escape
    // to the outer catch, and turn the whole portfolio response into a 500
    // + Sentry event instead of gracefully degrading (security-auditor
    // finding, 2026-08-24 — applies equally to positions and open_orders).
    const positions = positionsRes.ok ? await positionsRes.json().catch(() => []) : [];
    // Best-effort — a failure here shouldn't break the whole portfolio
    // screen, it just means pending orders silently don't show this load
    // (same graceful-degradation shape as positions above).
    const openOrders = openOrdersRes.ok ? await openOrdersRes.json().catch(() => []) : [];
    if (!openOrdersRes.ok) console.error('alpaca-portfolio: /v2/orders?status=open error:', openOrdersRes.status);

    return new Response(JSON.stringify({
      portfolio_value: parseFloat(account.portfolio_value ?? '0'),
      buying_power:    parseFloat(account.buying_power ?? '0'),
      cash:            parseFloat(account.cash ?? '0'),
      positions: (Array.isArray(positions) ? positions : []).map(p => ({
        symbol:          p.symbol,
        qty:             parseFloat(p.qty),
        market_value:    parseFloat(p.market_value),
        avg_entry_price: parseFloat(p.avg_entry_price),
        unrealized_pl:   parseFloat(p.unrealized_pl),
        unrealized_plpc: parseFloat(p.unrealized_plpc),
      })),
      // Minimal, deliberately not the raw Alpaca order object — only what
      // the Pending Orders UI actually needs.
      open_orders: (Array.isArray(openOrders) ? openOrders : []).map(o => ({
        order_id:     o.id,
        symbol:       o.symbol,
        side:         o.side,
        notional:     o.notional,
        qty:          o.qty,
        status:       o.status,
        submitted_at: o.submitted_at,
      })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('alpaca-portfolio error:', err);
    await captureAndFlush(err, { function_name: 'alpaca-portfolio' });
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
