// supabase/functions/large-transaction-alert/index.ts
// Emails a user when a new, non-recurring transaction crosses their own
// dynamic large-transaction threshold (95th percentile of their 90-day
// non-recurring spend, $200 floor, $500 fallback for new/thin accounts —
// see computeDynamicThreshold). Recurring transactions (rent, payroll,
// subscriptions) are excluded via the shared recurring-detection engine —
// this is for one-off large spend only.
//
// Trigger: Supabase pg_cron (see 20260802000001_large_transaction_alert_cron.sql)
// Manual:  POST /large-transaction-alert  with a user JWT — sends only to that user
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY   — get free key at resend.com (100 emails/day free)
//   REPORT_FROM      — verified sender address, e.g. "Arkonomy <hello@yourdomain.com>"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';
import { isRecurringTransaction } from '../_shared/recurringDetector.ts';

type Tx = { id?: string; date: string; amount: number | string; type: string; description: string | null; category_name: string | null; created_at?: string; large_tx_notified?: boolean };

initSentry('large-transaction-alert');

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Fallback threshold for users without enough history for a statistical
// threshold (see computeDynamicThreshold below) — new accounts, or accounts
// with too few non-recurring transactions to compute meaningful stats.
const FALLBACK_THRESHOLD = 500;

// Never alert below this even if it's a statistical outlier for a
// low-spending user — not meaningful for most people at this amount.
const MIN_THRESHOLD_FLOOR = 200;

// Dynamic threshold = the PERCENTILE-th percentile of the user's own
// non-recurring expenses over the last HISTORY_DAYS days, requires at least
// MIN_SAMPLE_SIZE data points to be considered statistically meaningful.
// Percentile, not mean + N*stddev — real spending is right-skewed (many
// small purchases, a few large ones), so a normal-distribution assumption
// lets a handful of outliers inflate stddev and push the threshold up;
// percentile isn't fooled by that shape.
const PERCENTILE = 95;
const HISTORY_DAYS = 90;
const MIN_SAMPLE_SIZE = 20;

// How long a cached per-user threshold stays valid before recomputing — the
// aggregate stats pass is too heavy to redo on every 4-hourly scan, so it's
// only recomputed once this cache window has elapsed (see
// getOrRefreshThreshold), regardless of how often this function itself runs.
const THRESHOLD_CACHE_HOURS = 24;

