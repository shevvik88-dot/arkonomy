import Stripe from 'npm:stripe@14';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('stripe-webhook');

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

Deno.serve(async (req) => {
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
  // event was already processed (e.g. checkout.session.completed would
  // otherwise recompute trial_ends_at = now() + 7 days on every
  // redelivery, silently extending the trial with zero attacker action).
  //
  // Known gap: insert and side-effects are not in one transaction — if the
  // function crashes between them, the event is marked processed but the
  // side-effect didn't apply, and Stripe's retry will be silently ignored.
  // See SECURITY_THREAT_MODEL.md.
  const { error: dedupErr } = await supabase
    .from('stripe_webhook_events')
    .insert({ event_id: event.id });
  if (dedupErr) {
    if (dedupErr.code === '23505') {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.error('stripe-webhook: dedup insert failed:', dedupErr);
    await captureAndFlush(dedupErr, { function_name: 'stripe-webhook', event_id: event.id });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId     = session.client_reference_id;
      const customerId = session.customer as string;

      if (userId) {
        const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        // A real Stripe charge/subscription was just created above (Stripe
        // itself, before this handler ever runs) — if this UPDATE matches 0
        // rows, the profile was deleted out from under it (delete-account
        // race — a Checkout Session stays completable up to 24h after
        // creation, well past delete-account's own short-lived guards) and
        // Arkonomy has been paid for a service it can no longer grant to
        // anyone. Alert on it rather than let it stay silent (previously:
        // `if (error)` never fired because a 0-row-match isn't an error).
        const { data: updatedRows, error } = await supabase
          .from('profiles')
          .update({ plan: 'pro', stripe_customer_id: customerId, trial_ends_at: trialEndsAt, checkout_pending_at: null, checkout_session_id: null })
          .eq('id', userId)
          .select('id');

        if (error) console.error('Failed to update profile to trial:', error);
        if (error || !updatedRows?.length) {
          await captureAndFlush(
            new Error('stripe-webhook: checkout.session.completed update matched 0 rows — possible delete-account race'),
            { function_name: 'stripe-webhook', event_id: event.id, user_id: userId },
          );
        }
      }
    }

    // Releases the stripe-checkout FINDING-C guard so the user can start a
    // new checkout — an expired session means they never completed
    // payment, not that one is still in flight.
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      if (userId) {
        const { error } = await supabase
          .from('profiles')
          .update({ checkout_pending_at: null, checkout_session_id: null })
          .eq('id', userId);
        if (error) console.error('Failed to clear checkout_pending_at on expiry:', error);
      }
    }

    // Trial converts to paid subscription after first real charge
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      // Only clear trial on subscription cycle (not the $0 trial invoice)
      if ((invoice as any).billing_reason === 'subscription_cycle' && Number(invoice.amount_paid) > 0) {
        const { error } = await supabase
          .from('profiles')
          .update({ trial_ends_at: null })
          .eq('stripe_customer_id', customerId);
        if (error) console.error('Failed to clear trial_ends_at:', error);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;

      const { error } = await supabase
        .from('profiles')
        .update({ plan: 'free', trial_ends_at: null })
        .eq('stripe_customer_id', customerId);

      if (error) console.error('Failed to downgrade profile:', error);
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      if (invoice.next_payment_attempt === null) {
        const { error } = await supabase
          .from('profiles')
          .update({ plan: 'free' })
          .eq('stripe_customer_id', customerId);
        if (error) console.error('Failed to downgrade profile on payment failure:', error);
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      const plan = sub.status === 'active' || sub.status === 'trialing' ? 'pro' : 'free';
      const { error } = await supabase
        .from('profiles')
        .update({ plan })
        .eq('stripe_customer_id', customerId);
      if (error) console.error('Failed to sync subscription update:', error);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('stripe-webhook handler error:', err);
    await captureAndFlush(err, { function_name: 'stripe-webhook' });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
