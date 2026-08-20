import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

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

    const [accountRes, positionsRes] = await Promise.all([
      fetch(`${BASE_URL}/v2/account`, {
        headers: { Authorization: `Bearer ${alpacaToken}` },
      }),
      fetch(`${BASE_URL}/v2/positions`, {
        headers: { Authorization: `Bearer ${alpacaToken}` },
      }),
    ]);

    if (!accountRes.ok) {
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
    const positions = positionsRes.ok ? await positionsRes.json() : [];

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
