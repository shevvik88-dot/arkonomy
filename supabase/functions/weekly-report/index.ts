// supabase/functions/weekly-report/index.ts
// Sends weekly financial digest emails via Resend.
// Trigger: manual POST or Supabase pg_cron — "0 8 * * 0" (Sunday 08:00 UTC)
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY   — get free key at resend.com (100 emails/day free)
//   REPORT_FROM      — verified sender address, e.g. "Arkonomy <hello@yourdomain.com>"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';
import { getUpcomingCharges } from '../_shared/recurringDetector.ts';
import { isTransferCategory } from '../_shared/financialConstants.ts';
import { getMarketSnapshot, type MarketQuote } from '../_shared/marketSnapshot.ts';

initSentry('weekly-report');

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-firebase-appcheck',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromAddr  = Deno.env.get('REPORT_FROM') ?? 'Arkonomy <noreply@arkonomy.app>';

    if (!resendKey) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    // Cron path:  Authorization: Bearer <service_role_key>  → sends to all users
    // User path:  Authorization: Bearer <user_jwt>          → sends only to that user
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isCron = token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // ── Load users ─────────────────────────────────────────────────────────────
    const PREFS_SELECT = 'frequency,include_spending,include_balance,include_ai_tip,include_upcoming_bills,include_market_update,next_digest_at';
    let profiles: { id: string; full_name: string | null; email: string | null; _prefs?: any }[];

    if (isCron) {
      // Batch mode — cron job only; email always comes from DB.
      // notification_preferences.user_id references auth.users, not profiles,
      // so PostgREST can't embedded-join profiles+notification_preferences
      // (no FK between the two tables) — fetch separately and merge here.
      const { data: profileRows, error: profileErr } = await supabase
        .from('profiles').select('id, full_name, email');
      if (profileErr || !profileRows?.length) {
        return new Response(
          JSON.stringify({ error: 'No users found', detail: profileErr }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { data: prefsRows, error: prefsErr } = await supabase
        .from('notification_preferences')
        .select(`${PREFS_SELECT},user_id`)
        .in('user_id', profileRows.map(p => p.id));
      if (prefsErr) {
        return new Response(
          JSON.stringify({ error: 'Failed to load notification preferences', detail: prefsErr }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const prefsByUser = new Map((prefsRows ?? []).map((p: any) => [p.user_id, p]));
      profiles = profileRows.map(p => ({ ...p, _prefs: prefsByUser.get(p.id) ?? null }));
    } else {
      // User mode — validate JWT; email always comes from DB, never from request body
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: p, error: profileErr } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('id', user.id)
        .single();
      if (profileErr || !p) {
        return new Response(JSON.stringify({ error: 'User profile not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: prefsRow } = await supabase.from('notification_preferences').select(PREFS_SELECT).eq('user_id', user.id).maybeSingle();
      profiles = [{ ...p, _prefs: prefsRow ?? null }];
    }

    const results: { userId: string; status: string; error?: string }[] = [];

    // Not user-specific — same snapshot for every recipient, so fetch it once
    // for the whole batch instead of once per user (see _shared/marketSnapshot.ts).
    const finnhubKey = Deno.env.get('FINNHUB_API_KEY');
    const marketSnapshot: MarketQuote[] | null = finnhubKey ? await getMarketSnapshot(finnhubKey).catch(() => null) : null;

    for (const user of profiles) {
      if (!user.email) continue;
      try {
        const prefs = { ...DEFAULT_PREFS, ...(user._prefs ?? {}) };
        const now = new Date();

        // Cron-only: respect frequency & schedule
        if (isCron) {
          if (prefs.frequency === 'off') { results.push({ userId: user.id, status: 'skipped', error: 'frequency=off' }); continue; }
          if (prefs.next_digest_at && new Date(prefs.next_digest_at) > now) { results.push({ userId: user.id, status: 'skipped', error: 'not_due_yet' }); continue; }
        }

        if (!prefs.include_spending && !prefs.include_balance && !prefs.include_ai_tip && !prefs.include_upcoming_bills && !prefs.include_market_update) {
          results.push({ userId: user.id, status: 'skipped', error: 'no_sections_enabled' }); continue;
        }

        // Same check as generate-monthly-report — without it, a user with no
        // transactions at all (e.g. never connected a bank) silently gets a
        // content-less digest ($0 everywhere, a meaningless health score)
        // instead of an explicitly logged skip.
        const { count: txCount } = await supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id);
        if (!txCount) {
          results.push({ userId: user.id, status: 'skipped', error: 'No transactions found' }); continue;
        }

        const report = await buildReport(supabase, user.id);
        const html   = buildEmailHtml(user.full_name || user.email || 'User', report, prefs, marketSnapshot);

        const res = await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            from:    fromAddr,
            to:      [user.email],
            subject: `Your Arkonomy weekly report — ${report.dateRange}`,
            html,
          }),
        });

        const resBody = await res.json();
        if (!res.ok) throw new Error(resBody.message ?? JSON.stringify(resBody));

        // Update next_digest_at after successful send (cron only)
        if (isCron) {
          const freqDays = prefs.frequency === 'weekly' ? 7 : prefs.frequency === 'biweekly' ? 14 : 30;
          const nextAt = new Date(now.getTime() + freqDays * 86_400_000).toISOString();
          await supabase.from('notification_preferences').upsert(
            { user_id: user.id, ...DEFAULT_PREFS, ...prefs, next_digest_at: nextAt },
            { onConflict: 'user_id' }
          );
        }

        results.push({ userId: user.id, status: 'sent' });
      } catch (err) {
        results.push({ userId: user.id, status: 'failed', error: "Internal Server Error" });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('weekly-report error:', err);
    await captureAndFlush(err, { function_name: 'weekly-report' });
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_PREFS = { frequency: 'weekly', include_spending: true, include_balance: true, include_ai_tip: true, include_upcoming_bills: true, include_market_update: false, next_digest_at: null as string | null };

interface CategoryTotal { name: string; amount: number }

// Category, not merchant — getUpcomingCharges().merchant is a raw bank
// descriptor (cleanMerchantName was deliberately not ported to Deno; see
// _shared/recurringDetector.ts's header comment), and this is the first
// consumer that would ever surface it directly in user-facing text.
interface UpcomingBill { category: string; amount: number; daysUntil: number }

interface WeekReport {
  dateRange:      string;
  thisWeekTotal:  number;
  lastWeekTotal:  number;
  weekDelta:      number;      // thisWeek - lastWeek
  top3Categories: CategoryTotal[];
  healthScore:    number;
  scoreColor:     string;
  aiInsight:      string;
  upcomingBills:  UpcomingBill[];
}

async function buildReport(supabase: any, userId: string): Promise<WeekReport> {
  const now       = new Date();
  const thisStart = new Date(now.getTime() - 7  * 86_400_000);
  const lastStart = new Date(now.getTime() - 14 * 86_400_000);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const [{ data: thisTxns }, { data: lastTxns }, { data: allTxns }, { data: merchantAliases }] = await Promise.all([
    // .neq(...).neq(...) was missing the plural "Transfers" Zelle/Venmo form
    // (budget/overspending-signals investigation, Step 2, 2026-08-27) — no
    // `description` column selected here, so the isTransferCategory()
    // description-based fallback isn't reachable at this DB-filter layer;
    // this covers the category_name-already-"Transfers" case, which is the
    // vast majority since plaid-sync-transactions writes it at sync time.
    supabase.from('transactions').select('amount, category_name, type, date')
      .eq('user_id', userId).eq('type', 'expense')
      .neq('category_name', 'Transfer').neq('category_name', 'Transfers')
      .gte('date', fmt(thisStart)).lte('date', fmt(now)),
    supabase.from('transactions').select('amount, category_name, type, date')
      .eq('user_id', userId).eq('type', 'expense')
      .neq('category_name', 'Transfer').neq('category_name', 'Transfers')
      .gte('date', fmt(lastStart)).lt('date', fmt(thisStart)),
    supabase.from('transactions').select('amount, type, date, category_name, description')
      .eq('user_id', userId)
      .gte('date', fmt(new Date(now.getTime() - 60 * 86_400_000))),
    supabase.from('merchant_aliases').select('alias_key, canonical_key, status').eq('user_id', userId),
  ]);

  const thisWeekTotal = (thisTxns || []).reduce((s: number, t: any) => s + Number(t.amount), 0);
  const lastWeekTotal = (lastTxns || []).reduce((s: number, t: any) => s + Number(t.amount), 0);

  // Top 3 categories this week
  const catMap: Record<string, number> = {};
  for (const t of (thisTxns || [])) {
    const cat = t.category_name || 'Other';
    catMap[cat] = (catMap[cat] || 0) + Number(t.amount);
  }
  const top3Categories: CategoryTotal[] = Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, amount]) => ({ name, amount }));

  // Health score from past 30 days
  const { score: healthScore, color: scoreColor } = computeHealthScore(allTxns || []);

  // One AI insight
  const aiInsight = pickInsight({ thisWeekTotal, lastWeekTotal, top3Categories, healthScore });

  // aliasMap: raw alias_key -> canonical_key, confirmed only — mirrors
  // get-insights/App.jsx exactly, so this agrees with what the client shows.
  const aliasMap = new Map<string, string>();
  (merchantAliases || []).filter((a: any) => a.status === 'confirmed')
    .forEach((a: any) => aliasMap.set(a.alias_key, a.canonical_key));

  const upcomingBills: UpcomingBill[] = getUpcomingCharges(allTxns || [], aliasMap, now, { maxDays: 7, maxResults: 5 })
    .map((c: any) => ({ category: c.category, amount: c.amount, daysUntil: c.daysUntil }));

  const dateRange = `${thisStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return { dateRange, thisWeekTotal, lastWeekTotal, weekDelta: thisWeekTotal - lastWeekTotal, top3Categories, healthScore, scoreColor, aiInsight, upcomingBills };
}

function computeHealthScore(txns: any[]): { score: number; color: string } {
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const prevStart  = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];

  const thisMonthTxns = txns.filter((t: any) => t.date >= monthStart);
  const lastMonthTxns = txns.filter((t: any) => t.date >= prevStart && t.date < monthStart);

  const sum   = (list: any[], type: string) =>
    list.filter((t: any) => t.type === type && !isTransferCategory(t))
        .reduce((s: number, t: any) => s + Number(t.amount), 0);

  const income    = sum(thisMonthTxns, 'income');
  const spent     = sum(thisMonthTxns, 'expense');
  const lastInc   = sum(lastMonthTxns, 'income');
  const lastSpent = sum(lastMonthTxns, 'expense');

  const saved      = Math.max(income - spent, 0);
  const savingsRate = income > 0 ? saved / income : 0;
  const savingsPts = Math.min(Math.round((savingsRate / 0.20) * 30), 30);

  const trendDelta = (income - spent) - (lastInc - lastSpent);
  const trendPts   = trendDelta >= 0 ? 25 : Math.max(0, Math.round((1 - Math.min(Math.abs(trendDelta) / Math.max(Math.abs(lastInc - lastSpent), 100), 1)) * 25));

  const score = Math.min(100, Math.max(0, savingsPts + 12 + 12 + trendPts));
  const color = score <= 40 ? '#FF5C7A' : score <= 70 ? '#FFB800' : '#12D18E';

  return { score, color };
}

function pickInsight({ thisWeekTotal, lastWeekTotal, top3Categories, healthScore }: any): string {
  const delta = thisWeekTotal - lastWeekTotal;
  const top   = top3Categories[0];

  if (healthScore >= 75) return 'Your finances are in great shape — keep maintaining this pace.';
  if (delta > 50 && top) return `Spending increased $${fmtAmt(delta)} vs last week — ${top.name} is the top driver.`;
  if (delta < -50) return `Nice work — you spent $${fmtAmt(Math.abs(delta))} less than last week.`;
  if (healthScore < 45) return 'Health score is low — consider reviewing subscriptions and budget.';
  if (top) return `${top.name} is your biggest spend this week at $${fmtAmt(top.amount)}.`;
  return 'Track your spending daily to stay ahead of your monthly budget.';
}

function fmtAmt(n: number): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATE
// ══════════════════════════════════════════════════════════════════════════════

const esc = (s: string) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const MARKET_LABELS: Record<string, string> = { SPY: 'S&P 500', QQQ: 'Nasdaq 100', BTC: 'Bitcoin', ETH: 'Ethereum' };

function buildEmailHtml(name: string, r: WeekReport, prefs = DEFAULT_PREFS, marketSnapshot: MarketQuote[] | null = null): string {
  const deltaColor   = r.weekDelta <= 0 ? '#12D18E' : '#FF5C7A';
  const deltaCaption = r.weekDelta === 0
    ? 'No change from last week'
    : `${r.weekDelta < 0 ? '↓' : '↑'} $${fmtAmt(Math.abs(r.weekDelta))} ${r.weekDelta < 0 ? 'less' : 'more'} than last week`;
  const scoreColor  = r.scoreColor;
  const scoreLabel  = r.healthScore <= 40 ? 'Needs Attention' : r.healthScore <= 70 ? 'Fair' : 'Great';

  const catRows = r.top3Categories.map((c, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    return `
      <tr>
        <td style="padding:8px 0; border-bottom:1px solid #1E2D4A; color:#9AA4B2; font-size:13px;">
          ${medals[i] ?? ''} ${esc(c.name)}
        </td>
        <td style="padding:8px 0; border-bottom:1px solid #1E2D4A; text-align:right; font-weight:700; color:#FFFFFF; font-size:13px;">
          $${fmtAmt(c.amount)}
        </td>
      </tr>`;
  }).join('');

  const spendingSection = prefs.include_spending ? `
      <!-- Week spend summary -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td width="50%" style="padding-right:8px;">
            <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:16px;">
              <div style="font-size:10px;font-weight:600;color:#9AA4B2;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">This Week</div>
              <div style="font-size:26px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">$${fmtAmt(r.thisWeekTotal)}</div>
              <div style="font-size:11px;font-weight:600;color:${deltaColor};margin-top:4px;">${deltaCaption}</div>
            </div>
          </td>
          <td width="50%" style="padding-left:8px;">
            <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:16px;">
              <div style="font-size:10px;font-weight:600;color:#9AA4B2;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">Last Week</div>
              <div style="font-size:26px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">$${fmtAmt(r.lastWeekTotal)}</div>
            </div>
          </td>
        </tr>
      </table>

      <!-- Top 3 Categories -->
      <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:20px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#9AA4B2;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:12px;">Top Spending Categories</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${catRows || '<tr><td style="color:#4A5E7A;font-size:13px;padding:8px 0;">No expenses this week.</td></tr>'}
        </table>
      </div>` : '';

  const balanceSection = prefs.include_balance ? `
      <!-- Health Score -->
      <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:20px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#9AA4B2;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:14px;">Financial Health Score</div>
        <div style="display:flex;align-items:center;gap:16px;">
          <div style="font-size:48px;font-weight:800;color:${scoreColor};letter-spacing:-2px;line-height:1;">${r.healthScore}</div>
          <div>
            <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-bottom:4px;">${scoreLabel}</div>
            <div style="height:6px;background:#1E2D4A;border-radius:99px;width:160px;overflow:hidden;">
              <div style="height:6px;border-radius:99px;width:${r.healthScore}%;background:${scoreColor};"></div>
            </div>
            <div style="font-size:10px;color:#4A5E7A;margin-top:4px;">${r.healthScore} / 100</div>
          </div>
        </div>
      </div>` : '';

  const billRows = r.upcomingBills.map(b => {
    const dayLabel = b.daysUntil === 0 ? 'Today' : b.daysUntil === 1 ? 'Tomorrow' : `in ${b.daysUntil}d`;
    return `
      <tr>
        <td style="padding:8px 0; border-bottom:1px solid #1E2D4A; color:#9AA4B2; font-size:13px;">
          ${esc(b.category)}
        </td>
        <td style="padding:8px 0; border-bottom:1px solid #1E2D4A; text-align:center; color:#4A5E7A; font-size:12px;">
          ${dayLabel}
        </td>
        <td style="padding:8px 0; border-bottom:1px solid #1E2D4A; text-align:right; font-weight:700; color:#FFFFFF; font-size:13px;">
          $${fmtAmt(b.amount)}
        </td>
      </tr>`;
  }).join('');

  const upcomingBillsSection = prefs.include_upcoming_bills && r.upcomingBills.length > 0 ? `
      <!-- Upcoming Bills -->
      <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:20px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#9AA4B2;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:12px;">Upcoming Bills (Next 7 Days)</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${billRows}
        </table>
      </div>` : '';

  const marketRows = (marketSnapshot ?? []).map(q => {
    const pct   = q.changePct;
    const color = pct == null ? '#9AA4B2' : pct >= 0 ? '#12D18E' : '#FF5C7A';
    const sign  = pct != null && pct > 0 ? '+' : '';
    return `
      <tr>
        <td style="padding:8px 0; border-bottom:1px solid #1E2D4A; color:#9AA4B2; font-size:13px;">
          ${esc(MARKET_LABELS[q.symbol] ?? q.symbol)}
        </td>
        <td style="padding:8px 0; border-bottom:1px solid #1E2D4A; text-align:right; font-weight:700; color:#FFFFFF; font-size:13px;">
          ${q.price != null ? `$${fmtAmt(q.price)}` : '—'}
        </td>
        <td style="padding:8px 0; border-bottom:1px solid #1E2D4A; text-align:right; font-weight:700; color:${color}; font-size:13px; width:70px;">
          ${pct != null ? `${sign}${pct.toFixed(2)}%` : '—'}
        </td>
      </tr>`;
  }).join('');

  const marketSection = prefs.include_market_update && marketSnapshot && marketSnapshot.length > 0 ? `
      <!-- Market Update -->
      <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:20px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#9AA4B2;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:12px;">Market Update</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${marketRows}
        </table>
      </div>` : '';

  const aiSection = prefs.include_ai_tip ? `
      <!-- AI Insight -->
      <div style="background:linear-gradient(135deg,#0D1F3C 0%,#111E33 100%);border:1px solid #00C2FF22;border-radius:14px;padding:20px;margin-bottom:28px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="width:32px;height:32px;border-radius:50%;background:#00C2FF18;border:1px solid #00C2FF33;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;">💡</div>
          <div>
            <div style="font-size:11px;font-weight:600;color:#00C2FF;letter-spacing:0.5px;margin-bottom:6px;">AI INSIGHT</div>
            <div style="font-size:14px;color:#E8EDF5;line-height:1.5;">${esc(r.aiInsight)}</div>
          </div>
        </div>
      </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Arkonomy Weekly Report</title>
</head>
<body style="margin:0;padding:0;background:#060E1C;font-family:'Inter',Arial,sans-serif;color:#FFFFFF;">
  <div style="max-width:520px;margin:0 auto;background:#060E1C;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0D1F3C 0%,#0B1426 100%);padding:28px 32px;border-bottom:1px solid #1E2D4A;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#FFFFFF;">
        Arkonomy
        <span style="font-size:10px;font-weight:600;color:#00C2FF;background:#00C2FF18;border:1px solid #00C2FF33;border-radius:99px;padding:2px 8px;margin-left:8px;vertical-align:middle;letter-spacing:0.5px;">WEEKLY DIGEST</span>
      </div>
      <div style="font-size:13px;color:#9AA4B2;margin-top:4px;">
        ${r.dateRange} · Hi ${esc(name.split(' ')[0])}
      </div>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">
      ${spendingSection}
      ${balanceSection}
      ${upcomingBillsSection}
      ${marketSection}
      ${aiSection}

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:28px;">
        <a href="https://app.arkonomy.com" style="display:inline-block;background:#2F80FF;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:14px 32px;border-radius:12px;letter-spacing:-0.2px;">
          Open Arkonomy →
        </a>
      </div>

    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;border-top:1px solid #1E2D4A;text-align:center;">
      <div style="font-size:11px;color:#4A5E7A;line-height:1.6;">
        You're receiving this because you have an Arkonomy account.<br/>
        <a href="https://app.arkonomy.com" style="color:#4A5E7A;">Manage preferences</a>
      </div>
    </div>

  </div>
</body>
</html>`;
}
