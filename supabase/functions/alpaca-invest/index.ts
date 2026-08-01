// alpaca-invest
// Places a fractional market buy order using the calling user's
// personal Alpaca OAuth access token (stored in profiles).
//
// Body: { amount: number, symbol: string }
// Returns: { success, order_id, status, symbol, amount, message }
//      or: { error: "alpaca_not_connected" }  — if user hasn't OAuth'd
//      or: { error: "Insufficient buying power. Available: $X.XX" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('alpaca-invest');

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
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
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 1) {
      return new Response(JSON.stringify({ error: 'Minimum amount is $1' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const sym = String(symbol ?? 'SPY').toUpperCase();
    if (!/^[A-Z]{1,5}$/.test(sym)) {
      return new Response(JSON.stringify({ error: 'Invalid symbol' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Reject a duplicate submitted in the last 60s ──────────────
    // Checks real elapsed time against the most recent matching order,
    // not a fixed calendar-minute bucket — a bucket key (floor(now/60s))
    // has a boundary gap where two submits 1-2s apart can land in
    // different buckets if they straddle a minute edge (e.g. :59.9 and
    // :00.1), letting a duplicate through. This has no such edge: any
    // matching order in the last 60 real seconds blocks the retry.
    const { data: recentDuplicate } = await supabase
      .from('investments')
      .select('id')
      .eq('user_id', user.id)
      .eq('symbol', sym)
      .eq('amount', Number(amount))
      .gte('created_at', new Date(Date.now() - 60_000).toISOString())
      .limit(1)
      .maybeSingle();

    if (recentDuplicate) {
      return new Response(JSON.stringify({
        error: 'This order was already submitted. Please wait a moment before retrying.',
      }), {
        status: 409,
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
      return new Response(JSON.stringify({ error: 'brokerage_account_error' }), {
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
    // client_order_id is a secondary backstop for the narrow race where
    // two requests both pass the recentDuplicate check above before
    // either's investments row is inserted (the DB check above is the
    // primary defense and has no boundary gap; this one still has the
    // calendar-minute edge case, but only matters for that sub-second
    // race window now).
    const clientOrderId = `ark-${user.id.slice(0, 8)}-${sym}-${Number(amount).toFixed(2)}-${Math.floor(Date.now() / 60_000)}`;

    const orderRes = await fetch(`${BASE_URL}/v2/orders`, {
      method: 'POST',
      headers: {
        Authorization:   `Bearer ${alpacaToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        symbol:          sym,
        notional:        String(Number(amount).toFixed(2)),
        side:            'buy',
        type:            'market',
        time_in_force:   'day',
        client_order_id: clientOrderId,
      }),
    });

    const order = await orderRes.json();

    if (!orderRes.ok) {
      console.error('Alpaca order error:', JSON.stringify(order));
      const isDuplicate = orderRes.status === 422
        && typeof order?.message === 'string'
        && order.message.toLowerCase().includes('client order id');
      if (isDuplicate) {
        return new Response(JSON.stringify({
          error: 'This order was already submitted. Please wait a moment before retrying.',
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Order failed', details: order }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Record in Supabase ───────────────────────────────────────
    await supabase.from('investments').insert({
      user_id:    user.id,
      symbol:     sym,
      amount:     Number(amount),
      order_id:   order.id,
      status:     order.status,
      created_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      success:  true,
      order_id: order.id,
      status:   order.status,
      symbol:   sym,
      amount:   Number(amount),
      message:  `Order placed: $${amount} in ${sym}`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('alpaca-invest error:', err);
    await captureAndFlush(err, { function_name: 'alpaca-invest' });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
