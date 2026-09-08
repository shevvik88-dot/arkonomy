import Stripe from 'npm:stripe@14';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('stripe-webhook');

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY');
  const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.text();
  let event: Stripe.Event;

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return new Response('Webhook secret not configured', { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return new Response('Missing stripe-signature', { status: 400 });
  }
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response(`Webhook Error: ${"Internal Server Error"}`, { status: 400 });
  }

  // Idempotency: Stripe delivers at-least-once — retries on non-2xx and
  // manual dashboard resends can redeliver the same event.id. Insert it
  // first, before any side effect; a PRIMARY KEY conflict means this
  // event.id was already seen (e.g. checkout.session.completed would
  // otherwise recompute trial_ends_at = now() + 7 days on every
  // redelivery, silently extending the trial with zero attacker action).
  //
  // `status` (independent-audit fix, 2026-09-07) closes the gap the
  // insert-only version had: insert and side-effect were never one
  // transaction, so a crash/error between them left the event permanently
  // marked "seen" with its side effect never applied, and Stripe's retry
  // was silently swallowed by the dedup row alone. See
  // 20260907000000_stripe_webhook_events_status.sql for the state machine.
  const STALE_PROCESSING_MS = 60_000;
  let retryingStale = false;

  const { error: dedupErr } = await supabase
    .from('stripe_webhook_events')
    .insert({ event_id: event.id, status: 'processing' });

  if (dedupErr) {
    if (dedupErr.code === '23505') {
      const { data: existing, error: fetchErr } = await supabase
        .from('stripe_webhook_events')
        .select('status, processed_at')
        .eq('event_id', event.id)
        .single();

      // Row vanished between the conflict and this read — the only way
      // that happens is a concurrent attempt's own catch block deleting it
      // after a failed side effect (code-reviewer finding, 2026-09-07:
      // acking 200/duplicate here, as this branch originally did, is
      // exactly what stops Stripe from ever redelivering — the effect may
      // never have been applied at all, "it'll come back on its own retry
      // cadence" was false). Fail closed instead so Stripe redelivers; the
      // next attempt finds no row and inserts fresh, running the effect
      // for real.
      if (fetchErr || !existing) {
        console.error('stripe-webhook: dedup row vanished mid-flight for event', event.id, fetchErr);
        await captureAndFlush(fetchErr ?? new Error('stripe-webhook: dedup row vanished mid-flight'), { function_name: 'stripe-webhook', event_id: event.id });
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (existing.status === 'completed') {
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // status === 'processing': either another delivery is genuinely
      // in flight right now (resolves in milliseconds — ack without
      // reapplying, so the effect still runs exactly once) or a prior
      // attempt crashed before reaching its own cleanup and left this
      // stuck forever otherwise. Age is the only way to tell them apart.
      const age = Date.now() - new Date(existing.processed_at as string).getTime();
      if (age < STALE_PROCESSING_MS) {
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Stale — a prior attempt crashed before finishing. Claim the row
      // atomically before falling through: two concurrent retries can both
      // read the same stale 'processing' row here, and without this
      // compare-and-swap both would re-run the side effect. The optimistic
      // lock is on the exact processed_at we just read — only one retry
      // wins the UPDATE; the loser sees 0 rows and acks as a duplicate,
      // exactly like the genuinely-concurrent fresh case above.
      const { data: claimed, error: claimErr } = await supabase
        .from('stripe_webhook_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('event_id', event.id)
        .eq('status', 'processing')
        .eq('processed_at', existing.processed_at as string)
        .select('event_id');
      if (claimErr) {
        console.error('stripe-webhook: failed to claim stale processing row:', claimErr);
        await captureAndFlush(claimErr, { function_name: 'stripe-webhook', event_id: event.id });
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!claimed?.length) {
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Won the claim — fall through and (re)run the side effect, reusing
      // the existing row (no new insert needed).
      retryingStale = true;
    } else {
      console.error('stripe-webhook: dedup insert failed:', dedupErr);
      await captureAndFlush(dedupErr, { function_name: 'stripe-webhook', event_id: event.id });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
  if (retryingStale) {
    console.warn(`stripe-webhook: retrying stale 'processing' event ${event.id} (previous attempt never completed)`);
  }

  // Cross-event ordering (independent review of #97, P1b). The event_id
  // dedup/CAS above orders redeliveries of ONE event; it does nothing
  // between DIFFERENT events. profiles.stripe_event_at records the
  // `created` of the last event applied to a row, so a redelivered older
  // event (e.g. a stale checkout.session.completed after a
  // customer.subscription.deleted) becomes a no-op regardless of type.
  const eventAt = new Date(
    (typeof event.created === 'number' ? event.created : Math.floor(Date.now() / 1000)) * 1000,
  ).toISOString();

  // Apply subscription-state `fields` to the profile matched by col=val
  // only if THIS event is strictly newer than the last one applied there.
  // stripe_event_at is NOT NULL (epoch default), so a single `lt` filter
  // is enough — no `is.null OR lt.x`, which postgrest-js mis-compiles into
  // a "column does not exist" when `.select()` is also chained.
  // Returns the matched rows ([] = superseded, or no such row).
  async function applyOrdered(col: 'id' | 'stripe_customer_id', val: string, fields: Record<string, unknown>) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...fields, stripe_event_at: eventAt })
      .eq(col, val)
      .lt('stripe_event_at', eventAt)
      .select('id');
    if (error) throw error;
    return data ?? [];
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId     = session.client_reference_id;
      const customerId = session.customer as string;

      if (userId) {
        // Derive the trial end from the Checkout Session's own immutable
        // creation timestamp, NOT Date.now(): a stale-'processing' retry
        // (or any redelivery that reaches this side effect) must compute
        // the IDENTICAL value every time. session.created is Unix seconds.
        const createdMs = typeof session.created === 'number'
          ? session.created * 1000
          : Date.now();
        const trialEndsAt = new Date(createdMs + 7 * 24 * 60 * 60 * 1000).toISOString();

        // Plan/customer/trial — gated on cross-event ordering.
        const applied = await applyOrdered('id', userId, {
          plan: 'pro', stripe_customer_id: customerId, trial_ends_at: trialEndsAt,
        });
        if (!applied.length) {
          // 0 rows: either a newer event already moved this profile on
          // (benign no-op) or the profile was deleted mid-flight
          // (delete-account race — Arkonomy was paid for a plan it can no
          // longer grant). Distinguish the two.
          const { data: exists } = await supabase
            .from('profiles').select('id').eq('id', userId).maybeSingle();
          if (!exists) {
            await captureAndFlush(
              new Error('stripe-webhook: checkout.session.completed update matched 0 rows — possible delete-account race'),
              { function_name: 'stripe-webhook', event_id: event.id, user_id: userId },
            );
          } else {
            console.warn(`stripe-webhook: checkout.session.completed ${event.id} superseded by a newer event — not re-applying pro`);
          }
        }

        // Clear the checkout guard fields ONLY if they still point at THIS
        // session — a stale completed event must not wipe a newer checkout
        // the user has since started. Independent of the ordering guard
        // above (that keys on `id`; this keys on the session).
        if (session.id) {
          const { error: clearErr } = await supabase
            .from('profiles')
            .update({ checkout_pending_at: null, checkout_session_id: null })
            .eq('id', userId)
            .eq('checkout_session_id', session.id);
          if (clearErr) { console.error('stripe-webhook: failed to clear checkout guard fields:', clearErr); throw clearErr; }
        }
      }
    }

    // Releases the stripe-checkout FINDING-C guard so the user can start a
    // new checkout — an expired session means they never completed
    // payment, not that one is still in flight.
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      if (userId && session.id) {
        // Scoped to this specific session id (independent-audit finding
        // #3) — without it, a session's expiry event arriving late (up to
        // Stripe's own delivery/retry window) could clear a DIFFERENT,
        // newer checkout_session_id/checkout_pending_at the user had
        // already started since, reopening the double-checkout window
        // stripe-checkout's own guard exists to close.
        const { error } = await supabase
          .from('profiles')
          .update({ checkout_pending_at: null, checkout_session_id: null })
          .eq('id', userId)
          .eq('checkout_session_id', session.id);
        if (error) { console.error('Failed to clear checkout_pending_at on expiry:', error); throw error; }
      }
    }

    // Trial converts to paid subscription after first real charge
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      // Only clear trial on subscription cycle (not the $0 trial invoice)
      if ((invoice as any).billing_reason === 'subscription_cycle' && Number(invoice.amount_paid) > 0) {
        await applyOrdered('stripe_customer_id', customerId, { trial_ends_at: null });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;

      // Downgrade AND cut the brokerage connection. alpaca-invest /
      // alpaca-oauth-start / alpaca-portfolio now gate on plan (E4 fix), but
      // a stored, still-valid Alpaca token on a now-free account is dead
      // weight and a standing risk if any future code path forgets the gate
      // — invalidate it the same way alpaca-invest does on a stale token
      // (null the columns; no app path can use them after this).
      // PENETRATION_TEST_PLAN.md 6.4.
      await applyOrdered('stripe_customer_id', customerId, {
        plan: 'free',
        trial_ends_at: null,
        alpaca_access_token: null,
        alpaca_refresh_token: null,
        alpaca_account_id: null,
        alpaca_connected_at: null,
      });
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      if (invoice.next_payment_attempt === null) {
        await applyOrdered('stripe_customer_id', customerId, {
          plan: 'free',
          alpaca_access_token: null,
          alpaca_refresh_token: null,
          alpaca_account_id: null,
          alpaca_connected_at: null,
        });
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      const isActive = sub.status === 'active' || sub.status === 'trialing';
      const plan = isActive ? 'pro' : 'free';
      // Same brokerage-token teardown as the delete/payment-failed branches
      // when this update is the one that drops the user to free.
      const downgradeFields = isActive
        ? {}
        : {
            alpaca_access_token: null,
            alpaca_refresh_token: null,
            alpaca_account_id: null,
            alpaca_connected_at: null,
          };
      await applyOrdered('stripe_customer_id', customerId, { plan, ...downgradeFields });
    }

    // Mark this event fully applied so a later redelivery short-circuits
    // above instead of reapplying. A failure to write this specific
    // update is logged/reported but not fatal — every branch above is
    // itself idempotent (same plan/trial_ends_at write twice is
    // harmless), so worst case a future redelivery just reruns the same
    // no-op effect instead of the ideal "duplicate: true" ack.
    const { error: completeErr } = await supabase
      .from('stripe_webhook_events')
      .update({ status: 'completed' })
      .eq('event_id', event.id);
    if (completeErr) {
      console.error('stripe-webhook: failed to mark event completed:', completeErr);
      await captureAndFlush(completeErr, { function_name: 'stripe-webhook', event_id: event.id });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('stripe-webhook handler error:', err);
    // Delete rather than leave the row stuck at 'processing' — lets an
    // immediate retry actually reapply the effect instead of being told
    // "duplicate" for up to STALE_PROCESSING_MS. A crash that skips this
    // catch entirely (the whole instance dying, not a normal throw) still
    // self-heals via the staleness check above on the next delivery.
    const { error: cleanupErr } = await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
    if (cleanupErr) console.error('stripe-webhook: failed to clean up dedup row after error:', cleanupErr);
    await captureAndFlush(err, { function_name: 'stripe-webhook' });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// Serve unless imported by the edge-function test harness, which sets
// ARK_EDGE_TEST and calls handler() directly. Unset in prod — serves normally.
if (!Deno.env.get('ARK_EDGE_TEST')) Deno.serve(handler);
