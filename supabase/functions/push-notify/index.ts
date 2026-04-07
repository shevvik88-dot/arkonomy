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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Recurring detection (mirrors src/recurringDetector.js) ────────────────────
const AMOUNT_TOLERANCE   = 0.05;
const INTERVAL_TARGET    = 30;
const INTERVAL_TOLERANCE = 5;
const MIN_OCCURRENCES    = 2;
const LOOKBACK_DAYS      = 90;
const NOTIFY_DAYS_AHEAD  = 3; // send notification exactly 3 days before

function normalizeMerchant(raw: string): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[#*]\w*\d+\w*/g, '')
    .replace(/\d{4,}/g, '')
    .replace(/[^\w\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function amountsMatch(a: number, b: number): boolean {
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return true;
  return Math.abs(a - b) / max <= AMOUNT_TOLERANCE;
}

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

interface Tx {
  date: string;
  amount: string | number;
  type: string;
  description: string;
  category_name: string;
}

interface RecurringCharge {
  merchant: string;
  amount: number;
  daysUntil: number;
  expectedDate: string;
}

function detectUpcoming(transactions: Tx[], targetDays: number): RecurringCharge[] {
  const now    = new Date();
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

  const expenses = transactions.filter((t: Tx) =>
    t.type === 'expense'
    && t.category_name !== 'Transfer'
    && new Date(t.date) >= cutoff
  );

  const byMerchant: Record<string, Tx[]> = {};
  for (const t of expenses) {
    const key = normalizeMerchant(t.description || t.category_name || '');
    if (!key || key.length < 2) continue;
    (byMerchant[key] ??= []).push(t);
  }

  const upcoming: RecurringCharge[] = [];

  for (const [key, txs] of Object.entries(byMerchant)) {
    if (txs.length < MIN_OCCURRENCES) continue;

    const sorted = [...txs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Cluster by amount ±5%
    const clusters: { ref: number; txs: Tx[] }[] = [];
    for (const tx of sorted) {
      const amt = Math.abs(Number(tx.amount));
      let placed = false;
      for (const c of clusters) {
        if (amountsMatch(c.ref, amt)) {
          c.txs.push(tx);
          c.ref = c.txs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0) / c.txs.length;
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ ref: amt, txs: [tx] });
    }

    for (const cluster of clusters) {
      if (cluster.txs.length < MIN_OCCURRENCES) continue;

      const cs = [...cluster.txs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const gaps: number[] = [];
      for (let i = 1; i < cs.length; i++) {
        gaps.push(daysBetween(cs[i - 1].date, cs[i].date));
      }

      const allValid = gaps.every(
        g => g >= INTERVAL_TARGET - INTERVAL_TOLERANCE && g <= INTERVAL_TARGET + INTERVAL_TOLERANCE
      );
      if (!allValid) continue;

      const avgGap   = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const lastTx   = cs[cs.length - 1];
      const nextDate = new Date(new Date(lastTx.date).getTime() + avgGap * 86_400_000);
      const daysUntil = Math.round((nextDate.getTime() - now.getTime()) / 86_400_000);

      if (daysUntil !== targetDays) continue;

      const rawName = lastTx.description || lastTx.category_name || key;
      upcoming.push({
        merchant:     rawName.charAt(0).toUpperCase() + rawName.slice(1),
        amount:       Math.round(cluster.ref * 100) / 100,
        daysUntil,
        expectedDate: nextDate.toISOString().split('T')[0],
      });
    }
  }

  return upcoming;
}

// ── Web Push sending ─────────────────────────────────────────────────────────
// Uses the Web Push Protocol (RFC 8030) with VAPID authentication.

async function sendPushNotification(
  subscription: { endpoint: string; keys: { auth: string; p256dh: string } },
  payload: object,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<void> {
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

    // Fetch all users with push subscriptions
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, push_subscription')
      .not('push_subscription', 'is', null);

    if (error) throw error;

    const results = [];

    for (const profile of (profiles ?? [])) {
      if (!profile.push_subscription) continue;

      // Fetch last 90 days of transactions for this user
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().split('T')[0];
      const { data: txs } = await supabase
        .from('transactions')
        .select('date, amount, type, description, category_name')
        .eq('user_id', profile.id)
        .gte('date', ninetyDaysAgo);

      if (!txs || txs.length === 0) continue;

      // Detect charges due in exactly 3 days
      const upcoming = detectUpcoming(txs as Tx[], NOTIFY_DAYS_AHEAD);

      for (const charge of upcoming) {
        const payload = {
          title: `⚠️ Upcoming: ${charge.merchant}`,
          body:  `$${charge.amount.toFixed(2)} expected on ${charge.expectedDate} — 3 days away.`,
          icon:  '/icon-192.png',
          tag:   `recurring-${charge.merchant.toLowerCase().replace(/\s+/g, '-')}`,
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
          results.push({ userId: profile.id, merchant: charge.merchant, status: 'sent' });
        } catch (err) {
          console.error(`Push failed for user ${profile.id}:`, err);
          results.push({ userId: profile.id, merchant: charge.merchant, status: 'failed', error: String(err) });
        }
      }
    }

    return new Response(JSON.stringify({ notified: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('push-notify error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
