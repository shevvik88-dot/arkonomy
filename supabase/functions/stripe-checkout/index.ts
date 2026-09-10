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
      .select('stripe_customer_id, checkout_session_id, checkout_pending_at, checkout_attempt_key')
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
      // 'open'     — still payable, reuse it.
      // 'complete' — the user already paid on this session; a subscription
      //              exists (or is about to, via the webhook). Must NOT
      //              mint a second session even though findActiveSubscription
      //              above didn't see the subscription yet — that check ran
      //              before this session completed. 409.
      // 'expired'  — abandoned; release the guard and let a new checkout
      //              through below.
      // 404        — Stripe no longer knows this id; treat as abandoned.
      // anything else / a Stripe error — can't confirm, fail closed.
      let sessionStatus: 'open' | 'complete' | 'expired' | 'gone' = 'gone';
      let reusableUrl: string | null = null;
      let completedSubId: string | null = null;
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(staleSessionId);
        reusableUrl = existingSession.url;
        completedSubId = typeof existingSession.subscription === 'string'
          ? existingSession.subscription
          : (existingSession.subscription?.id ?? null);
        if (existingSession.status === 'open') sessionStatus = 'open';
        else if (existingSession.status === 'complete') sessionStatus = 'complete';
        else if (existingSession.status === 'expired') sessionStatus = 'expired';
        else {
          // A status Stripe may add later — do not assume it's safe to
          // mint a second session.
          console.error('stripe-checkout: unexpected existing session status:', existingSession.status);
          return new Response(JSON.stringify({ error: 'checkout_state_unclear', message: 'A previous checkout is still being finalised. Please try again shortly.' }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (err: any) {
        if (err?.statusCode === 404) {
          sessionStatus = 'gone';
        } else {
          console.error('stripe-checkout: failed to verify existing session:', err);
          await captureAndFlush(err, { function_name: 'stripe-checkout', checkout_session_id: staleSessionId });
          return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      if (sessionStatus === 'open') {
        // Reuse rather than create a second concurrently-completable
        // session — safe to return unconditionally: a concurrent duplicate
        // request landing here too just gets handed the same URL back.
        return new Response(JSON.stringify({ url: reusableUrl }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (sessionStatus === 'complete') {
        // The prior session was paid. The webhook will (or already did)
        // set plan=pro; either way there's a live subscription for this
        // customer, so do not start another checkout. Verify against the
        // subscription when the session carries one, to fail closed rather
        // than open if Stripe's data is momentarily inconsistent.
        let subActive = true;
        if (completedSubId) {
          try {
            const sub = await stripe.subscriptions.retrieve(completedSubId);
            subActive = sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due' || sub.status === 'incomplete';
          } catch (subErr) {
            console.error('stripe-checkout: failed to verify the completed session subscription:', subErr);
            await captureAndFlush(subErr, { function_name: 'stripe-checkout', checkout_session_id: staleSessionId });
            return new Response(JSON.stringify({ error: "Internal Server Error" }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
        if (subActive) {
          return new Response(JSON.stringify({
            error: 'checkout_already_completed',
            message: 'Your previous checkout already went through. Refresh to see your plan.',
          }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // The completed session's subscription is itself already terminal
        // (cancelled immediately, etc.) — fall through: releasing the guard
        // and letting a fresh checkout through is correct here.
      }

      // 'expired' or 'gone' (or a completed-but-cancelled subscription) —
      // release the guard fields ourselves, scoped to this exact session id
      // so we never clobber a different session another request may have
      // just started. Also drop the attempt identity so the next checkout
      // mints a fresh key rather than resuming Stripe's expired session.
      await supabase
        .from('profiles')
        .update({ checkout_pending_at: null, checkout_session_id: null, checkout_attempt_key: null })
        .eq('id', user.id)
        .eq('checkout_session_id', staleSessionId);
    }

    // ── ROUND 8: a pre-transition Checkout attempt ──────────────────────
    // The previously-deployed handler acquired checkout_pending_at and
    // called stripe.checkout.sessions.create() with NO idempotency key,
    // then stored checkout_session_id in a NON-FATAL follow-up write. A
    // lost response therefore leaves an orphan: a real Stripe session whose
    // id we never recorded, created under no key we can reproduce.
    //
    // Signature: checkout_pending_at set, checkout_session_id NULL,
    // checkout_attempt_key NULL. The new handler always stamps
    // checkout_attempt_key BEFORE it can set checkout_pending_at, so this
    // exact combination can ONLY be a pre-transition attempt — it is not a
    // state any version of the new handler can produce.
    //
    // We cannot de-dupe against that orphan session (no key), so we must
    // NOT create a second one. Return an explicit reconcile_required and
    // leave the row untouched (do NOT reclaim it on the 15-min TTL): the
    // signature is stable, so every retry lands here and stays safe until
    // the orphan session's checkout.session.completed / .expired lets the
    // webhook clear the guard, or an operator does.
    if (profileBefore?.checkout_pending_at
        && !profileBefore?.checkout_session_id
        && !profileBefore?.checkout_attempt_key) {
      return new Response(JSON.stringify({
        error: 'checkout_reconcile_required',
        message: 'A previous checkout could not be confirmed. Please refresh; if this keeps happening, contact support.',
      }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── ROUND 7 BLOCKER 1: stable identity for the in-flight attempt ──────
    // The Stripe idempotency-key seed for this checkout lives in its OWN
    // column, decoupled from the mutex timestamp. It is stamped exactly
    // ONCE — the first request that finds it NULL wins the guarded UPDATE —
    // and from then on every acquire/recovery/retry ADOPTS that value and
    // never rewrites it. So a crash anywhere (including between a lock
    // acquire and any follow-up write) leaves the identity intact, and no
    // "restore" UPDATE is needed. A same-millisecond collision on the
    // candidate is harmless: both requests would compute the identical
    // string, hence the identical Stripe key.
    const candidateKey = `chk_${user.id}_${Date.now()}`;
    const { count: stamped, error: stampErr } = await supabase
      .from('profiles')
      .update({ checkout_attempt_key: candidateKey }, { count: 'exact' })
      .eq('id', user.id)
      .is('checkout_attempt_key', null);
    if (stampErr) {
      console.error('stripe-checkout: failed to stamp checkout_attempt_key:', stampErr);
      await captureAndFlush(stampErr, { function_name: 'stripe-checkout' });
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    let attemptKey: string;
    const attemptKeyIsFresh = !!stamped && stamped > 0;
    if (attemptKeyIsFresh) {
      attemptKey = candidateKey;
    } else {
      const { data: keyRow, error: keyErr } = await supabase
        .from('profiles')
        .select('checkout_attempt_key')
        .eq('id', user.id)
        .single();
      if (keyErr || !keyRow?.checkout_attempt_key) {
        console.error('stripe-checkout: failed to read the in-flight checkout_attempt_key:', keyErr);
        await captureAndFlush(keyErr ?? new Error('checkout_attempt_key missing'), { function_name: 'stripe-checkout' });
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      attemptKey = keyRow.checkout_attempt_key;
    }

    // If this attempt's key predates Stripe's ~24h idempotency-key
    // retention, there is nothing left to de-dupe against — do not gamble on
    // a second concurrently-payable session; hand back an explicit state.
    // The identity column is left untouched, so a later retry lands here
    // again rather than on a fresh key. Checked BEFORE the mutex so there is
    // no lock to unwind.
    const attemptMs = Number(attemptKey.slice(attemptKey.lastIndexOf('_') + 1));
    const KEY_RETENTION_SAFE_MS = 23 * 60 * 60 * 1000;
    if (!attemptKeyIsFresh && !profileBefore?.checkout_session_id
        && Number.isFinite(attemptMs) && Date.now() - attemptMs >= KEY_RETENTION_SAFE_MS) {
      return new Response(JSON.stringify({
        error: 'checkout_reconcile_required',
        message: 'A previous checkout could not be confirmed. Please try again in a moment, or contact support if this keeps happening.',
      }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Second, complementary guard against the narrower race Stripe can't
    // see for us above: two near-simultaneous requests both reaching this
    // point with no checkout_session_id yet (double tab, double click
    // before redirect) — atomic check-and-set on profiles.checkout_pending_at.
    // This mutex is purely a lock-ownership timestamp now; the idempotency
    // key is the stable checkout_attempt_key above, NOT derived from this.
    // Detect "did this UPDATE win the lock" via the affected-row count
    // (`count: 'exact'`); a chained `.select()` re-applies the just-changed
    // filter and comes back empty even on success.
    const lockedAt = new Date().toISOString();
    const { count: lockAcquired, error: lockErr } = await supabase
      .from('profiles')
      .update({ checkout_pending_at: lockedAt }, { count: 'exact' })
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

    // A real acquire→create→store cycle is sub-second. A lock held longer
    // than this with still no session id means the holder lost its response
    // or crashed after creating the session at Stripe — the retry that
    // lands here should reconcile onto that session (under the SAME stable
    // checkout_attempt_key), not 409 forever.
    const RECONCILE_AFTER_MS = 30_000;

    if (!lockAcquired) {
      const { data: held } = await supabase
        .from('profiles')
        .select('checkout_session_id')
        .eq('id', user.id)
        .single();
      if (held?.checkout_session_id) {
        // The holder recorded a session — the reuse-or-close check above
        // handles it; if we raced past it, 409 and let the client retry.
        return new Response(JSON.stringify({
          error: 'A checkout is already in progress. Please finish or cancel it before starting another.',
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      // No session recorded. Decide "genuine double-click, wait" vs
      // "lost/stale attempt, reconcile" by the AGE OF THE ATTEMPT IDENTITY
      // (checkout_attempt_key's embedded stamp) — NOT the lock timestamp,
      // which a concurrent request just refreshed. A genuine double-click
      // shares a brand-new key; a retry of a lost attempt carries an old one.
      const attemptAgeMs = Number.isFinite(attemptMs) ? Date.now() - attemptMs : Infinity;
      if (attemptAgeMs < RECONCILE_AFTER_MS) {
        return new Response(JSON.stringify({
          error: 'A checkout is already in progress. Please finish or cancel it before starting another.',
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      // A lost/stale attempt — fall through and re-run sessions.create()
      // under the stable attemptKey: Stripe returns the ORIGINAL session.
    }

    const idemKey = attemptKey;

    // ROUND5 1a: a Checkout that COMPLETED between our pre-lock
    // findActiveSubscription and here — its webhook having cleared the
    // guard fields before we read the profile, so the reuse-or-close block
    // above saw nothing — would otherwise slip through to a second
    // concurrently-completable session. Re-check now, holding the lock,
    // right before we create.
    const nowActive = await findActiveSubscription(stripe, user.email);
    if (nowActive) {
      // The subscription already exists — this attempt is abandoned. Release
      // the lock WE just took (scoped to our exact timestamp) and drop the
      // attempt identity so a genuinely new checkout later starts fresh.
      await supabase
        .from('profiles')
        .update({ checkout_pending_at: null, checkout_attempt_key: null })
        .eq('id', user.id)
        .eq('checkout_pending_at', lockedAt);
      return new Response(JSON.stringify({
        error: 'checkout_already_completed',
        message: 'Your subscription is already active. Refresh to see your plan.',
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
    }, { idempotencyKey: idemKey });

    // Record the session id and retire the attempt identity in one write,
    // scoped so a concurrent reconcile that already wrote the id isn't
    // clobbered.
    const { error: sessionIdErr } = await supabase
      .from('profiles')
      .update({ checkout_session_id: session.id, checkout_attempt_key: null })
      .eq('id', user.id)
      .is('checkout_session_id', null);

    if (sessionIdErr) {
      // The session is live at Stripe and the attempt key is still stored,
      // so the retry re-creates under it and gets THIS exact session, then
      // records it. Don't expire it (that just costs the user a round-trip)
      // and don't release the mutex/key (the retry needs both). Just fail
      // so the client retries.
      console.error('stripe-checkout: failed to store checkout_session_id (retry will reconcile under the idempotency key):', sessionIdErr);
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
