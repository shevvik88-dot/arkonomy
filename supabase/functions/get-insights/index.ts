// supabase/functions/get-insights/index.ts

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

    const { userId } = await req.json();
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'userId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const input = await buildFinancialInput(supabase, userId);
    const result = generateInsights(input);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('get-insights error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const BUFFER = 1_000;

const SAVE_CAP_SMALL  = 200;
const SAVE_CAP_MEDIUM = 500;
const SAVE_CAP_LARGE  = 1_000;
const ROUND_TO        = 50;

const REC_MIN = 200;
const REC_MAX = 400;

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function roundTo50(n: number): number {
  return Math.round(n / ROUND_TO) * ROUND_TO;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function savingsCap(monthlyIncome: number): number {
  if (monthlyIncome < 2_000) return SAVE_CAP_SMALL;
  if (monthlyIncome < 4_000) return SAVE_CAP_MEDIUM;
  return SAVE_CAP_LARGE;
}

function computeRecommendedAmount(availableSafe: number, multiplier = 0.6): number {
  if (availableSafe <= 0) return 0;
  const raw = roundTo50(availableSafe * multiplier);
  if (availableSafe < 800) {
    return clamp(raw, 50, 100);
  }
  return clamp(raw, REC_MIN, REC_MAX);
}

function computeSuggestedSave(
  availableSafe: number,
  monthlyIncome: number,
  phase: 'early' | 'mid' | 'late'
): number {
  if (availableSafe <= 0) return 0;
  const cap = savingsCap(monthlyIncome);
  const phaseMultiplier = phase === 'early' ? 0.15 : phase === 'mid' ? 0.60 : 1.0;
  const raw = clamp(availableSafe, 0, cap * phaseMultiplier);
  return roundTo50(raw);
}

function fmt(n: number): string {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function getDistinctMonths(txns: any[]): Set<string> {
  const months = new Set<string>();
  for (const t of txns) {
    if (t.date) months.add(t.date.slice(0, 7));
  }
  return months;
}

// ══════════════════════════════════════════════════════════════════════════════
// BUILD FINANCIAL INPUT
// ══════════════════════════════════════════════════════════════════════════════

async function buildFinancialInput(supabase: any, userId: string) {
  const now = new Date();

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString().split('T')[0];

  const startOf3MonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    .toISOString().split('T')[0];

  const startOfIncomeLookback = new Date(
    now.getFullYear(), now.getMonth() - 1, now.getDate() - 5
  ).toISOString().split('T')[0];

  const todayStr = now.toISOString().split('T')[0];

  const [
    { data: currentTxns,      error: e1 },
    { data: historicalTxns,   error: e2 },
    { data: recentIncomeTxns, error: e4 },
    { data: savingsGoals,     error: e3 },
  ] = await Promise.all([
    supabase.from('transactions').select('amount, category_name, description, date, type')
      .eq('user_id', userId).gte('date', startOfMonth).lte('date', todayStr),
    supabase.from('transactions').select('amount, category_name, description, date, type')
      .eq('user_id', userId).gte('date', startOf3MonthsAgo).lt('date', startOfMonth),
    supabase.from('transactions').select('amount, date, type')
      .eq('user_id', userId).eq('type', 'income')
      .gte('date', startOfIncomeLookback).lte('date', todayStr)
      .order('date', { ascending: false }),
    supabase.from('savings').select('id, name, target, current').eq('user_id', userId),
  ]);

  if (e1) console.error('currentTxns error:', e1);
  if (e2) console.error('historicalTxns error:', e2);
  if (e3) console.error('savingsGoals error:', e3);
  if (e4) console.error('recentIncome error:', e4);

  const current      = currentTxns      || [];
  const historical   = historicalTxns   || [];
  const recentIncome = recentIncomeTxns || [];

  // ── Effective monthly income ──────────────────────────────────────────────
  const currentMonthIncome = current
    .filter((t: any) => t.type === 'income')
    .reduce((sum: number, t: any) => sum + Number(t.amount), 0);

  let effectiveMonthlyIncome = currentMonthIncome;

  // FIX: sum ALL income from the most recent month, not just recentIncome[0].amount.
  // The old code took one transaction which could be a small CD deposit ($1,000),
  // making availableSafe = income - BUFFER = 0 and causing the savings button to show $0.
  if (effectiveMonthlyIncome === 0 && recentIncome.length > 0) {
    const mostRecentMonth = recentIncome[0].date.slice(0, 7);
    effectiveMonthlyIncome = recentIncome
      .filter((t: any) => t.date.slice(0, 7) === mostRecentMonth)
      .reduce((sum: number, t: any) => sum + Number(t.amount), 0);
  }

  if (effectiveMonthlyIncome === 0) {
    const historicalMonthIncome: Record<string, number> = {};
    historical.filter((t: any) => t.type === 'income').forEach((t: any) => {
      const month = t.date.slice(0, 7);
      historicalMonthIncome[month] = (historicalMonthIncome[month] || 0) + Number(t.amount);
    });
    const vals = Object.values(historicalMonthIncome);
    if (vals.length > 0) {
      effectiveMonthlyIncome = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }

  // ── Spending ──────────────────────────────────────────────────────────────
  const currentMonthSpend = current
    .filter((t: any) => t.type === 'expense')
    .reduce((sum: number, t: any) => sum + Number(t.amount), 0);

  const historicalExpenses = historical
    .filter((t: any) => t.type === 'expense')
    .reduce((sum: number, t: any) => sum + Number(t.amount), 0);

  const historicalMonths = getDistinctMonths(historical);
  const monthsOfHistory  = historicalMonths.size;
  const avg3mSpend       = monthsOfHistory > 0 ? historicalExpenses / monthsOfHistory : 0;

  const availableSafe = Math.max(0, effectiveMonthlyIncome - currentMonthSpend - BUFFER);

  const allIncome = [...historical, ...current]
    .filter((t: any) => t.type === 'income')
    .reduce((sum: number, t: any) => sum + Number(t.amount), 0);
  const allExpenses = [...historical, ...current]
    .filter((t: any) => t.type === 'expense')
    .reduce((sum: number, t: any) => sum + Number(t.amount), 0);
  const currentBalance = allIncome - allExpenses;

  // ── Categories ────────────────────────────────────────────────────────────
  const categoryMap: Record<string, number> = {};
  current.filter((t: any) => t.type === 'expense').forEach((t: any) => {
    const cat = t.category_name || 'Other';
    categoryMap[cat] = (categoryMap[cat] || 0) + Number(t.amount);
  });

  const historyCategoryMap: Record<string, number> = {};
  historical.filter((t: any) => t.type === 'expense').forEach((t: any) => {
    const cat = t.category_name || 'Other';
    historyCategoryMap[cat] = (historyCategoryMap[cat] || 0) + Number(t.amount);
  });

  const categories = Array.from(
    new Set([...Object.keys(categoryMap), ...Object.keys(historyCategoryMap)])
  ).map((name) => ({
    name,
    currentMonthSpend: categoryMap[name] || 0,
    avg3mSpend: monthsOfHistory > 0 ? (historyCategoryMap[name] || 0) / monthsOfHistory : 0,
  }));

  const goals = (savingsGoals || []).map((g: any) => ({
    id: g.id, name: g.name,
    monthlyTarget: Number(g.target) || 0,
    monthlyActual: Number(g.current) || 0,
  }));

  const dayOfMonth  = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft    = daysInMonth - dayOfMonth;

  return {
    currentBalance,
    currentMonthSpend,
    effectiveMonthlyIncome,
    availableSafe,
    avg3mSpend,
    upcomingBills7d: 0,
    monthsOfHistory,
    dataFreshnessHours: 0,
    categories,
    goals,
    rawTransactions:        current,
    historicalTransactions: historical,
    dayOfMonth,
    daysLeft,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// AI BRAIN
// ══════════════════════════════════════════════════════════════════════════════

function generateInsights(input: any) {
  const ctx        = buildRenderContext(input);
  const metrics    = computeMetrics(input, ctx);
  const allSignals = detectSignals(metrics);
  const deduped    = deduplicateSignals(allSignals);
  const { winner } = prioritize(deduped, ctx);
  const screens    = resolveScreens(deduped, winner, ctx);

  return {
    generatedAt: new Date().toISOString(),
    hasInsights: winner !== null,
    screens,
  };
}

interface RenderContext {
  dayOfMonth: number;
  daysLeft:   number;
  monthPhase: 'early' | 'mid' | 'late';
}

function buildRenderContext(input: any): RenderContext {
  const day  = input.dayOfMonth || new Date().getDate();
  const left = input.daysLeft ?? 10;
  return {
    dayOfMonth: day,
    daysLeft:   left,
    monthPhase: day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late',
  };
}

function computeMetrics(input: any, ctx: RenderContext) {
  const spendDelta = input.currentMonthSpend - input.avg3mSpend;

  const suggestedSave = computeSuggestedSave(
    input.availableSafe,
    input.effectiveMonthlyIncome,
    ctx.monthPhase
  );

  const keepAfterSave = Math.max(
    0,
    input.effectiveMonthlyIncome - input.currentMonthSpend - suggestedSave
  );

  const saveRangeLow  = roundTo50(Math.max(0, suggestedSave * 0.65));
  const saveRangeHigh = roundTo50(Math.min(input.availableSafe, suggestedSave * 1.15));

  return {
    currentBalance:         input.currentBalance,
    currentMonthSpend:      input.currentMonthSpend,
    effectiveMonthlyIncome: input.effectiveMonthlyIncome,
    avg3mSpend:             input.avg3mSpend,
    spendDelta,
    upcomingBills7d:        input.upcomingBills7d,
    availableSafe:          input.availableSafe,
    suggestedSave,
    keepAfterSave,
    saveRangeLow,
    saveRangeHigh,
    roundUpMonthly:         input.roundUpMonthly ?? 0,
    topCategorySpike:       findTopCategorySpike(input.categories),
    topCategoryTransaction: findTopCategoryTransaction(input.categories, input.rawTransactions),
    historicalTransactions: input.historicalTransactions || [],
    offTrackGoal:           findOffTrackGoal(input.goals),
    hasEnoughHistory:       input.monthsOfHistory >= 2,
    dataIsStale:            input.dataFreshnessHours > 72,
  };
}

function findTopCategorySpike(categories: any[]) {
  let top: any = null;
  for (const cat of (categories || [])) {
    if (!cat.avg3mSpend || cat.avg3mSpend === 0) continue;
    const delta = cat.currentMonthSpend - cat.avg3mSpend;
    const pctIncrease = delta / cat.avg3mSpend;
    if (pctIncrease > 0.25 && delta >= 75) {
      if (!top || delta > top.delta) {
        top = {
          name: cat.name,
          currentSpend: cat.currentMonthSpend,
          avgSpend: cat.avg3mSpend,
          delta,
          pctIncrease,
        };
      }
    }
  }
  return top;
}

function findTopCategoryTransaction(categories: any[], rawTransactions: any[]) {
  if (!categories || !rawTransactions) return null;
  let topCat: any = null;
  for (const cat of categories) {
    if (!cat.avg3mSpend || cat.avg3mSpend === 0) continue;
    const delta = cat.currentMonthSpend - cat.avg3mSpend;
    const pct   = delta / cat.avg3mSpend;
    if (pct > 0.25 && delta >= 75) {
      if (!topCat || delta > topCat.delta) topCat = { ...cat, delta };
    }
  }
  if (!topCat) return null;
  const catTxns = rawTransactions.filter(
    (t: any) => t.category_name === topCat.name && t.type === 'expense'
  );
  if (!catTxns.length) return null;
  return catTxns.sort((a: any, b: any) => Number(b.amount) - Number(a.amount))[0];
}

function findOffTrackGoal(goals: any[]) {
  let worst: any = null;
  for (const goal of (goals || [])) {
    if (!goal.monthlyTarget || goal.monthlyTarget === 0) continue;
    if (goal.monthlyActual < goal.monthlyTarget * 0.8) {
      const shortfall = goal.monthlyTarget - goal.monthlyActual;
      if (!worst || shortfall > worst.shortfall) {
        worst = {
          id: goal.id, name: goal.name,
          monthlyTarget: goal.monthlyTarget,
          monthlyActual: goal.monthlyActual,
          shortfall,
        };
      }
    }
  }
  return worst;
}

// ══════════════════════════════════════════════════════════════════════════════
// SIGNALS
// ══════════════════════════════════════════════════════════════════════════════

function deduplicateSignals(signals: any[]): any[] {
  const seen = new Map<string, any>();
  for (const s of signals) {
    const existing = seen.get(s.type);
    if (!existing || s.priority > existing.priority) seen.set(s.type, s);
  }
  return Array.from(seen.values());
}

const PRIORITY: Record<string, number> = {
  cash_risk:           100,
  category_spike:       75,
  overspending:         70,
  goal_off_track:       65,
  savings_opportunity:  60,
  positive_progress:    40,
};

const WARNING_TYPES = ['cash_risk', 'category_spike', 'overspending', 'goal_off_track'];

function detectSignals(metrics: any) {
  if (metrics.dataIsStale) return [];
  if (!metrics.hasEnoughHistory) {
    return [...detectCashRisk(metrics), ...detectSavingsOpportunity(metrics)];
  }
  return [
    ...detectCashRisk(metrics),
    ...detectCategorySpike(metrics),
    ...detectOverspending(metrics),
    ...detectSavingsOpportunity(metrics),
    ...detectGoalOffTrack(metrics),
    ...detectPositiveProgress(metrics),
  ];
}

function detectCashRisk(m: any) {
  if (m.upcomingBills7d === 0) return [];
  if (m.currentBalance < m.upcomingBills7d + 100) {
    return [{ type: 'cash_risk', priority: PRIORITY.cash_risk, data: {
      currentBalance:  m.currentBalance,
      upcomingBills7d: m.upcomingBills7d,
      shortfall:       m.upcomingBills7d + 100 - m.currentBalance,
    }}];
  }
  return [];
}

// Normalize merchant name the same way as the recurring merchant map
function normalizeMerchant(raw: string): string {
  return (raw || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Returns true if the description appears in the historical transactions in 2+ distinct
// calendar months with a tight amount spread (≤ $10) — i.e. it is a recurring charge.
function isKnownRecurringMerchant(description: string, historical: any[]): boolean {
  const key = normalizeMerchant(description);
  if (!key || key.length < 3) return false;
  const monthAmounts: Record<string, number[]> = {};
  for (const t of historical) {
    if (t.type !== 'expense') continue;
    const tKey = normalizeMerchant(t.description || '');
    // Accept if either is a substring of the other (handles truncated descriptions)
    if (!tKey || (!tKey.includes(key.slice(0, 10)) && !key.includes(tKey.slice(0, 10)))) continue;
    const mo = (t.date || '').slice(0, 7);
    if (!monthAmounts[mo]) monthAmounts[mo] = [];
    monthAmounts[mo].push(Number(t.amount));
  }
  const months = Object.values(monthAmounts);
  if (months.length < 2) return false;
  const allAmounts = months.flat();
  const spread = Math.max(...allAmounts) - Math.min(...allAmounts);
  return spread <= 10;
}

function detectCategorySpike(m: any) {
  if (!m.topCategorySpike) return [];
  const s     = m.topCategorySpike;
  const topTx = m.topCategoryTransaction;

  // A transaction is only "one-time" if it dominates the category spend AND
  // is NOT a known recurring merchant (e.g. rent paid via Turbotenant).
  const dominatesCategory = topTx && s.currentSpend > 0 &&
    (Number(topTx.amount) / s.currentSpend) >= 0.60;
  const merchantIsRecurring = topTx &&
    isKnownRecurringMerchant(topTx.description || '', m.historicalTransactions || []);
  const isOneTime = dominatesCategory && !merchantIsRecurring;

  return [{ type: 'category_spike', priority: PRIORITY.category_spike, data: {
    categoryName:  s.name,
    currentSpend:  s.currentSpend,
    avgSpend:      s.avgSpend,
    delta:         s.delta,
    pctIncrease:   s.pctIncrease,
    subtype:       isOneTime ? 'one_time_driver' : 'recurring',
    primaryDriver: isOneTime
      ? { label: topTx.description || s.name, amount: Number(topTx.amount) }
      : null,
  }}];
}

function detectOverspending(m: any) {
  if (m.currentMonthSpend > m.avg3mSpend * 1.1 && m.spendDelta >= 100) {
    return [{ type: 'overspending', priority: PRIORITY.overspending, data: {
      currentMonthSpend: m.currentMonthSpend,
      avg3mSpend:        m.avg3mSpend,
      delta:             m.spendDelta,
    }}];
  }
  return [];
}

function detectSavingsOpportunity(m: any) {
  const recommended = computeRecommendedAmount(m.availableSafe);
  if (recommended < 50) return [];
  return [{ type: 'savings_opportunity', priority: PRIORITY.savings_opportunity, data: {
    availableSafe:     m.availableSafe,
    suggestedSave:     m.suggestedSave,
    recommendedAmount: recommended,
    keepAfterSave:     m.keepAfterSave,
    saveRangeLow:      m.saveRangeLow,
    saveRangeHigh:     m.saveRangeHigh,
    roundUpMonthly:    m.roundUpMonthly ?? 0,
    roundUpPrompt:     true,
  }}];
}

function detectGoalOffTrack(m: any) {
  if (!m.offTrackGoal) return [];
  const g = m.offTrackGoal;

  const rawContrib = Math.min(g.shortfall, m.availableSafe * 0.6);
  const recommendedContribution = computeRecommendedAmount(rawContrib, 1.0);

  return [{ type: 'goal_off_track', priority: PRIORITY.goal_off_track, data: {
    goalId:                  g.id,
    goalName:                g.name,
    monthlyTarget:           g.monthlyTarget,
    monthlyActual:           g.monthlyActual,
    shortfall:               g.shortfall,
    availableSafe:           m.availableSafe,
    recommendedContribution,
    roundUpMonthly:          m.roundUpMonthly ?? 0,
  }}];
}

function detectPositiveProgress(m: any) {
  if (m.avg3mSpend - m.currentMonthSpend >= 100) {
    return [{ type: 'positive_progress', priority: PRIORITY.positive_progress, data: {
      reason:            'underspending',
      currentMonthSpend: m.currentMonthSpend,
      avg3mSpend:        m.avg3mSpend,
      delta:             m.avg3mSpend - m.currentMonthSpend,
    }}];
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-EXPAND
// ══════════════════════════════════════════════════════════════════════════════

function shouldAutoExpand(signal: any, topSignal: any): boolean {
  if (!topSignal) return false;
  if (signal.type !== topSignal.type) return false;
  if (signal.type === 'positive_progress') return false;
  if (signal.type === 'cash_risk') return true;
  if (signal.type === 'category_spike' && signal.priority >= 75) return true;
  if (signal.type === 'overspending'   && signal.priority >= 70) return true;
  if (signal.type === 'goal_off_track' && signal.priority >= 65) return true;
  if (signal.type === 'savings_opportunity') {
    return (signal.data?.recommendedAmount ?? 0) >= 200;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// PRIORITY & SUPPRESSION
// ══════════════════════════════════════════════════════════════════════════════

function prioritize(signals: any[], ctx: RenderContext) {
  if (!signals.length) return { winner: null, suppressedTypes: [] };
  const suppressed = new Set<string>();
  const types      = new Set(signals.map((s: any) => s.type));

  if (types.has('cash_risk'))     { suppressed.add('savings_opportunity'); suppressed.add('positive_progress'); }
  if (types.has('category_spike') && types.has('overspending')) { suppressed.add('overspending'); }
  if (signals.some((s: any) => WARNING_TYPES.includes(s.type))) { suppressed.add('positive_progress'); }

  const active = signals
    .filter((s: any) => !suppressed.has(s.type))
    .sort((a: any, b: any) => b.priority - a.priority);

  if (!active.length) return { winner: null, suppressedTypes: [...suppressed] };

  const top = active[0];
  return {
    winner: {
      type:       top.type,
      priority:   top.priority,
      autoExpand: shouldAutoExpand(top, top),
      data:       top.data,
      rendered:   renderInsight(top, ctx),
    },
    suppressedTypes: [...suppressed],
  };
}

function prioritizeTop(signals: any[], n: number, ctx: RenderContext) {
  if (!signals.length) return [];
  const suppressed = new Set<string>();
  const types      = new Set(signals.map((s: any) => s.type));

  if (types.has('cash_risk'))     { suppressed.add('savings_opportunity'); suppressed.add('positive_progress'); }
  if (types.has('category_spike') && types.has('overspending')) { suppressed.add('overspending'); }
  if (signals.some((s: any) => WARNING_TYPES.includes(s.type))) { suppressed.add('positive_progress'); }

  const active    = signals
    .filter((s: any) => !suppressed.has(s.type))
    .sort((a: any, b: any) => b.priority - a.priority)
    .slice(0, n);
  const topSignal = active[0] ?? null;

  return active.map((s: any) => ({
    type:       s.type,
    priority:   s.priority,
    autoExpand: shouldAutoExpand(s, topSignal),
    data:       s.data,
    rendered:   renderInsight(s, ctx),
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER INSIGHT
// ══════════════════════════════════════════════════════════════════════════════

function renderInsight(signal: any, ctx: RenderContext) {
  const d = signal.data;

  switch (signal.type) {

    case 'cash_risk': {
      const urgency = ctx.daysLeft <= 3 ? 'very soon' : 'in the next 7 days';
      return {
        headline: `You're $${fmt(d.shortfall)} short for upcoming bills`,
        body:     `You have $${fmt(d.currentBalance)} available, but $${fmt(d.upcomingBills7d)} in bills due ${urgency}. Move funds before they're due.`,
        cta:      'View Bills',
        range:    null,
        action:   'view_bills',
      };
    }

    case 'category_spike': {
      const pct          = Math.round(d.pctIncrease * 100);
      const midMonthNote = ctx.monthPhase !== 'late' ? ` ${ctx.daysLeft} days left to adjust.` : '';
      if (d.subtype === 'one_time_driver' && d.primaryDriver) {
        return {
          headline: `${d.categoryName} up ${pct}% — one-time expense`,
          body:     `This increase was caused by a $${fmt(d.primaryDriver.amount)} ${d.primaryDriver.label}. Your usual ${d.categoryName} spending is much lower.\n\n→ This is a one-time expense, not a trend.\n→ No changes needed now, but monitor next month to confirm stability.`,
          cta:      'Monitor Spending',
          range:    null,
          action:   'reduce_category',
        };
      }
      return {
        headline: `Cut ${d.categoryName} by ~$${fmt(d.delta)} to get back on track`,
        body:     `You've spent $${fmt(d.currentSpend)} on ${d.categoryName} — $${fmt(d.delta)} above your usual $${fmt(d.avgSpend)}/month.${midMonthNote}\n\n→ This is a recurring pattern. Reducing now keeps you on track for next month.`,
        cta:      'Review Category',
        range:    null,
        action:   'reduce_category',
      };
    }

    case 'overspending': {
      const timeNote = ctx.monthPhase === 'early'
        ? "It's early — there's still time to course-correct."
        : ctx.monthPhase === 'mid'
        ? `${ctx.daysLeft} days left to bring it down.`
        : 'Worth reviewing what drove the extra spend.';
      return {
        headline: `Spending is $${fmt(d.delta)} above your usual pace`,
        body:     `$${fmt(d.currentMonthSpend)} this month vs your $${fmt(d.avg3mSpend)} average.\n\n→ ${timeNote}`,
        cta:      'Review Spending',
        range:    null,
        action:   'review_spending',
      };
    }

    case 'savings_opportunity': {
      const rec = d.recommendedAmount ?? computeRecommendedAmount(d.availableSafe);
      const recHigh = Math.min(rec + 100, Math.round(d.availableSafe));
      const { saveRangeLow, saveRangeHigh, availableSafe } = d;

      const timeNote = ctx.monthPhase === 'late'
        ? 'The month is wrapping up — a good time to lock in savings.'
        : ctx.monthPhase === 'mid'
        ? `Still ${ctx.daysLeft} days left — this keeps a comfortable buffer.`
        : `It's early in the month, so this is a conservative starting amount.`;

      const spareChangeLine = d.roundUpMonthly > 0
        ? ` You also have $${fmt(d.roundUpMonthly)} in spare change from round-ups you can invest.`
        : '';

      return {
        headline: `You can move $${fmt(rec)}–$${fmt(recHigh)} to savings`,
        body:     `Your spending is under control. A safer contribution is $${fmt(rec)}–$${fmt(recHigh)} to keep your buffer stable.${spareChangeLine}\n\n→ ${timeNote}`,
        cta:      `Add $${fmt(rec)}–$${fmt(recHigh)} safely`,
        range:    `Safe range: $${fmt(saveRangeLow)} – $${fmt(saveRangeHigh)}`,
        action:   'move_to_savings',
        breakdown: {
          available:     availableSafe + BUFFER,
          suggestedSave: rec,
          keepAfterSave: d.keepAfterSave,
          bufferAmount:  BUFFER,
        },
        roundUpPrompt: d.roundUpPrompt ?? true,
      };
    }

    case 'goal_off_track': {
      const { shortfall, recommendedContribution, goalName,
              monthlyActual, monthlyTarget } = d;

      const timeNote = ctx.monthPhase !== 'late'
        ? `${ctx.daysLeft} days left to close the gap.`
        : 'A partial contribution still keeps you on track.';

      const progressLine = `You've saved $${fmt(monthlyActual)} of your $${fmt(monthlyTarget)} goal.`;
      const roundUpLine  = d.roundUpMonthly > 0
        ? ` You've also generated $${fmt(d.roundUpMonthly)} in spare change from round-ups.`
        : '';

      return {
        headline: `You're $${fmt(shortfall)} away from "${goalName}"`,
        body:     `${progressLine} You can add $${fmt(recommendedContribution)} from your available balance while keeping your buffer stable.${roundUpLine}\n\n→ ${timeNote}`,
        cta:    `Add $${fmt(recommendedContribution)} to savings`,
        range:  null,
        action: 'catch_up_goal',
        contribution: { recommended: recommendedContribution, shortfall },
      };
    }

    case 'positive_progress': {
      const approx  = roundTo50(d.delta);
      const endNote = ctx.monthPhase === 'late'
        ? 'Strong finish — consider moving the surplus to savings.'
        : `Keep it up for the remaining ${ctx.daysLeft} days.`;
      return {
        headline: `You're $${fmt(approx)} under budget this month`,
        body:     `Spending is tracking below your 3-month average.\n\n→ ${endNote}`,
        cta:      'View Progress',
        range:    null,
        action:   'view_progress',
      };
    }

    default:
      return { headline: '', body: '', cta: '', range: null, action: 'view_progress' };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SCREEN RESOLUTION
// ══════════════════════════════════════════════════════════════════════════════

const SCREEN_PREFERENCES: Record<string, string[]> = {
  home:         ['cash_risk', 'category_spike', 'overspending', 'goal_off_track', 'savings_opportunity', 'positive_progress'],
  transactions: ['category_spike', 'overspending', 'cash_risk'],
  savings:      ['goal_off_track', 'savings_opportunity', 'positive_progress'],
};

function resolveScreens(signals: any[], globalWinner: any, ctx: RenderContext) {
  return {
    home:         resolveScreen('home', signals, globalWinner, ctx),
    transactions: resolveScreen('transactions', signals, globalWinner, ctx),
    savings:      resolveScreen('savings', signals, globalWinner, ctx),
    insights:     prioritizeTop(signals, 3, ctx),
    ai: { activeSignals: signals, topInsight: globalWinner },
  };
}

function resolveScreen(
  screen: string,
  signals: any[],
  globalWinner: any,
  ctx: RenderContext
) {
  for (const preferredType of SCREEN_PREFERENCES[screen]) {
    const match = signals.find((s: any) => s.type === preferredType);
    if (match) {
      return {
        type:       match.type,
        priority:   match.priority,
        autoExpand: shouldAutoExpand(match, match),
        data:       match.data,
        rendered:   renderInsight(match, ctx),
      };
    }
  }
  return null;
}
