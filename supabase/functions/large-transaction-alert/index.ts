// supabase/functions/large-transaction-alert/index.ts
// Emails a user when a new, non-recurring transaction over $500 is synced.
// Recurring transactions (rent, payroll, subscriptions) are excluded via the
// shared recurring-detection engine — this is for one-off large spend only.
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

initSentry('large-transaction-alert');

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Hardcoded — per-user threshold configuration is a separate future feature.
const LARGE_TX_THRESHOLD = 500;

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
    let profiles: { id: string; full_name: string | null; email: string | null; _alertsOn: boolean }[];

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
        .select('user_id, large_transaction_alerts')
        .in('user_id', profileRows.map(p => p.id));
      if (prefsErr) {
        return new Response(JSON.stringify({ error: 'Failed to load notification preferences', detail: prefsErr }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const prefsByUser = new Map((prefsRows ?? []).map((p: any) => [p.user_id, p.large_transaction_alerts]));
      profiles = profileRows.map(p => ({ ...p, _alertsOn: prefsByUser.get(p.id) ?? true }));
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
        .from('notification_preferences').select('large_transaction_alerts')
        .eq('user_id', user.id).maybeSingle();
      profiles = [{ ...p, _alertsOn: prefsRow?.large_transaction_alerts ?? true }];
    }

    const results: { userId: string; status: string; error?: string; count?: number }[] = [];

    for (const user of profiles) {
      if (!user.email) continue;
      try {
        if (!user._alertsOn) {
          results.push({ userId: user.id, status: 'skipped', error: 'large_transaction_alerts=off' }); continue;
        }

        // ── Find candidate transactions: large, recently synced, not yet notified ──
        const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
        const { data: candidates, error: candErr } = await supabase
          .from('transactions')
          .select('id, date, amount, description, category_name, type')
          .eq('user_id', user.id)
          .eq('type', 'expense')
          .eq('large_tx_notified', false)
          .gt('amount', LARGE_TX_THRESHOLD)
          .gte('created_at', since)
          .order('date', { ascending: true });

        if (candErr) throw new Error(`DB error: ${candErr.message}`);
        if (!candidates || candidates.length === 0) {
          results.push({ userId: user.id, status: 'skipped', error: 'no_large_transactions' }); continue;
        }

        // ── Filter out recurring merchants via the shared detection engine ──
        // Needs the user's full history — a merchant's recurring status can
        // only be determined from its pattern across many months, not from
        // the candidate transaction alone.
        const [{ data: allTxns }, { data: aliasRows }] = await Promise.all([
          supabase.from('transactions').select('date, amount, type, description, category_name').eq('user_id', user.id),
          supabase.from('merchant_aliases').select('alias_key, canonical_key, status').eq('user_id', user.id),
        ]);
        const aliasMap = new Map<string, string>();
        (aliasRows ?? []).filter((a: any) => a.status === 'confirmed')
          .forEach((a: any) => aliasMap.set(a.alias_key, a.canonical_key));

        const nonRecurring = candidates.filter(tx => !isRecurringTransaction(tx, allTxns ?? [], aliasMap));

        if (nonRecurring.length === 0) {
          results.push({ userId: user.id, status: 'skipped', error: 'all_recurring' }); continue;
        }

        // ── Send one email per user per run, listing every qualifying transaction ──
        const html = buildEmailHtml(user.full_name || user.email, nonRecurring);
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

        results.push({ userId: user.id, status: 'sent', count: nonRecurring.length });
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
// EMAIL TEMPLATE
// ══════════════════════════════════════════════════════════════════════════════

const esc = (s: string) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtAmt = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function buildEmailHtml(name: string, txns: { date: string; amount: number; description: string | null; category_name: string | null }[]): string {
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
        <a href="https://arkonomy.app" style="display:inline-block;background:#2F80FF;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:14px 32px;border-radius:12px;letter-spacing:-0.2px;">
          Open Arkonomy →
        </a>
      </div>
    </div>

    <div style="padding:20px 32px;border-top:1px solid #1E2D4A;text-align:center;">
      <div style="font-size:11px;color:#4A5E7A;line-height:1.6;">
        You're receiving this because a transaction over $${LARGE_TX_THRESHOLD} was added to your account.<br/>
        <a href="https://arkonomy.app" style="color:#4A5E7A;">Manage preferences</a>
      </div>
    </div>

  </div>
</body>
</html>`;
}
