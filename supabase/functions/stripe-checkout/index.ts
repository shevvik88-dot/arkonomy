import Stripe from 'npm:stripe@14';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';
import { findActiveSubscription } from '../_shared/stripeSubscription.ts';

initSentry('stripe-checkout');

const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com';
const corsHeaders = {
  'Access-Control-Allow-Origin': APP_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
    const STRIPE_PRICE_ID   = Deno.env.get('STRIPE_PRICE_ID');

    if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID) {
      return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY or STRIPE_PRICE_ID not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify auth
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

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

    // Block a second subscription outright. Searches by email against
    // Stripe directly (not just profiles.stripe_customer_id) — that link
    // can be stale or wrong, which is exactly how a user can end up
    // double-billed: a prior checkout created customer A with an active
    // subscription, a later checkout created customer B and overwrote
    // stripe_customer_id with B, leaving A active, paying, and invisible
    // to the app forever.
    if (!user.email) {
      return new Response(JSON.stringify({ error: 'Account has no email on file' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const existing = await findActiveSubscription(stripe, user.email);
    if (existing) {
      return new Response(JSON.stringify({
        error: 'You already have an active subscription.',
        status: existing.status,
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // findActiveSubscription above only catches a subscription that
    // already exists in Stripe — it can't see a checkout that's in
    // flight (session created, payment not yet completed), since the
    // subscription itself is only created later, async, on
    // checkout.session.completed. Second, complementary guard: atomic
    // check-and-set on profiles.checkout_pending_at, reset by
    // stripe-webhook on checkout.session.completed/.expired. Without
    // this, two near-simultaneous checkout attempts (double tab, double
    // click before redirect) both pass the check above and both get a
    // valid session.
    const { data: lockedProfile, error: lockErr } = await supabase
      .from('profiles')
      .update({ checkout_pending_at: new Date().toISOString() })
      .eq('id', user.id)
      .or('checkout_pending_at.is.null,checkout_pending_at.lt.' + new Date(Date.now() - 15 * 60 * 1000).toISOString())
      .select('id')
      .maybeSingle();

    if (lockErr) {
      console.error('stripe-checkout: checkout_pending_at check failed:', lockErr);
      await captureAndFlush(lockErr, { function_name: 'stripe-checkout' });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!lockedProfile) {
      return new Response(JSON.stringify({
        error: 'A checkout is already in progress. Please finish or cancel it before starting another.',
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    const session = await stripe.checkout.sessions.create({
      mode:                'subscription',
      client_reference_id: user.id,
      // Reuse the known customer if we have one (e.g. a prior cancelled
      // subscription) instead of letting Stripe mint yet another duplicate
      // customer object for the same person.
      ...(profile?.stripe_customer_id
        ? { customer: profile.stripe_customer_id }
        : { customer_email: user.email }),
      line_items: [
        { price: STRIPE_PRICE_ID, quantity: 1 },
      ],
      subscription_data: { trial_period_days: 7 },
      success_url: `${APP_URL}?trial_started=true`,
      cancel_url:  `${APP_URL}?trial_cancelled=true`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('stripe-checkout error:', err);
    await captureAndFlush(err, { function_name: 'stripe-checkout' });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
