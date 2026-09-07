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

export async function handler(req: Request): Promise<Response> {
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
    // checkout.session.completed.
    //
    // Independent-audit finding #3: the mutex below only ever had a fixed
    // 15-minute TTL, unrelated to how long a real Checkout Session stays
    // completable (up to 24h, Stripe's default). Once 15 minutes passed,
    // a second attempt could reacquire the mutex and mint session B while
    // session A — created by the first attempt — was still perfectly
    // payable, so completing both meant two subscriptions. Fix: before
    // ever touching the mutex, confirm with Stripe itself whether the
    // profile's last known session is still open, and if so reuse it —
    // this is authoritative regardless of how much time has passed,
    // unlike any local timestamp heuristic.
    // Code-reviewer finding, 2026-09-07: this used to discard `error`
    // entirely. Everything below — the reuse-or-close check, which
    // customer to bill, whether a lock is even held — depends on reading
    // this row correctly; proceeding on a failed read as if the profile
    // had no prior session/customer at all is exactly how two sessions end
    // up simultaneously completable. Fail closed instead.
    const { data: profileBefore, error: profileBeforeErr } = await supabase
      .from('profiles')
      .select('stripe_customer_id, checkout_session_id')
      .eq('id', user.id)
      .single();

    if (profileBeforeErr) {
      console.error('stripe-checkout: failed to read profile before checkout:', profileBeforeErr);
      await captureAndFlush(profileBeforeErr, { function_name: 'stripe-checkout' });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (profileBefore?.checkout_session_id) {
      const staleSessionId = profileBefore.checkout_session_id;
      let stillOpen: boolean;
      let reusableUrl: string | null = null;
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(staleSessionId);
        stillOpen = existingSession.status === 'open';
        reusableUrl = existingSession.url;
      } catch (err: any) {
        if (err?.statusCode === 404) {
          // Session id Stripe no longer recognizes — safe to treat as not open.
          stillOpen = false;
        } else {
          // Can't confirm either way (network/Stripe-side error) — fail
          // closed rather than risk minting a second session while the
          // first might still be completable.
          console.error('stripe-checkout: failed to verify existing session:', err);
          await captureAndFlush(err, { function_name: 'stripe-checkout', checkout_session_id: staleSessionId });
          return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      if (stillOpen) {
        // Reuse rather than create a second concurrently-completable
        // session — safe to return unconditionally: a concurrent duplicate
        // request landing here too just gets handed the same URL back.
        return new Response(JSON.stringify({ url: reusableUrl }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Confirmed closed (completed/expired/canceled) — release the guard
      // fields ourselves rather than wait for stripe-webhook's own
      // checkout.session.expired handling, scoped to this exact session id
      // so we never clobber a different session another request may have
      // just started. Best-effort: if this loses a race to a concurrent
      // request already past this point, that request's own CAS below is
      // still the real guard.
      await supabase
        .from('profiles')
        .update({ checkout_pending_at: null, checkout_session_id: null })
        .eq('id', user.id)
        .eq('checkout_session_id', staleSessionId);
    }

    // Second, complementary guard against the narrower race Stripe can't
    // see for us above: two near-simultaneous requests both reaching this
    // point with no checkout_session_id yet (double tab, double click
    // before redirect) — atomic check-and-set on profiles.checkout_pending_at.
    // This mutex only needs to cover the short window until the session
    // below is created and its id stored — actual session lifetime is now
    // handled entirely by the Stripe-verified check above, so its own TTL
    // here is just a safety net against a crashed request that acquired
    // the mutex but never got as far as storing a session id at all.
    // Detect "did this UPDATE win the lock" via the affected-row count, not
    // a returned row. The .or() filter is on checkout_pending_at itself, and
    // the UPDATE sets that column — so `return=representation` can't be used
    // to tell acquisition from rejection: PostgREST 14 re-applies the filter
    // to the returned rows, and the just-written `now()` value no longer
    // satisfies `IS NULL OR < (now - 15m)`, so the representation comes back
    // empty even on a successful lock (and older PostgREST 42703s outright
    // when a filtered column is absent from the select list). `count: 'exact'`
    // reflects the UPDATE's own WHERE: 1 = we acquired it, 0 = someone else
    // holds a fresh lock.
    const { count: lockAcquired, error: lockErr } = await supabase
      .from('profiles')
      .update({ checkout_pending_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', user.id)
      .or('checkout_pending_at.is.null,checkout_pending_at.lt.' + new Date(Date.now() - 15 * 60 * 1000).toISOString());

    if (lockErr) {
      console.error('stripe-checkout: checkout_pending_at check failed:', lockErr);
      await captureAndFlush(lockErr, { function_name: 'stripe-checkout' });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!lockAcquired) {
      return new Response(JSON.stringify({
        error: 'A checkout is already in progress. Please finish or cancel it before starting another.',
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode:                'subscription',
      client_reference_id: user.id,
      // Reuse the known customer if we have one (e.g. a prior cancelled
      // subscription) instead of letting Stripe mint yet another duplicate
      // customer object for the same person.
      ...(profileBefore?.stripe_customer_id
        ? { customer: profileBefore.stripe_customer_id }
        : { customer_email: user.email }),
      line_items: [
        { price: STRIPE_PRICE_ID, quantity: 1 },
      ],
      subscription_data: { trial_period_days: 7 },
      success_url: `${APP_URL}?trial_started=true`,
      cancel_url:  `${APP_URL}?trial_cancelled=true`,
    });

    // Recorded alongside checkout_pending_at (not instead of it) so
    // delete-account can actively expire this specific Stripe session —
    // checkout_pending_at's own 15-min TTL doesn't reflect how long the
    // real session stays completable (up to 24h, Stripe's default).
    const { error: sessionIdErr } = await supabase
      .from('profiles')
      .update({ checkout_session_id: session.id })
      .eq('id', user.id);

    if (sessionIdErr) {
      // Code-reviewer finding, 2026-09-07: a real, live, completable Stripe
      // session now exists with nothing locally recording it — exactly the
      // state this whole fix exists to prevent (a later request's
      // reuse-or-close check has no session id to find, so it would go on
      // to mint a second one while this first one is still payable). Best-
      // effort expire the session we just created so it can't be
      // completed, release the mutex so a clean retry isn't blocked for up
      // to 15 minutes, and fail the request rather than hand back a URL
      // this system no longer knows about.
      console.error('stripe-checkout: failed to store checkout_session_id, expiring the session:', sessionIdErr);
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireErr) {
        console.error('stripe-checkout: failed to expire orphaned session:', expireErr);
      }
      await supabase.from('profiles').update({ checkout_pending_at: null }).eq('id', user.id);
      await captureAndFlush(sessionIdErr, { function_name: 'stripe-checkout', checkout_session_id: session.id });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
}

// Serve unless imported by the edge-function test harness, which sets
// ARK_EDGE_TEST and calls handler() directly. Unset in prod — serves normally.
if (!Deno.env.get('ARK_EDGE_TEST')) Deno.serve(handler);
