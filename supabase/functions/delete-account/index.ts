// supabase/functions/delete-account/index.ts
// Permanently removes the caller's account: cancels any active Stripe
// subscription, revokes Plaid access (item/remove) for every connected
// bank, deletes all app data, then removes the auth.users record last.
//
// Stripe/Plaid calls are best-effort: a failure there is logged to
// account_deletion_issues for manual follow-up (e.g. refund, manual Stripe
// cancel) but never blocks the deletion itself — a user who asks to be
// deleted must end up deleted.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('delete-account');

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Validate the caller's JWT before doing anything destructive
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }
    const dryRun = body?.dry_run === true;

    // ── Gather what we need to revoke BEFORE deleting any rows ────────────────
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, checkout_session_id')
      .eq('id', user.id)
      .single();

    const { data: plaidItems } = await supabase
      .from('plaid_items')
      .select('id, access_token')
      .eq('user_id', user.id);

    const stripeCustomerId = profile?.stripe_customer_id ?? null;
    const checkoutSessionId = profile?.checkout_session_id ?? null;

    // ── Dry run: report what WOULD happen, no mutating calls at all ────────────
    if (dryRun) {
      let stripeSubscriptions: Array<{ id: string; status: string; would_cancel: boolean }> = [];
      let stripeLookupError: string | null = null;
      if (stripeCustomerId) {
        try {
          const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
          const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: 'all' });
          stripeSubscriptions = subs.data.map(sub => ({
            id:           sub.id,
            status:       sub.status,
            would_cancel: sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due',
          }));
        } catch (err) {
          console.error(`[delete-account] dry-run Stripe lookup failed:`, err);
          stripeLookupError = 'Unable to look up Stripe subscription status';
        }
      }

      return new Response(JSON.stringify({
        dry_run:               true,
        user_id:                user.id,
        stripe_customer_id:     stripeCustomerId,
        stripe_subscriptions:   stripeSubscriptions,
        stripe_lookup_error:    stripeLookupError,
        plaid_items_would_revoke: (plaidItems ?? []).map(item => item.id),
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── Alpaca race guard: don't delete while a trade is mid-flight ────────────
    // A 'pending' investments row means alpaca-invest already placed a real
    // order with Alpaca and is about to write order_id/status back onto it
    // (see the delete-account race chain finding) — deleting the row now
    // would race that confirm-update and leave a real trade with no record
    // anywhere. The window is normally sub-second to a couple seconds (one
    // Alpaca API round trip), so a short poll resolves almost every real
    // case for free; still pending after ~7s means something's actually
    // stuck, not just in flight, so reject rather than guess.
    const PENDING_POLL_MS = 1000;
    const PENDING_MAX_ATTEMPTS = 8;
    for (let attempt = 0; attempt < PENDING_MAX_ATTEMPTS; attempt++) {
      const { data: pendingInvestments, error: pendingCheckErr } = await supabase
        .from('investments')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .limit(1);

      // A query error means we don't actually know whether a trade is in
      // flight — NOT the same as a confirmed "no pending investments".
      // Treating an error as "clear to proceed" (the previous, buggy
      // behavior) is exactly the fail-open this guard exists to prevent:
      // it would silently skip straight to deleting investments/profiles/
      // auth.users while a real Alpaca trade might still be mid-confirm.
      // Only break on a genuinely successful, error-free check.
      if (!pendingCheckErr && (!pendingInvestments || pendingInvestments.length === 0)) break;

      if (attempt === PENDING_MAX_ATTEMPTS - 1) {
        if (pendingCheckErr) {
          console.error('[delete-account] pending-investment check failed after retries:', pendingCheckErr);
          await captureAndFlush(pendingCheckErr, { function_name: 'delete-account', stage: 'pending_investment_check' });
          return new Response(JSON.stringify({
            error: 'Could not verify account state. Please try again in a moment.',
          }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          error: 'An investment is still processing. Please wait a moment and try deleting your account again.',
        }), { status: 409, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      await new Promise(resolve => setTimeout(resolve, PENDING_POLL_MS));
    }

    let stripeError: string | null = null;
    let plaidError: string | null = null;
    const failedPlaidItemIds: string[] = [];

    // ── Cancel any active Stripe subscription ──────────────────────────────────
    if (stripeCustomerId) {
      try {
        const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
        const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: 'all' });
        for (const sub of subs.data) {
          if (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due') {
            await stripe.subscriptions.cancel(sub.id);
          }
        }
      } catch (err) {
        stripeError = err instanceof Error ? err.message : String(err);
        console.error(`[delete-account] Stripe cancel failed for user ${user.id}:`, err);
      }
    }

    // ── Expire any abandoned Checkout Session ──────────────────────────────────
    // A Checkout Session stays completable for up to 24h after creation
    // (Stripe's default) — far longer than checkout_pending_at's own
    // 15-minute TTL. Actively expiring it here closes that window instead
    // of just hoping it passes uneventfully (see the delete-account race
    // chain finding / stripe-webhook's rowcount-check on
    // checkout.session.completed). Expected and non-fatal for this to
    // fail: the session may already be completed or expired naturally —
    // logged, never blocks account deletion.
    if (checkoutSessionId) {
      try {
        const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
        await stripe.checkout.sessions.expire(checkoutSessionId);
      } catch (err) {
        console.error(`[delete-account] Checkout Session expire failed for user ${user.id}:`, err);
      }
    }

    // ── Revoke Plaid access for every connected bank ───────────────────────────
    if (plaidItems && plaidItems.length > 0) {
      const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
      const plaidBase = `https://${plaidEnv}.plaid.com`;
      const clientId  = Deno.env.get('PLAID_CLIENT_ID')!;
      const secret    = Deno.env.get('PLAID_SECRET')!;

      for (const item of plaidItems) {
        try {
          const res = await fetch(`${plaidBase}/item/remove`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ client_id: clientId, secret, access_token: item.access_token }),
          });
          const data = await res.json();
          if (!res.ok || data?.error_code) {
            failedPlaidItemIds.push(item.id);
            console.error(`[delete-account] Plaid item/remove failed for item ${item.id}:`, data?.error_code);
          }
        } catch (err) {
          failedPlaidItemIds.push(item.id);
          console.error(`[delete-account] Plaid item/remove error for item ${item.id}:`, err);
        }
      }
      if (failedPlaidItemIds.length > 0) {
        plaidError = `${failedPlaidItemIds.length}/${plaidItems.length} item(s) failed to revoke`;
      }
    }

    // ── Record any failure for manual follow-up before the trail disappears ────
    if (stripeError || plaidError) {
      await supabase.from('account_deletion_issues').insert({
        user_id:            user.id,
        user_email:         user.email,
        stripe_customer_id: stripeCustomerId,
        stripe_error:       stripeError,
        plaid_item_ids:     failedPlaidItemIds.length > 0 ? failedPlaidItemIds : null,
        plaid_error:        plaidError,
      });
    }

    // ── Delete app data, then the auth identity last ────────────────────────────
    await Promise.all([
      supabase.from('transactions').delete().eq('user_id', user.id),
      supabase.from('savings').delete().eq('user_id', user.id),
      supabase.from('categories').delete().eq('user_id', user.id),
      supabase.from('plaid_items').delete().eq('user_id', user.id),
      supabase.from('investments').delete().eq('user_id', user.id),
      supabase.from('notification_preferences').delete().eq('user_id', user.id),
      supabase.from('savings_reminders').delete().eq('user_id', user.id),
    ]);
    await supabase.from('profiles').delete().eq('id', user.id);

    const { error: deleteErr } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteErr) {
      console.error('[delete-account] admin.deleteUser failed:', deleteErr);
      return new Response(JSON.stringify({ error: deleteErr.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[delete-account] unhandled error:', e);
    await captureAndFlush(e, { function_name: 'delete-account' });
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
