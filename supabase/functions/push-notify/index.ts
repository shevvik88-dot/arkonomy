// supabase/functions/push-notify/index.ts
// Scans all users with push subscriptions, detects recurring charges
// due in ~3 days, and sends push notifications via Web Push.
//
// Trigger: call this function from a Supabase CRON job daily at 09:00:
//   Select cron.schedule('push-notify-daily', '0 9 * * *',
//     $$SELECT net.http_post(url => 'https://<project>.supabase.co/functions/v1/push-notify',
//                            headers => '{"Authorization":"Bearer <service_role_key>"}')$$);
//
// Required secrets (set via `supabase secrets set`):
//   VAPID_PRIVATE_KEY   — your VAPID private key
//   VAPID_PUBLIC_KEY    — your VAPID public key
//   VAPID_SUBJECT       — e.g. mailto:you@example.com

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush, Sentry } from '../_shared/sentry.ts';
import { getUpcomingCharges } from '../_shared/recurringDetector.ts';

initSentry('push-notify');

// ── SSRF guard on subscription.endpoint (pentest 2.1) ───────────────────────
// profiles.push_subscription is a client-writable column (see
// docs/security-log.md's column-level GRANT list) — a user can set it to
// anything via a direct PostgREST update, bypassing the real browser
// PushManager flow in src/hooks/usePushNotifications.js entirely. web-push's
// sendNotification() makes a raw server-side fetch() to subscription.endpoint
// with no validation of its own, so an unvalidated endpoint is a live SSRF
// primitive: an authenticated user can trigger it on demand via this
// function's Mode 1 (direct notification, self-service, no cron wait).
// Fix: only forward to the fixed, small set of real push-service hosts.
const ALLOWED_PUSH_ENDPOINT_HOSTS: Array<(hostname: string) => boolean> = [
  (h) => h === 'fcm.googleapis.com',                                  // Chrome / Edge (Chromium) / Samsung Internet / Opera
  (h) => h === 'updates.push.services.mozilla.com',                   // Firefox
  (h) => h === 'web.push.apple.com',                                  // Safari (macOS 13+ / iOS 16.4+)
  (h) => h === 'notify.windows.com' || h.endsWith('.notify.windows.com'), // legacy EdgeHTML (WNS)
];

class BlockedPushEndpointError extends Error {
  constructor(public hostname: string) {
    super(`Push endpoint host not on allow-list: ${hostname}`);
    this.name = 'BlockedPushEndpointError';
  }
}

function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string') return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_PUSH_ENDPOINT_HOSTS.some((match) => match(url.hostname));
}

// Logs a Sentry *warning* (not error — could be a legitimate new push vendor,
// not necessarily an attack) and reports whether `err` was actually a block,
// so call sites can branch without duplicating the Sentry/context logic.
function reportIfBlockedEndpoint(err: unknown, userId: string): boolean {
  if (!(err instanceof BlockedPushEndpointError)) return false;
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setContext('blocked_push_endpoint', { user_id: userId, hostname: err.hostname });
    Sentry.captureMessage('push-notify: blocked non-allow-listed subscription endpoint');
  });
  return true;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Recurring detection ─────────────────────────────────────────────────────
// Migrated 2026-07-17 to the shared, alias-aware detector (_shared/recurringDetector.ts)
// — the same one get-insights uses, live-verified on a real account. This file
// used to have its own separate inline copy (90-day window, no merchant_aliases
// awareness) — see CLAUDE.md for the full before/after comparison.
const LOOKBACK_DAYS      = 90; // kept as-is for this migration — deliberately not widened to get-insights' 3-month window
const NOTIFY_DAYS_AHEAD  = 3;  // send notification exactly 3 days before

// ── Web Push sending ─────────────────────────────────────────────────────────
// Uses the Web Push Protocol (RFC 8030) with VAPID authentication.

