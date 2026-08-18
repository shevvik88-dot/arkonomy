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

  // Declared outside the try block on purpose: a `const` inside try is not
  // visible to the catch block below (separate scopes), so if fetch() itself
  // throws (network failure, not just a non-ok response) after the pending
  // row is reserved, the catch block still needs both of these to clean it
  // up — otherwise a thrown exception leaks a permanent dead reservation.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  let pendingRowId: string | null = null;

  try {
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

    // ── Reject a duplicate: atomic pending-row insert, not a racy read ──
    // Replaces the old SELECT-then-later-INSERT check (real TOCTOU gap —
    // the SELECT and the eventual INSERT were separated by two Alpaca
    // network calls, so two near-simultaneous requests could both pass
    // the check before either had written a row). windowBucket reuses the
    // exact same per-minute bucket client_order_id already used below —
    // one definition of "window", not two. This does reintroduce the
    // calendar-minute boundary edge case the old SELECT-based check
    // specifically avoided (two submits straddling a minute mark, e.g.
    // :59.9 and :00.1, land in different buckets and won't collide) —
    // accepted tradeoff: atomicity via a DB unique constraint beats a
    // wider-but-racy window check. See SECURITY_THREAT_MODEL.md FINDING-A.
    const windowBucket = Math.floor(Date.now() / 60_000);

    const { data: pendingRow, error: pendingErr } = await supabase
      .from('investments')
      .insert({
        user_id:       user.id,
        symbol:        sym,
        amount:        numAmount,
        window_bucket: windowBucket,
        status:        'pending',
      })
      .select('id')
      .single();

    if (pendingErr) {
      if (pendingErr.code === '23505') {
        return new Response(JSON.stringify({
          error: 'This order was already submitted. Please wait a moment before retrying.',
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error('alpaca-invest: pending row insert failed:', pendingErr);
      await captureAndFlush(pendingErr, { function_name: 'alpaca-invest' });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Assign to the outer-scoped variable (see comment at the top of the
    // function) so the catch block can still find it if something throws.
    pendingRowId = pendingRow.id;

    // From here on, any early return must clean up the reserved pending
    // row first — otherwise a legitimate retry after a real failure
    // (network blip, insufficient funds, Alpaca rejection) would stay
    // blocked by its own dead reservation until the minute bucket rolls
    // over.
    async function releasePending() {
      await supabase.from('investments').delete().eq('id', pendingRowId);
    }

    // ── Load user's Alpaca access token from profiles ────────────
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('alpaca_access_token, alpaca_refresh_token')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile?.alpaca_access_token) {
      await releasePending();
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

        await releasePending();
        return new Response(JSON.stringify({ error: 'alpaca_not_connected' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.error('Alpaca account error:', JSON.stringify(account));
      await releasePending();
      return new Response(JSON.stringify({ error: 'brokerage_account_error' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const buyingPower = parseFloat(account.buying_power);
    if (buyingPower < Number(amount)) {
      await releasePending();
      return new Response(JSON.stringify({
        error: `Insufficient buying power. Available: $${buyingPower.toFixed(2)}`,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Place fractional order ───────────────────────────────────
    // client_order_id is a secondary backstop, kept as defense-in-depth —
    // the pending row above is now the primary defense against a double
    // submission ever reaching Alpaca at all.
    const clientOrderId = `ark-${user.id.slice(0, 8)}-${sym}-${Number(amount).toFixed(2)}-${windowBucket}`;

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
      await releasePending();
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

    // ── Confirm the reserved row — update, not a new insert ──────
    // A real Alpaca order was just placed above (money already moved) — if
    // this UPDATE matches 0 rows, the row was deleted out from under it
    // (delete-account race, T6-adjacent finding) and the order is now
    // untracked in investments with no other signal anywhere. Alert on it
    // rather than let it stay silent (previously: no error thrown for a
    // 0-row match, so nothing surfaced this at all).
    const { data: confirmedRow, error: confirmErr } = await supabase
      .from('investments')
      .update({ order_id: order.id, status: order.status })
      .eq('id', pendingRowId)
      .select('id');

    if (confirmErr || !confirmedRow?.length) {
      await captureAndFlush(
        new Error('alpaca-invest: confirm-update matched 0 rows — possible delete-account race'),
        { function_name: 'alpaca-invest', pendingRowId, order_id: order.id },
      );
    }

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
    // A thrown exception (e.g. fetch() itself failing on a network error,
    // not just a non-ok response) after the pending row was reserved would
    // otherwise leak a permanent dead reservation — clean it up here too.
    //
    // Known gap: catch treats fetch timeout on order-placement (line 200)
    // same as any other error — releasePending() runs even if Alpaca may
    // have already processed the order. Real fix requires reconciliation
    // job against Alpaca order history, not just retry-blocking. See
    // SECURITY_THREAT_MODEL.md.
    if (pendingRowId) {
      await supabase.from('investments').delete().eq('id', pendingRowId);
    }
    await captureAndFlush(err, { function_name: 'alpaca-invest' });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
