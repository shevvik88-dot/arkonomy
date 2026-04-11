// supabase/functions/weekly-report/index.ts
// Sends weekly financial digest emails via Resend.
// Trigger: manual POST or Supabase pg_cron — "0 8 * * 0" (Sunday 08:00 UTC)
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY   — get free key at resend.com (100 emails/day free)
//   REPORT_FROM      — verified sender address, e.g. "Arkonomy <hello@yourdomain.com>"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // ── Optionally target a single user from request body ─────────────────────
    let targetUserId: string | null = null;
    let emailOverride: string | null = null;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        targetUserId  = body?.userId ?? null;
        emailOverride = body?.email  ?? null;
      } catch { /* no body */ }
    }

    // ── Load users ─────────────────────────────────────────────────────────────
    let profiles: { id: string; full_name: string | null; email: string | null }[];

    if (targetUserId && emailOverride) {
      // Caller supplied both — skip the DB lookup
      profiles = [{ id: targetUserId, full_name: null, email: emailOverride }];
    } else {
      const profilesQuery = supabase
        .from('profiles')
        .select('id, full_name, email');
      if (targetUserId) profilesQuery.eq('id', targetUserId);

      const { data, error: profileErr } = await profilesQuery;
      if (profileErr || !data?.length) {
        return new Response(
          JSON.stringify({ error: 'No users found', detail: profileErr }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Allow overriding the email even when we loaded from DB
      profiles = data.map((p: any) => ({
        ...p,
        email: (targetUserId && emailOverride) ? emailOverride : (p.email ?? null),
      }));
    }

    const results: { userId: string; status: string; error?: string }[] = [];

    for (const user of profiles) {
      if (!user.email) continue;
      try {
        const report = await buildReport(supabase, user.id);
        const html   = buildEmailHtml(user.full_name || user.email, report);

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

        results.push({ userId: user.id, status: 'sent' });
      } catch (err) {
        results.push({ userId: user.id, status: 'failed', error: String(err) });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('weekly-report error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════════════════════════════

interface CategoryTotal { name: string; amount: number }

interface WeekReport {
  dateRange:      string;
  thisWeekTotal:  number;
  lastWeekTotal:  number;
  weekDelta:      number;      // thisWeek - lastWeek
  top3Categories: CategoryTotal[];
  healthScore:    number;
  scoreColor:     string;
  aiInsight:      string;
}

async function buildReport(supabase: any, userId: string): Promise<WeekReport> {
  const now       = new Date();
  const thisStart = new Date(now.getTime() - 7  * 86_400_000);
  const lastStart = new Date(now.getTime() - 14 * 86_400_000);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const [{ data: thisTxns }, { data: lastTxns }, { data: allTxns }] = await Promise.all([
    supabase.from('transactions').select('amount, category_name, type, date')
      .eq('user_id', userId).eq('type', 'expense').neq('category_name', 'Transfer')
      .gte('date', fmt(thisStart)).lte('date', fmt(now)),
    supabase.from('transactions').select('amount, category_name, type, date')
      .eq('user_id', userId).eq('type', 'expense').neq('category_name', 'Transfer')
      .gte('date', fmt(lastStart)).lt('date', fmt(thisStart)),
    supabase.from('transactions').select('amount, type, date, category_name')
      .eq('user_id', userId)
      .gte('date', fmt(new Date(now.getTime() - 60 * 86_400_000))),
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

  const dateRange = `${thisStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return { dateRange, thisWeekTotal, lastWeekTotal, weekDelta: thisWeekTotal - lastWeekTotal, top3Categories, healthScore, scoreColor, aiInsight };
}

function computeHealthScore(txns: any[]): { score: number; color: string } {
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const prevStart  = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];

  const thisMonthTxns = txns.filter((t: any) => t.date >= monthStart);
  const lastMonthTxns = txns.filter((t: any) => t.date >= prevStart && t.date < monthStart);

  const sum   = (list: any[], type: string) =>
    list.filter((t: any) => t.type === type && t.category_name !== 'Transfer')
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

function buildEmailHtml(name: string, r: WeekReport): string {
  const deltaColor  = r.weekDelta <= 0 ? '#12D18E' : '#FF5C7A';
  const deltaSign   = r.weekDelta > 0 ? '+' : '';
  const scoreColor  = r.scoreColor;
  const scoreLabel  = r.healthScore <= 40 ? 'Needs Attention' : r.healthScore <= 70 ? 'Fair' : 'Great';

  const catRows = r.top3Categories.map((c, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    return `
      <tr>
        <td style="padding:8px 0; border-bottom:1px solid #1E2D4A; color:#9AA4B2; font-size:13px;">
          ${medals[i] ?? ''} ${c.name}
        </td>
        <td style="padding:8px 0; border-bottom:1px solid #1E2D4A; text-align:right; font-weight:700; color:#FFFFFF; font-size:13px;">
          $${fmtAmt(c.amount)}
        </td>
      </tr>`;
  }).join('');

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
        ${r.dateRange} · Hi ${name.split(' ')[0]}
      </div>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">

      <!-- Week spend summary -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td width="50%" style="padding-right:8px;">
            <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:16px;">
              <div style="font-size:10px;font-weight:600;color:#9AA4B2;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">This Week</div>
              <div style="font-size:26px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">$${fmtAmt(r.thisWeekTotal)}</div>
            </div>
          </td>
          <td width="50%" style="padding-left:8px;">
            <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:16px;">
              <div style="font-size:10px;font-weight:600;color:#9AA4B2;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">vs Last Week</div>
              <div style="font-size:26px;font-weight:800;color:${deltaColor};letter-spacing:-0.5px;">${deltaSign}$${fmtAmt(Math.abs(r.weekDelta))}</div>
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
      </div>

      <!-- Health Score -->
      <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:20px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#9AA4B2;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:14px;">Financial Health Score</div>
        <div style="display:flex;align-items:center;gap:16px;">
          <div style="font-size:48px;font-weight:800;color:${scoreColor};letter-spacing:-2px;line-height:1;">${r.healthScore}</div>
          <div>
            <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-bottom:4px;">${scoreLabel}</div>
            <!-- Score bar -->
            <div style="height:6px;background:#1E2D4A;border-radius:99px;width:160px;overflow:hidden;">
              <div style="height:6px;border-radius:99px;width:${r.healthScore}%;background:${scoreColor};"></div>
            </div>
            <div style="font-size:10px;color:#4A5E7A;margin-top:4px;">${r.healthScore} / 100</div>
          </div>
        </div>
      </div>

      <!-- AI Insight -->
      <div style="background:linear-gradient(135deg,#0D1F3C 0%,#111E33 100%);border:1px solid #00C2FF22;border-radius:14px;padding:20px;margin-bottom:28px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="width:32px;height:32px;border-radius:50%;background:#00C2FF18;border:1px solid #00C2FF33;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;">💡</div>
          <div>
            <div style="font-size:11px;font-weight:600;color:#00C2FF;letter-spacing:0.5px;margin-bottom:6px;">AI INSIGHT</div>
            <div style="font-size:14px;color:#E8EDF5;line-height:1.5;">${r.aiInsight}</div>
          </div>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:28px;">
        <a href="https://arkonomy.app" style="display:inline-block;background:#2F80FF;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:14px 32px;border-radius:12px;letter-spacing:-0.2px;">
          Open Arkonomy →
        </a>
      </div>

    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;border-top:1px solid #1E2D4A;text-align:center;">
      <div style="font-size:11px;color:#4A5E7A;line-height:1.6;">
        You're receiving this because you have an Arkonomy account.<br/>
        <a href="https://arkonomy.app" style="color:#4A5E7A;">Manage preferences</a>
      </div>
    </div>

  </div>
</body>
</html>`;
}