// How far back to look for "new" large transactions on each run. Bounded so
// a first-time historical Plaid sync (months of backfilled transactions)
// doesn't retroactively trigger alerts for old spend — only recently-synced
// rows qualify, checked via created_at (row insert time), not the
// transaction's own date.
const LOOKBACK_HOURS = 48;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromAddr  = Deno.env.get('REPORT_FROM') ?? 'Arkonomy <noreply@arkonomy.app>';

    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    // Cron path:  Authorization: Bearer <service_role_key>  → checks all users
    // User path:  Authorization: Bearer <user_jwt>          → checks only that user
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isCron = token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // ── Load users ─────────────────────────────────────────────────────────────
    const PREFS_SELECT = 'large_transaction_alerts, large_tx_threshold, large_tx_threshold_computed_at';
    let profiles: {
      id: string; full_name: string | null; email: string | null;
      _alertsOn: boolean; _threshold: number | null; _thresholdComputedAt: string | null;
    }[];

    if (isCron) {
      const { data: profileRows, error: profileErr } = await supabase
        .from('profiles').select('id, full_name, email');
      if (profileErr || !profileRows?.length) {
        return new Response(JSON.stringify({ error: 'No users found', detail: profileErr }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // notification_preferences.user_id references auth.users, not profiles —
      // no FK for PostgREST to embedded-join on, fetch separately and merge
      // (same pattern as weekly-report / generate-monthly-report).
      const { data: prefsRows, error: prefsErr } = await supabase
        .from('notification_preferences')
        .select(`user_id, ${PREFS_SELECT}`)
        .in('user_id', profileRows.map(p => p.id));
      if (prefsErr) {
        return new Response(JSON.stringify({ error: 'Failed to load notification preferences', detail: prefsErr }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const prefsByUser = new Map((prefsRows ?? []).map((p: any) => [p.user_id, p]));
      profiles = profileRows.map(p => {
        const prefs = prefsByUser.get(p.id);
        return {
          ...p,
          _alertsOn: prefs?.large_transaction_alerts ?? true,
          _threshold: prefs?.large_tx_threshold ?? null,
          _thresholdComputedAt: prefs?.large_tx_threshold_computed_at ?? null,
        };
      });
    } else {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: p, error: profileErr } = await supabase
        .from('profiles').select('id, full_name, email').eq('id', user.id).single();
      if (profileErr || !p) {
        return new Response(JSON.stringify({ error: 'User profile not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: prefsRow } = await supabase
        .from('notification_preferences').select(PREFS_SELECT)
        .eq('user_id', user.id).maybeSingle();
      profiles = [{
        ...p,
        _alertsOn: prefsRow?.large_transaction_alerts ?? true,
        _threshold: prefsRow?.large_tx_threshold ?? null,
        _thresholdComputedAt: prefsRow?.large_tx_threshold_computed_at ?? null,
      }];
    }

    const results: { userId: string; status: string; error?: string; count?: number; threshold?: number }[] = [];

    for (const user of profiles) {
      if (!user.email) continue;
      try {
        if (!user._alertsOn) {
          results.push({ userId: user.id, status: 'skipped', error: 'large_transaction_alerts=off' }); continue;
        }

        // Full history, fetched once — needed both for the dynamic threshold
        // (90-day non-recurring stats) and for filtering candidates below.
        // A merchant's recurring status can only be determined from its
        // pattern across many months, not from a single transaction alone.
        const [{ data: allTxns, error: txErr }, { data: aliasRows }] = await Promise.all([
          supabase.from('transactions')
            .select('id, date, amount, type, description, category_name, created_at, large_tx_notified')
            .eq('user_id', user.id),
          supabase.from('merchant_aliases').select('alias_key, canonical_key, status').eq('user_id', user.id),
        ]);
        if (txErr) throw new Error(`DB error: ${txErr.message}`);

        const aliasMap = new Map<string, string>();
        (aliasRows ?? []).filter((a: any) => a.status === 'confirmed')
          .forEach((a: any) => aliasMap.set(a.alias_key, a.canonical_key));

        const threshold = await getOrRefreshThreshold(supabase, user, allTxns ?? [], aliasMap);

        // ── Find candidate transactions: large, recently synced, not yet notified ──
        const sinceMs = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
        const candidates = (allTxns ?? []).filter((tx: Tx) =>
          tx.type === 'expense' &&
          !tx.large_tx_notified &&
          Number(tx.amount) > threshold &&
          tx.created_at != null && new Date(tx.created_at).getTime() >= sinceMs
        );

        if (candidates.length === 0) {
          results.push({ userId: user.id, status: 'skipped', error: 'no_large_transactions', threshold }); continue;
        }

        // ── Filter out recurring merchants via the shared detection engine ──
        const nonRecurring = candidates.filter(tx => !isRecurringTransaction(tx, allTxns ?? [], aliasMap));

        if (nonRecurring.length === 0) {
          results.push({ userId: user.id, status: 'skipped', error: 'all_recurring', threshold }); continue;
        }

        // ── Send one email per user per run, listing every qualifying transaction ──
        const html = buildEmailHtml(user.full_name || user.email, nonRecurring, threshold);
        const subject = nonRecurring.length === 1
          ? `Large transaction: $${Number(nonRecurring[0].amount).toFixed(2)} at ${nonRecurring[0].description || nonRecurring[0].category_name || 'Uncategorized'}`
          : `${nonRecurring.length} large transactions on your account`;

        const res = await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fromAddr, to: [user.email], subject, html }),
        });

        const resBody = await res.json();
        if (!res.ok) throw new Error(resBody.message ?? JSON.stringify(resBody));

        // Mark every included transaction notified so this run (or the next)
        // never emails about it again, regardless of channel.
        const { error: markErr } = await supabase
          .from('transactions')
          .update({ large_tx_notified: true })
          .in('id', nonRecurring.map(tx => tx.id));
        if (markErr) console.error(`large-transaction-alert: failed to mark notified for user ${user.id}:`, markErr);

        results.push({ userId: user.id, status: 'sent', count: nonRecurring.length, threshold });
      } catch (err) {
        console.error(`large-transaction-alert failed for user ${user.id}:`, err);
        results.push({ userId: user.id, status: 'failed', error: 'Internal Server Error' });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('large-transaction-alert error:', err);
    await captureAndFlush(err, { function_name: 'large-transaction-alert' });
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DYNAMIC THRESHOLD
// ══════════════════════════════════════════════════════════════════════════════

// PERCENTILE-th percentile of the user's own non-recurring expenses over the
// last HISTORY_DAYS days — falls back to FALLBACK_THRESHOLD when there
// isn't enough history/data for the stats to be meaningful.
function computeDynamicThreshold(allTxns: Tx[], aliasMap: Map<string, string>): number {
  const now = Date.now();
  const historyStartMs = now - HISTORY_DAYS * 24 * 60 * 60 * 1000;

  const earliestMs = allTxns.reduce((min: number | null, t) => {
    const d = new Date(t.date + 'T00:00:00').getTime();
    return min === null || d < min ? d : min;
  }, null as number | null);
  const hasEnoughCalendarHistory = earliestMs !== null && earliestMs <= historyStartMs;

  const ninetyDayExpenses = allTxns.filter(t =>
    t.type === 'expense' && new Date(t.date + 'T00:00:00').getTime() >= historyStartMs
  );
  const nonRecurring = ninetyDayExpenses.filter(t => !isRecurringTransaction(t, allTxns, aliasMap));

  if (!hasEnoughCalendarHistory || nonRecurring.length < MIN_SAMPLE_SIZE) {
    return FALLBACK_THRESHOLD;
  }

  const amounts = nonRecurring.map(t => Number(t.amount)).sort((a, b) => a - b);
  return Math.max(percentile(amounts, PERCENTILE), MIN_THRESHOLD_FLOOR);
}

// Linear-interpolation percentile (matches numpy's default / Excel's
// PERCENTILE.INC) — `sorted` must already be sorted ascending.
function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

// Returns the user's cached threshold if it's still fresh (within
// THRESHOLD_CACHE_HOURS), otherwise recomputes and caches the new value.
// Recomputation only happens roughly once a day regardless of how often this
// function itself runs on its 4-hourly cron.
async function getOrRefreshThreshold(
  supabase: any,
  user: { id: string; _threshold: number | null; _thresholdComputedAt: string | null },
  allTxns: Tx[],
  aliasMap: Map<string, string>,
): Promise<number> {
  const cacheAgeMs = user._thresholdComputedAt
    ? Date.now() - new Date(user._thresholdComputedAt).getTime()
    : Infinity;

  if (user._threshold != null && cacheAgeMs < THRESHOLD_CACHE_HOURS * 60 * 60 * 1000) {
    return user._threshold;
  }

  const threshold = computeDynamicThreshold(allTxns, aliasMap);

  // Partial upsert — only these two columns are set/updated; Postgres's
  // ON CONFLICT DO UPDATE only touches the columns present in the payload,
  // so this never resets large_transaction_alerts or any other preference.
  const { error } = await supabase.from('notification_preferences').upsert(
    { user_id: user.id, large_tx_threshold: threshold, large_tx_threshold_computed_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) console.error(`large-transaction-alert: failed to cache threshold for user ${user.id}:`, error);

  return threshold;
}

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATE
// ══════════════════════════════════════════════════════════════════════════════

const esc = (s: string) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtAmt = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function buildEmailHtml(name: string, txns: { date: string; amount: number; description: string | null; category_name: string | null }[], threshold: number): string {
  const firstName = esc((name || '').split(' ')[0] || 'there');

  const rows = txns.map(tx => `
    <tr>
      <td style="padding:10px 0; border-bottom:1px solid #1E2D4A; color:#9AA4B2; font-size:13px;">
        ${esc(tx.description || tx.category_name || 'Uncategorized')}<br/>
        <span style="font-size:11px;color:#4A5E7A;">${fmtDate(tx.date)} &middot; ${esc(tx.category_name || 'Other')}</span>
      </td>
      <td style="padding:10px 0; border-bottom:1px solid #1E2D4A; text-align:right; font-weight:700; color:#FF5C7A; font-size:15px; vertical-align:top;">
        $${fmtAmt(tx.amount)}
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Arkonomy Large Transaction Alert</title>
</head>
<body style="margin:0;padding:0;background:#060E1C;font-family:'Inter',Arial,sans-serif;color:#FFFFFF;">
  <div style="max-width:520px;margin:0 auto;background:#060E1C;">

    <div style="background:linear-gradient(135deg,#0D1F3C 0%,#0B1426 100%);padding:28px 32px;border-bottom:1px solid #1E2D4A;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#FFFFFF;">
        Arkonomy
        <span style="font-size:10px;font-weight:600;color:#FF5C7A;background:#FF5C7A18;border:1px solid #FF5C7A33;border-radius:99px;padding:2px 8px;margin-left:8px;vertical-align:middle;letter-spacing:0.5px;">LARGE TRANSACTION</span>
      </div>
      <div style="font-size:13px;color:#9AA4B2;margin-top:4px;">Hi ${firstName}</div>
    </div>

    <div style="padding:28px 32px;">
      <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:20px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#9AA4B2;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:12px;">
          ${txns.length === 1 ? 'A new large transaction was detected' : `${txns.length} new large transactions were detected`}
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </div>

      <div style="text-align:center;margin-bottom:28px;">
        <a href="https://app.arkonomy.com" style="display:inline-block;background:#2F80FF;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:14px 32px;border-radius:12px;letter-spacing:-0.2px;">
          Open Arkonomy →
        </a>
      </div>
    </div>

    <div style="padding:20px 32px;border-top:1px solid #1E2D4A;text-align:center;">
      <div style="font-size:11px;color:#4A5E7A;line-height:1.6;">
        You're receiving this because a transaction over $${fmtAmt(threshold)} was added to your account.<br/>
        <a href="https://app.arkonomy.com" style="color:#4A5E7A;">Manage preferences</a>
      </div>
    </div>

  </div>
</body>
</html>`;
}
