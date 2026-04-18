// alpaca-invest
// Places a fractional market buy order using the calling user's
// personal Alpaca OAuth access token (stored in profiles).
//
// Body: { amount: number, symbol: string }
// Returns: { success, order_id, status, symbol, amount, message }
//      or: { error: "alpaca_not_connected" }  — if user hasn't OAuth'd
//      or: { error: "Insufficient buying power. Available: $X.XX" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BASE_URL = 'https://api.alpaca.markets';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Authenticate caller ──────────────────────────────────────
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
      return new Response(JSON.stringify({ error: 'Unauthorized', detail: authError?.message }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Parse request ────────────────────────────────────────────
    const { amount, symbol = 'SPY' } = await req.json();
    if (!amount || Number(amount) < 1) {
      return new Response(JSON.stringify({ error: 'Minimum amount is $1' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Load user's Alpaca access token from profiles ────────────
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('alpaca_access_token, alpaca_refresh_token')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile?.alpaca_access_token) {
      return new Response(JSON.stringify({ error: 'alpaca_not_connected' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const alpacaToken = profile.alpaca_access_token;

    // ── Check account / buying power ─────────────────────────────
    const accountRes = await fetch(`${BASE_URL}/v2/account`, {
      headers: { Authorization: `Bearer ${alpacaToken}` },
    });
    const account = await accountRes.json();

    if (!accountRes.ok) {
      // Token may have expired — return a "not connected" signal so the
      // UI prompts the user to reconnect
      if (accountRes.status === 401 || accountRes.status === 403) {
        // Clear the stale token so the UI shows the connect prompt again
        await supabase
          .from('profiles')
          .update({
            alpaca_access_token:  null,
            alpaca_refresh_token: null,
            alpaca_account_id:    null,
            alpaca_connected_at:  null,
          })
          .eq('id', user.id);

        return new Response(JSON.stringify({ error: 'alpaca_not_connected' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.error('Alpaca account error:', JSON.stringify(account));
      return new Response(JSON.stringify({ error: 'Alpaca account error', details: account }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const buyingPower = parseFloat(account.buying_power);
    if (buyingPower < Number(amount)) {
      return new Response(JSON.stringify({
        error: `Insufficient buying power. Available: $${buyingPower.toFixed(2)}`,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Place fractional order ───────────────────────────────────
    const orderRes = await fetch(`${BASE_URL}/v2/orders`, {
      method: 'POST',
      headers: {
        Authorization:   `Bearer ${alpacaToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        symbol,
        notional:      String(Number(amount).toFixed(2)),
        side:          'buy',
        type:          'market',
        time_in_force: 'day',
      }),
    });

    const order = await orderRes.json();

    if (!orderRes.ok) {
      console.error('Alpaca order error:', JSON.stringify(order));
      return new Response(JSON.stringify({ error: 'Order failed', details: order }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Record in Supabase ───────────────────────────────────────
    await supabase.from('investments').insert({
      user_id:    user.id,
      symbol,
      amount:     Number(amount),
      order_id:   order.id,
      status:     order.status,
      created_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      success:  true,
      order_id: order.id,
      status:   order.status,
      symbol,
      amount:   Number(amount),
      message:  `Order placed: $${amount} in ${symbol}`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('alpaca-invest error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
