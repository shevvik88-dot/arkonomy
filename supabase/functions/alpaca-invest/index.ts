import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const ALPACA_API_KEY    = Deno.env.get('ALPACA_API_KEY')!;
    const ALPACA_SECRET_KEY = Deno.env.get('ALPACA_SECRET_KEY')!;
    const BASE_URL          = 'https://paper-api.alpaca.markets';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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
      return new Response(JSON.stringify({ error: 'Unauthorized', detail: authError?.message }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { amount, symbol = 'SPY' } = await req.json();

    if (!amount || Number(amount) < 1) {
      return new Response(JSON.stringify({ error: 'Minimum amount is $1' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Проверяем аккаунт Alpaca
    const accountRes = await fetch(`${BASE_URL}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID':     ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
      },
    });
    const account = await accountRes.json();

    if (!accountRes.ok) {
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

    // Размещаем ордер (fractional, по сумме в долларах)
    const orderRes = await fetch(`${BASE_URL}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID':     ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
        'Content-Type':        'application/json',
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

    // Записываем в Supabase
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