async function sendPushNotification(
  subscription: { endpoint: string; keys: { auth: string; p256dh: string } },
  payload: object,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<void> {
  if (!isAllowedPushEndpoint(subscription?.endpoint)) {
    let hostname = 'unparseable';
    try { hostname = new URL(subscription?.endpoint ?? '').hostname; } catch { /* keep 'unparseable' */ }
    throw new BlockedPushEndpointError(hostname);
  }

  // Dynamically import web-push compatible library for Deno
  const { default: webpush } = await import('npm:web-push@3.6.7');

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

// ── Edge Function handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const vapidPublicKey  = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const vapidSubject    = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@arkonomy.com';

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(
        JSON.stringify({ error: 'VAPID keys not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY secrets.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Auth ─────────────────────────────────────────────────────────────────
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isCron = token === serviceRoleKey;

    // ── Mode 1: direct notification ───────────────────────────────────────────
    // POST { user_id, title, body, icon } → send push to that user immediately
    let reqBody: Record<string, unknown> = {};
    if (req.method === 'POST') {
      try { reqBody = await req.json(); } catch { /* empty body → fall through to batch mode */ }
    }

    if (reqBody.user_id) {
      // Validate JWT and ensure the caller can only notify themselves
      if (!token) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!isCron) {
        const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
        if (authErr || !user || user.id !== String(reqBody.user_id)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('push_subscription')
        .eq('id', reqBody.user_id)
        .single();

      if (!profile?.push_subscription) {
        return new Response(JSON.stringify({ sent: 0, reason: 'no_subscription' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        await sendPushNotification(
          profile.push_subscription,
          {
            title: String(reqBody.title ?? 'Arkonomy'),
            body:  String(reqBody.body  ?? ''),
            icon:  String(reqBody.icon  ?? '/icon-192.png'),
            tag:   String(reqBody.tag   ?? 'arkonomy-alert'),
            url:   '/',
          },
          vapidPublicKey,
          vapidPrivateKey,
          vapidSubject,
        );
        return new Response(JSON.stringify({ sent: 1 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (pushErr) {
        if (reportIfBlockedEndpoint(pushErr, String(reqBody.user_id))) {
          return new Response(JSON.stringify({ sent: 0, reason: 'invalid_endpoint' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // Subscription expired — clean it up so we don't retry forever
        if (String(pushErr).includes('410') || String(pushErr).includes('404')) {
          await supabase.from('profiles').update({ push_subscription: null }).eq('id', reqBody.user_id);
          return new Response(JSON.stringify({ sent: 0, reason: 'subscription_expired' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        throw pushErr;
      }
    }

    // ── Mode 2: batch recurring-charges scan ──────────────────────────────────
    // Only the cron job (service role key) may run the full-user batch scan
    if (!isCron) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch all users with push subscriptions
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, push_subscription')
      .not('push_subscription', 'is', null);

    if (error) throw error;

    const results = [];

    for (const profile of (profiles ?? [])) {
      if (!profile.push_subscription) continue;

      // Fetch last LOOKBACK_DAYS of transactions for this user (kept at 90
      // for this migration — see LOOKBACK_DAYS comment above)
      const lookbackStart = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().split('T')[0];
      const { data: txs } = await supabase
        .from('transactions')
        .select('date, amount, type, description, category_name')
        .eq('user_id', profile.id)
        .gte('date', lookbackStart);

      if (!txs || txs.length === 0) continue;

      // merchant_aliases — same pattern as get-insights: only confirmed
      // aliases, built into a Map(alias_key -> canonical_key).
      const { data: aliasRows } = await supabase
        .from('merchant_aliases')
        .select('alias_key, canonical_key, status')
        .eq('user_id', profile.id);
      const aliasMap = new Map<string, string>();
      (aliasRows ?? []).forEach((a: any) => { if (a.status === 'confirmed') aliasMap.set(a.alias_key, a.canonical_key); });

      // maxResults: Infinity — the shared function defaults to capping at 4,
      // which would silently drop a user's 5th+ recurring bill here. Filtered
      // to an EXACT daysUntil match (not the shared function's maxDays range)
      // to preserve "notify once, exactly N days out" — otherwise this would
      // fire every day from 0..NOTIFY_DAYS_AHEAD instead of once.
      const upcoming = getUpcomingCharges(txs, aliasMap, new Date(), { maxDays: NOTIFY_DAYS_AHEAD, maxResults: Infinity })
        .filter(c => c.daysUntil === NOTIFY_DAYS_AHEAD);

      for (const charge of upcoming) {
        // Title-case the raw merchant name — the shared detector intentionally
        // returns it uncleaned (get-insights, its only other consumer, never
        // displays it), but push-notify puts it directly in a notification title.
        const merchantDisplay = charge.merchant.charAt(0).toUpperCase() + charge.merchant.slice(1);
        const payload = {
          title: `⚠️ Upcoming: ${merchantDisplay}`,
          body:  `$${charge.amount.toFixed(2)} expected on ${charge.expectedDate} — 3 days away.`,
          icon:  '/icon-192.png',
          tag:   `recurring-${merchantDisplay.toLowerCase().replace(/\s+/g, '-')}`,
          url:   '/',
        };

        try {
          await sendPushNotification(
            profile.push_subscription,
            payload,
            vapidPublicKey,
            vapidPrivateKey,
            vapidSubject,
          );
          results.push({ userId: profile.id, merchant: merchantDisplay, status: 'sent' });
        } catch (err) {
          if (reportIfBlockedEndpoint(err, profile.id)) {
            results.push({ userId: profile.id, merchant: merchantDisplay, status: 'blocked_endpoint' });
            continue;
          }
          console.error(`Push failed for user ${profile.id}:`, err);
          results.push({ userId: profile.id, merchant: merchantDisplay, status: 'failed', error: "Internal Server Error" });
        }
      }
    }

    // ── Savings reminders: fire push for reminders whose day_of_week array contains today ──
    const todayDow = new Date().getDay(); // 0=Sun … 6=Sat
    const { data: reminders } = await supabase
      .from('savings_reminders')
      .select('user_id, goal_id, amount, day_of_week, savings(name)')
      .contains('day_of_week', [todayDow]);

    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    for (const r of (reminders ?? [])) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('push_subscription')
        .eq('id', r.user_id)
        .single();

      if (!profile?.push_subscription) continue;

      const goalName = (r.savings as any)?.name ?? 'your savings goal';
      const days: number[] = Array.isArray(r.day_of_week) ? r.day_of_week : [r.day_of_week];
      const dayLabel = days.length === 7 ? 'every day' : days.map((d: number) => DAY_NAMES[d]).join(', ');
      const payload = {
        title: '💰 Savings reminder',
        body:  `Transfer $${Number(r.amount).toFixed(2)} to ${goalName} today (${DAY_NAMES[todayDow]})`,
        icon:  '/icon-192.png',
        tag:   `savings-reminder-${r.goal_id}`,
        url:   '/',
      };

      try {
        await sendPushNotification(
          profile.push_subscription, payload,
          vapidPublicKey, vapidPrivateKey, vapidSubject,
        );
        results.push({ userId: r.user_id, type: 'savings_reminder', goalId: r.goal_id, status: 'sent' });
      } catch (err) {
        if (reportIfBlockedEndpoint(err, r.user_id)) {
          results.push({ userId: r.user_id, type: 'savings_reminder', goalId: r.goal_id, status: 'blocked_endpoint' });
          continue;
        }
        console.error(`Savings reminder push failed for user ${r.user_id}:`, err);
        results.push({ userId: r.user_id, type: 'savings_reminder', goalId: r.goal_id, status: 'failed' });
      }
    }

    // ── Scheduled (one-off) payments due in NOTIFY_DAYS_AHEAD days ─────────────
    const reminderDate = new Date(Date.now() + NOTIFY_DAYS_AHEAD * 86_400_000).toISOString().split('T')[0];
    const { data: scheduled } = await supabase
      .from('scheduled_payments')
      .select('user_id, id, amount, description, due_date')
      .eq('status', 'pending')
      .eq('due_date', reminderDate);

    for (const p of (scheduled ?? [])) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('push_subscription')
        .eq('id', p.user_id)
        .single();

      if (!profile?.push_subscription) continue;

      const payload = {
        title: `📅 Planned payment: ${p.description}`,
        body:  `$${Number(p.amount).toFixed(2)} due on ${p.due_date} — ${NOTIFY_DAYS_AHEAD} days away.`,
        icon:  '/icon-192.png',
        tag:   `scheduled-payment-${p.id}`,
        url:   '/',
      };

      try {
        await sendPushNotification(
          profile.push_subscription, payload,
          vapidPublicKey, vapidPrivateKey, vapidSubject,
        );
        results.push({ userId: p.user_id, type: 'scheduled_payment', paymentId: p.id, status: 'sent' });
      } catch (err) {
        if (reportIfBlockedEndpoint(err, p.user_id)) {
          results.push({ userId: p.user_id, type: 'scheduled_payment', paymentId: p.id, status: 'blocked_endpoint' });
          continue;
        }
        console.error(`Scheduled payment push failed for user ${p.user_id}:`, err);
        results.push({ userId: p.user_id, type: 'scheduled_payment', paymentId: p.id, status: 'failed' });
      }
    }

    return new Response(JSON.stringify({ notified: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('push-notify error:', err);
    await captureAndFlush(err, { function_name: 'push-notify' });
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
