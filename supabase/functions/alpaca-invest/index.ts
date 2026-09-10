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
import { requirePaidPlan } from '../_shared/requirePaidPlan.ts';

initSentry('alpaca-invest');

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BASE_URL = 'https://api.alpaca.markets';

// A pending reservation older than this can only be an orphan — the request
// that created it died before resolving it. One full run of this handler
// (reservation INSERT → /v2/account → /v2/orders → confirm UPDATE) is a
// few hundred ms even with a slow broker; 2 min is comfortably beyond any
// legitimate in-flight window without being so long it strands a user.
const STALE_PENDING_MS = 2 * 60 * 1000;

// Alpaca order statuses that mean "the broker has this order" — a retry
// that finds its operation_id row in one of these replays success rather
// than placing again. Anything not here and not pending/unknown is treated
// as a spent key.
const PLACED_STATUSES = new Set([
  'accepted', 'new', 'pending_new', 'accepted_for_bidding', 'calculated',
  'partially_filled', 'filled', 'done_for_day', 'replaced',
]);

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Declared outside the try block on purpose (code-reviewer finding,
  // 2026-09-07): a `let` inside try is not visible to the catch block below
  // (separate scopes). Every code path that can THROW after a row is
  // reserved either handles its own cleanup locally (the order-placement
  // fetch's own try/catch marks 'unknown' and returns without rethrowing —
  // this outer catch is never reached for that case) or leaves the
  // exception to propagate here — e.g. the /v2/account fetch/json parse
  // has no try/catch of its own. Without this outer-scope variable, that
  // path fell into the outer catch with the row invisible to it: a stuck
  // 'pending' row that reconciliation can never see, since only 'unknown'
  // rows are reconciled (an unresolved 'pending' row is instead treated as
  // FINDING-A's genuinely-concurrent-duplicate case and just told to wait —
  // forever, for a request that already failed).
  let pendingRowId: string | null = null;
  // Set once the /v2/orders POST returns ANY HTTP response: from that point
  // the broker may hold the order, so the outer catch must not delete the
  // row (ROUND6 #98 item 3).
  let orderMayExist = false;

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

    // ── Enforce the paid-Pro paywall server-side ─────────────────
    // The React invest buttons already block non-paid users, but that's
    // client state — this is the actual enforcement point. Runs before the
    // body is even parsed, so a free/trial/downgraded caller gets a 403
    // with zero side effects (no pending row, no Alpaca call).
    // PENETRATION_TEST_PLAN.md 6.4 / SECURITY_THREAT_MODEL.md E4.
    const planBlock = await requirePaidPlan(supabase, user.id, corsHeaders);
    if (planBlock) return planBlock;

    // ── Parse request ────────────────────────────────────────────
    // A malformed body (e.g. a raw `Infinity` token, invalid per RFC 8259)
    // makes req.json() throw a SyntaxError — caught here specifically so it
    // returns a clean 400 instead of falling through to the general catch
    // below, which would report it to Sentry as a real server error
    // (PENETRATION_TEST_PLAN.md 3.5).
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { amount, symbol = 'SPY', operation_id } = body as { amount: unknown; symbol?: string; operation_id?: unknown };
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
    // Client-supplied idempotency key for one intentional purchase — sent
    // by newer clients and reused verbatim on every retry of the SAME
    // purchase (a lost response, an auto-retry). Absent from older clients:
    // those fall back to the (user, symbol, amount) unresolved-row dedup
    // only, exactly as before. When present it must be a UUID.
    const opId = operation_id == null ? null : String(operation_id);
    if (opId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opId)) {
      return new Response(JSON.stringify({ error: 'Invalid operation_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Load user's Alpaca access token from profiles ────────────
    // Moved ahead of the pending-row reservation (independent audit
    // 2026-09-07) — the reconcile-with-broker path below needs it too, and
    // there's no reason to reserve a row at all for a user who isn't even
    // connected.
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

    // No-arg closure over the outer pendingRowId (not a parameter) so every
    // call site stays correct even though pendingRowId's static type is
    // `string | null` (TS can't narrow it across the reservation branches
    // above) — passing it as a required `string` argument would be a type
    // error `deno check` would catch that a plain reference here doesn't.
    async function releasePending() {
      await supabase.from('investments').delete().eq('id', pendingRowId);
    }

    // Post-send ambiguity: the /v2/orders POST returned an HTTP response, so
    // Alpaca may have accepted the order, but we can't read the outcome
    // (body parse failed — truncated response, connection dropped mid-body).
    // Same handling as a network failure ON the POST: NEVER delete the row
    // (that erases the client_order_id link a retry needs to reconcile) —
    // mark it 'unknown' and 503 so the next attempt confirms with the broker
    // first. Must not rethrow: the outer catch deletes the reservation.
    async function ambiguousAfterSend(phase: string, err: unknown): Promise<Response> {
      console.error(`alpaca-invest: ${phase}:`, err);
      const { error: markErr } = await supabase
        .from('investments')
        .update({ status: 'unknown' })
        .eq('id', pendingRowId);
      if (markErr) console.error(`alpaca-invest: failed to mark row unknown after ${phase}:`, markErr);
      await captureAndFlush(err, { function_name: 'alpaca-invest', pendingRowId, phase });
      return new Response(JSON.stringify({
        error: 'order_status_unknown',
        message: "We couldn't confirm whether your order went through. Please check back shortly before retrying.",
      }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Reserve (or resume) an operation row ──────────────────────
    // Independent audit 2026-09-07 (finding #4): the old scheme keyed both
    // the pending-row dedup constraint and Alpaca's client_order_id off a
    // per-minute window_bucket, and any failure — including an ambiguous
    // NETWORK failure where Alpaca may have already accepted the order —
    // deleted the reservation outright. A retry landing in the next minute
    // got a fresh client_order_id, so Alpaca's own client_order_id dedup
    // couldn't catch it either: same operation, placed twice.
    //
    // Fix: investments.id (stable for the row's whole lifecycle) is now
    // the Alpaca client_order_id, and the dedup key is (user, symbol,
    // amount) restricted to *unresolved* rows (status pending/unknown —
    // see investments_user_symbol_amount_open_key). An ambiguous outcome
    // marks the row 'unknown' instead of deleting it; a retry of the same
    // (symbol, amount) then reconciles with the broker before ever
    // sending a second order, while a genuinely new purchase (any
    // different amount or symbol, or the same one after this operation
    // reached a terminal status) is never blocked by it.
    // operation_id (newer clients) makes the reservation unique per
    // intentional purchase for its whole lifetime — NOT just while
    // unresolved. That is what closes REQ-3's full scope: a retry that
    // arrives AFTER a prior attempt already reached 'accepted' (our own 200
    // was lost in transit) resolves to the original row and replays its
    // outcome instead of placing a second order. investments_user_operation_key
    // raises 23505 on the second insert; the branch below reads the prior
    // row back by operation_id and replays it.
    const { data: pendingRow, error: pendingErr } = await supabase
      .from('investments')
      .insert({ user_id: user.id, symbol: sym, amount: numAmount, status: 'pending', operation_id: opId })
      .select('id')
      .single();

    if (!pendingErr) {
      pendingRowId = pendingRow.id;
    } else if (pendingErr.code === '23505') {
      // Prefer the operation_id row when the client supplied one — it is
      // the authoritative key and, unlike the (symbol, amount) partial
      // index, it also matches a prior attempt that already resolved.
      let existingRow: { id: string; status: string; order_id: string | null; created_at: string; symbol?: string; amount?: number } | null = null;
      if (opId) {
        const { data: opRow, error: opErr } = await supabase
          .from('investments')
          .select('id, status, order_id, created_at, symbol, amount')
          .eq('user_id', user.id)
          .eq('operation_id', opId)
          .maybeSingle();
        if (opErr) {
          console.error('alpaca-invest: operation_id lookup failed:', opErr);
          await captureAndFlush(opErr, { function_name: 'alpaca-invest', phase: 'operation-id-lookup' });
          return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (opRow) {
          // Same key, different intent — never act on it, and don't leak
          // which is stored.
          if (opRow.symbol !== sym || Number(opRow.amount) !== numAmount) {
            return new Response(JSON.stringify({
              error: 'operation_parameters_mismatch',
              message: 'This purchase reference is already in use for a different amount or symbol. Start a new purchase.',
            }), {
              status: 409,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          const unresolved = opRow.status === 'pending' || opRow.status === 'unknown';
          // A real order was placed on the earlier attempt (our 200 was
          // lost) — replay it, place nothing.
          if (opRow.order_id || PLACED_STATUSES.has(opRow.status)) {
            return new Response(JSON.stringify({
              success:  true,
              order_id: opRow.order_id,
              status:   opRow.status,
              symbol:   sym,
              amount:   numAmount,
              message:  `Order placed: $${numAmount} in ${sym}`,
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          // Terminal but no order was placed (a prior attempt was rejected
          // and released; the row shouldn't normally survive that, but if
          // it does, don't act on this key again).
          if (!unresolved) {
            return new Response(JSON.stringify({
              success: false,
              error: 'previous_attempt_incomplete',
              message: 'This purchase reference is spent. Start a new purchase to try again.',
              symbol: sym,
              amount: numAmount,
            }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          // Still unresolved — hand off to the existing reconcile / wait
          // logic below with this exact row.
          existingRow = opRow;
        }
      }

      if (!existingRow) {
        const { data: saRow } = await supabase
          .from('investments')
          .select('id, status, order_id, created_at')
          .eq('user_id', user.id)
          .eq('symbol', sym)
          .eq('amount', numAmount)
          .in('status', ['pending', 'unknown'])
          .single();
        existingRow = saRow ?? null;
      }

      if (!existingRow) {
        // Conflicted against a row that vanished before we could read it
        // back (e.g. a concurrent request's own cleanup) — safe to treat
        // as "try again", same as any other transient 409.
        return new Response(JSON.stringify({
          error: 'This order was already submitted. Please wait a moment before retrying.',
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (existingRow.status === 'pending') {
        const reservedForMs = Date.now() - new Date(existingRow.created_at).getTime();
        if (reservedForMs < STALE_PENDING_MS) {
          // Genuinely concurrent duplicate (FINDING-A, unchanged) — another
          // request for this exact operation is actively in flight right now.
          return new Response(JSON.stringify({
            error: 'This order was already submitted. Please wait a moment before retrying.',
          }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // Older than any real in-flight run of this function could take —
        // the request that reserved this row died before resolving it
        // (process killed / isolate torn down between the reservation
        // INSERT and order placement). Left as-is it blocks every future
        // attempt at this (symbol, amount) with a 409 forever. Demote it to
        // 'unknown' so the reconciliation path below treats it exactly like
        // an ambiguous-outcome row: confirm with the broker via the stable
        // client_order_id before placing anything. The CAS on status keeps
        // two concurrent recoveries from both proceeding.
        console.error('alpaca-invest: recovering a stale pending reservation', existingRow.id, `(${Math.round(reservedForMs / 1000)}s old)`);
        const { error: demoteErr } = await supabase
          .from('investments')
          .update({ status: 'unknown' })
          .eq('id', existingRow.id)
          .eq('status', 'pending');
        if (demoteErr) console.error('alpaca-invest: failed to demote stale pending row:', demoteErr);
        existingRow.status = 'unknown';
      }

      // status === 'unknown' (or a stale 'pending' just demoted to it): a
      // PRIOR attempt at this exact (symbol, amount) got an ambiguous
      // outcome, or never finished. Ask Alpaca directly whether it actually
      // has this operation before doing anything else.
      const clientOrderId = `ark-${existingRow.id}`;
      let lookup: Response;
      try {
        lookup = await fetch(
          `${BASE_URL}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`,
          { headers: { Authorization: `Bearer ${alpacaToken}` } },
        );
      } catch (lookupErr) {
        console.error('alpaca-invest: broker reconciliation lookup failed:', lookupErr);
        await captureAndFlush(lookupErr, { function_name: 'alpaca-invest', pendingRowId: existingRow.id, phase: 'reconcile-lookup' });
        return new Response(JSON.stringify({
          error: 'order_status_unknown',
          message: "We couldn't confirm the status of your previous order. Please try again shortly.",
        }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (lookup.status === 404) {
        // Alpaca has no record of it — the earlier attempt's request never
        // actually reached/was processed by the broker. Safe to place the
        // order now, reusing this same row and client_order_id rather than
        // creating a new reservation.
        //
        // Claim the row atomically first (code-reviewer finding, 2026-09-
        // 07): two near-simultaneous retries can both read the same
        // 'unknown' existingRow and both get 404 from this same lookup —
        // without a compare-and-swap here, both would go on to POST
        // /v2/orders with the identical client_order_id, and the loser
        // would see Alpaca's own 422 "already exists" for a real order the
        // winner just placed. Flipping status back to 'pending' here,
        // gated on it still being 'unknown', makes only one of them win;
        // the other sees 0 rows updated and backs off exactly like
        // FINDING-A's original concurrent-duplicate case.
        const { data: claimedRow, error: claimErr } = await supabase
          .from('investments')
          .update({ status: 'pending' })
          .eq('id', existingRow.id)
          .eq('status', 'unknown')
          .select('id')
          .single();
        if (claimErr || !claimedRow) {
          return new Response(JSON.stringify({
            error: 'This order was already submitted. Please wait a moment before retrying.',
          }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        pendingRowId = existingRow.id;
      } else if (lookup.ok) {
        // Alpaca DOES have this order — the earlier "ambiguous" attempt
        // was in fact accepted. Reflect that in our row (idempotent if
        // already set) and return success without placing anything new.
        const brokerOrder = await lookup.json();
        const { error: syncErr } = await supabase
          .from('investments')
          .update({ order_id: brokerOrder.id, status: brokerOrder.status })
          .eq('id', existingRow.id);
        if (syncErr) console.error('alpaca-invest: failed to sync reconciled order onto existing row:', syncErr);
        return new Response(JSON.stringify({
          success:  true,
          order_id: brokerOrder.id,
          status:   brokerOrder.status,
          symbol:   sym,
          amount:   numAmount,
          message:  `Order placed: $${numAmount} in ${sym}`,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        // Some other non-2xx/non-404 from the lookup itself — can't
        // confirm either way, fail closed rather than risk a duplicate.
        console.error('alpaca-invest: broker reconciliation lookup returned', lookup.status);
        return new Response(JSON.stringify({
          error: 'order_status_unknown',
          message: "We couldn't confirm the status of your previous order. Please try again shortly.",
        }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      console.error('alpaca-invest: pending row insert failed:', pendingErr);
      await captureAndFlush(pendingErr, { function_name: 'alpaca-invest' });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // From here on, any definite-failure early return must clean up the
    // reservation first — otherwise a legitimate retry after a real
    // failure (network blip, insufficient funds, Alpaca rejection) would
    // stay blocked by its own dead reservation.

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

      // Not the raw stringified body — on a non-401/403 error this is
      // normally just Alpaca's {code,message} error shape, not real
      // account data, but logging any raw third-party response body
      // verbatim is the exact pattern already fixed elsewhere in this
      // codebase (financial-diagnosis/daily-lesson-v2's aiErr fixes) —
      // same hygiene applied here defensively (security-auditor finding
      // on the sibling alpaca-portfolio function, 2026-08-24).
      console.error('Alpaca account error:', accountRes.status, account?.code, account?.message);
      await releasePending();
      return new Response(JSON.stringify({ error: 'brokerage_account_error' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const buyingPower = parseFloat(account.buying_power);
    if (buyingPower < numAmount) {
      await releasePending();
      return new Response(JSON.stringify({
        error: `Insufficient buying power. Available: $${buyingPower.toFixed(2)}`,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Place fractional order ───────────────────────────────────
    // client_order_id is investments.id itself — stable across every retry
    // of this exact (user, symbol, amount) operation for as long as the
    // row stays unresolved (pending/unknown), and kept as defense-in-depth
    // alongside the DB-level dedup above, not the primary guard.
    const clientOrderId = `ark-${pendingRowId}`;

    let orderRes: Response;
    try {
      orderRes = await fetch(`${BASE_URL}/v2/orders`, {
        method: 'POST',
        headers: {
          Authorization:   `Bearer ${alpacaToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          symbol:          sym,
          notional:        String(numAmount.toFixed(2)),
          side:            'buy',
          type:            'market',
          time_in_force:   'day',
          client_order_id: clientOrderId,
        }),
      });
      // The POST got an HTTP response — Alpaca MAY hold this order now.
      // From here on, no failure path may delete the reservation; the
      // worst it may do is mark it 'unknown' for the retry to reconcile.
      orderMayExist = true;
    } catch (networkErr) {
      // Ambiguous: the request may or may not have reached Alpaca before
      // the connection failed. Do NOT delete the reservation — that would
      // erase the only trace of a potentially-accepted order and let a
      // retry place a second one. Mark it 'unknown' instead; the next
      // request for this same (symbol, amount) will reconcile with the
      // broker before doing anything else (see the 23505 branch above).
      console.error('alpaca-invest: order placement network error:', networkErr);
      const { error: markErr } = await supabase
        .from('investments')
        .update({ status: 'unknown' })
        .eq('id', pendingRowId);
      if (markErr) console.error('alpaca-invest: failed to mark row unknown after network error:', markErr);
      await captureAndFlush(networkErr, { function_name: 'alpaca-invest', pendingRowId, phase: 'order-placement' });
      return new Response(JSON.stringify({
        error: 'order_status_unknown',
        message: "We couldn't confirm whether your order went through. Please check back shortly before retrying.",
      }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let order: any;
    try {
      order = await orderRes.json();
    } catch (parseErr) {
      return await ambiguousAfterSend('order response body parse failed', parseErr);
    }

    if (!orderRes.ok) {
      console.error('Alpaca order error:', JSON.stringify(order));
      const isDuplicate = orderRes.status === 422
        && typeof order?.message === 'string'
        && order.message.toLowerCase().includes('client order id');

      if (isDuplicate) {
        // Alpaca says THIS client_order_id already exists — that can only
        // mean a real order was placed under it already (by us, on an
        // earlier attempt, or by a concurrent retry that won the CAS
        // above). Releasing the row here would erase the only trace of
        // that real order (code-reviewer finding, 2026-09-07) — reconcile
        // instead, same as the 23505 branch does for a stale 'unknown' row.
        let recheck: Response;
        try {
          recheck = await fetch(
            `${BASE_URL}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`,
            { headers: { Authorization: `Bearer ${alpacaToken}` } },
          );
        } catch (recheckErr) {
          console.error('alpaca-invest: post-duplicate reconciliation failed:', recheckErr);
          const { error: markErr } = await supabase.from('investments').update({ status: 'unknown' }).eq('id', pendingRowId);
          if (markErr) console.error('alpaca-invest: failed to mark row unknown after post-duplicate reconcile failure:', markErr);
          await captureAndFlush(recheckErr, { function_name: 'alpaca-invest', pendingRowId, phase: 'post-duplicate-reconcile' });
          return new Response(JSON.stringify({
            error: 'order_status_unknown',
            message: "We couldn't confirm whether your order went through. Please check back shortly before retrying.",
          }), {
            status: 503,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (recheck.ok) {
          let brokerOrder: any;
          try {
            brokerOrder = await recheck.json();
          } catch (parseErr) {
            return await ambiguousAfterSend('post-duplicate reconcile body parse failed', parseErr);
          }
          const { error: syncErr } = await supabase
            .from('investments')
            .update({ order_id: brokerOrder.id, status: brokerOrder.status })
            .eq('id', pendingRowId);
          if (syncErr) console.error('alpaca-invest: failed to sync post-duplicate reconciled order:', syncErr);
          return new Response(JSON.stringify({
            success:  true,
            order_id: brokerOrder.id,
            status:   brokerOrder.status,
            symbol:   sym,
            amount:   numAmount,
            message:  `Order placed: $${numAmount} in ${sym}`,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Alpaca says duplicate but the lookup itself can't confirm it —
        // still ambiguous, fail closed rather than release.
        console.error('alpaca-invest: post-duplicate reconciliation lookup returned', recheck.status);
        const { error: markErr } = await supabase.from('investments').update({ status: 'unknown' }).eq('id', pendingRowId);
        if (markErr) console.error('alpaca-invest: failed to mark row unknown after inconclusive post-duplicate reconcile:', markErr);
        return new Response(JSON.stringify({
          error: 'order_status_unknown',
          message: "We couldn't confirm whether your order went through. Please check back shortly before retrying.",
        }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // A 5xx is AMBIGUOUS, not a rejection: Alpaca may have accepted the
      // order before its gateway failed the response. Treat it like the
      // network / parse-failure paths — mark the row 'unknown' and 503 so
      // the retry reconciles via client_order_id, never releasePending()
      // (ROUND6 #98 item 3).
      if (orderRes.status >= 500) {
        return await ambiguousAfterSend(`Alpaca ${orderRes.status} on order placement`, order);
      }

      // A real, definite, non-duplicate 4xx rejection FROM Alpaca — safe to
      // release (unlike the ambiguous cases above).
      await releasePending();
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
      amount:   numAmount,
      message:  `Order placed: $${numAmount} in ${sym}`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('alpaca-invest error:', err);
    // A throw reaching here after the /v2/orders POST already returned a
    // response (e.g. the confirm-write path throwing on a `null` body) must
    // NOT delete the row — the broker may hold the order. Mark it 'unknown'
    // so the retry reconciles via client_order_id (ROUND6 #98 item 3).
    // Only when no order POST got a response this request (the /v2/account
    // fetch/json parse throwing, a reservation-path error) is deleting the
    // reservation safe — otherwise a stuck 'pending' row blocks this
    // (symbol, amount) forever, since reconciliation only ever picks up
    // 'unknown' rows.
    if (pendingRowId) {
      if (orderMayExist) {
        const { error: markErr } = await supabase
          .from('investments')
          .update({ status: 'unknown' })
          .eq('id', pendingRowId);
        if (markErr) console.error('alpaca-invest: failed to mark row unknown in outer catch:', markErr);
      } else {
        await supabase.from('investments').delete().eq('id', pendingRowId);
      }
    }
    await captureAndFlush(err, { function_name: 'alpaca-invest' });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// Serve unless imported by the edge-function test harness, which sets
// ARK_EDGE_TEST and calls handler() directly. Unset in prod — serves normally.
if (!Deno.env.get('ARK_EDGE_TEST')) Deno.serve(handler);
