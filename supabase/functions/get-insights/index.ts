// supabase/functions/get-insights/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { BUFFER, SAVE_CAP_SMALL, SAVE_CAP_MEDIUM, SAVE_CAP_LARGE, REC_MIN, REC_MAX, isRealExpense } from '../_shared/financialConstants.ts';
import { getCurrentMonthWindow, monthTransactions, monthKey } from '../_shared/dateWindows.ts';
import { getUpcomingCharges } from '../_shared/recurringDetector.ts';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('get-insights');

// Same allow-list pattern as auth-login/check-bank-connection/market-data/
// plaid-get-accounts — preview deployments get a fresh random subdomain
// hash on every push, so a single static origin can't cover them.
const PROD_ORIGIN = Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com';
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  PROD_ORIGIN,
  /^https:\/\/arkonomy-[a-z0-9-]+-shevvik88-dots-projects\.vercel\.app$/,
];

function resolveCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowedOrigin = ALLOWED_ORIGINS.some(o => typeof o === 'string' ? o === origin : o.test(origin))
    ? origin
    : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-firebase-appcheck',
  };
}

Deno.serve(async (req) => {
  const corsHeaders = resolveCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Auth — reject any request without a valid user JWT ────────────────────
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rateLimitResponse = await enforceRateLimit(user.id, 'get-insights');
    if (rateLimitResponse) return rateLimitResponse;

    // userId from body is ignored — always use the authenticated user
    const { lang } = await req.json().catch(() => ({} as { lang?: string }));
    const responseLang: 'ru' | 'es' | 'en' = (lang ?? '').startsWith('ru') ? 'ru' : (lang ?? '').startsWith('es') ? 'es' : 'en';
    const input = await buildFinancialInput(supabase, user.id);
    const result = generateInsights(input, responseLang);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('get-insights error:', err);
    await captureAndFlush(err, { function_name: 'get-insights' });
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
// BUFFER, SAVE_CAP_*, REC_MIN/MAX imported from _shared/financialConstants.ts —
// keep in sync with src/shared/financialConstants.js.

const ROUND_TO = 50;

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


function fmt(n: number): string {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function momLine(current: number, last: number, lang: 'en' | 'ru' | 'es'): string {
  if (!last || last === 0) return '';
  const diff = current - last;
  const pct  = Math.abs(diff) / last;
  if (pct <= 0.05) {
    return lang === 'ru'
      ? `↔ Примерно столько же, сколько в прошлом месяце ($${fmt(last)}).`
      : lang === 'es'
      ? `↔ Aproximadamente lo mismo que el mes pasado ($${fmt(last)}).`
      : `↔ About the same as last month ($${fmt(last)} last month).`;
  }
  if (diff > 0) {
    return lang === 'ru'
      ? `↑ На $${fmt(diff)} больше, чем в прошлом месяце ($${fmt(last)}).`
      : lang === 'es'
      ? `↑ $${fmt(diff)} más que el mes pasado ($${fmt(last)}).`
      : `↑ $${fmt(diff)} more than last month ($${fmt(last)} last month).`;
  }
  return lang === 'ru'
    ? `↓ На $${fmt(Math.abs(diff))} меньше, чем в прошлом месяце — отлично! ($${fmt(last)}).`
    : lang === 'es'
    ? `↓ $${fmt(Math.abs(diff))} menos que el mes pasado — ¡buen trabajo! ($${fmt(last)}).`
    : `↓ $${fmt(Math.abs(diff))} less than last month — great job! ($${fmt(last)} last month).`;
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
    { data: merchantAliases,  error: e5 },
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
    supabase.from('merchant_aliases').select('alias_key, canonical_key, status').eq('user_id', userId),
  ]);

  if (e1) console.error('currentTxns error:', e1);
  if (e2) console.error('historicalTxns error:', e2);
  if (e3) console.error('savingsGoals error:', e3);
  if (e4) console.error('recentIncome error:', e4);
  if (e5) console.error('merchantAliases error:', e5);

  const rawCurrent   = currentTxns      || [];
  const rawHistorical = historicalTxns  || [];
  const recentIncome = recentIncomeTxns || [];

  // getCurrentMonthWindow/monthTransactions from ../_shared/dateWindows —
  // single source of truth for "what counts as the current month" (budget/
  // overspending-signals investigation, Step 3, 2026-08-27), shared with
  // App.jsx/Transactions.jsx (mirrored, Deno can't import from src/). Before
  // this, get-insights had NO fallback at all: on day 1-2 of a new month
  // (real current month genuinely empty, not yet synced) it showed honest
  // zeros for currentMonthSpend/categories while the frontend was already
  // quietly showing last month's numbers as "this month" — same class of
  // cross-screen inconsistency as the Transfer/Transfers exclusion rule this
  // function already fixed in Step 2. rawHistorical already covers the
  // fallback month (query range is `.lt(startOfMonth)`), so no extra query
  // is needed — just re-slice the two already-fetched pools.
  const combinedPool = [...rawHistorical, ...rawCurrent];
  const { monthKey: effectiveMonthKey, prevMonthKey, isFallback } = getCurrentMonthWindow(combinedPool, now);
  const current    = monthTransactions(combinedPool, effectiveMonthKey);
  const historical = combinedPool.filter((t: any) => monthKey(t.date) !== effectiveMonthKey);

  // aliasMap: raw alias_key -> canonical_key, confirmed only — mirrors
  // App.jsx's merchantAliasMap useMemo exactly, so server and client agree
  // on which merchant groups are merged.
  const aliasMap = new Map<string, string>();
  (merchantAliases || []).filter((a: any) => a.status === 'confirmed')
    .forEach((a: any) => aliasMap.set(a.alias_key, a.canonical_key));

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
  // isRealExpense excludes Transfer/Transfers (money movement, not spending)
  // — this function previously excluded nothing at all, the widest gap found
  // in the budget/overspending-signals investigation (2026-08-26): it made
  // "Cut Transfer by $X" a real, live insight (Transfer treated as an
  // ordinary spending category) and inflated currentMonthSpend/availableSafe
  // relative to every other surface. Now matches App.jsx/ai-chat/Insights'
  // budget bar (Step 2, 2026-08-27).
  const currentMonthSpend = current
    .filter(isRealExpense)
    .reduce((sum: number, t: any) => sum + Number(t.amount), 0);

  const historicalExpenses = historical
    .filter(isRealExpense)
    .reduce((sum: number, t: any) => sum + Number(t.amount), 0);

  const historicalMonths = getDistinctMonths(historical);
  const monthsOfHistory  = historicalMonths.size;
  const avg3mSpend       = monthsOfHistory > 0 ? historicalExpenses / monthsOfHistory : 0;

  // allIncome/allExpenses feed ONLY the synthetic currentBalance fallback
  // below (used when there's no real Plaid balance) — deliberately NOT
  // filtered through isRealExpense. A Transfer really did leave the checking
  // account, so it belongs in a balance reconstruction even though it isn't
  // "spending" for budget/overspending purposes. Don't unify this one with
  // the spending totals above — it's a different question (real cash
  // movement vs. spending-against-plan).
  const allIncome = [...historical, ...current]
    .filter((t: any) => t.type === 'income')
    .reduce((sum: number, t: any) => sum + Number(t.amount), 0);
  const allExpenses = [...historical, ...current]
    .filter((t: any) => t.type === 'expense')
    .reduce((sum: number, t: any) => sum + Number(t.amount), 0);

  // ── Real balance ──────────────────────────────────────────────────────────
  // Sum balance_available (fallback balance_current) across all depository
  // (checking+savings) accounts of all Plaid Items for this user — excludes
  // credit (that's debt, not cash).
  //
  // KNOWN LIMITATION (multi-account): available and current have different
  // semantics (available is often null for savings accounts at some banks;
  // current includes pending differently than available). Summing
  // available??current across MULTIPLE accounts can mix the two semantics
  // into one total. Not an issue for a single checking account; revisit when
  // real multi-account aggregation matters (e.g. sum available and current
  // separately and pick a method, rather than mixing per-row).
  const { data: accounts } = await supabase
    .from('plaid_accounts')
    .select('balance_available, balance_current, type')
    .eq('user_id', userId)
    .eq('type', 'depository');

  const hasRealBalance = accounts && accounts.length > 0;
  const realBalance = hasRealBalance
    ? accounts.reduce((sum: number, a: any) => sum + Number(a.balance_available ?? a.balance_current ?? 0), 0)
    : null;

  // Fallback: derived (only for users who haven't had a sync yet since the
  // plaid_accounts migration — table empty for them).
  const currentBalance = realBalance ?? (allIncome - allExpenses);

  // ── Credit card debt / utilization ──────────────────────────────────────
  // Worst single-card utilization, not a blended average across cards — a
  // maxed-out card hurts credit health even if another card is empty, and
  // averaging would hide that. balance_current/balance_available approximate
  // the limit (Plaid's Liabilities product would give the exact limit, but
  // isn't connected — see BACKLOG.md).
  const { data: creditAccounts } = await supabase
    .from('plaid_accounts')
    .select('name, official_name, balance_current, balance_available')
    .eq('user_id', userId)
    .eq('type', 'credit');

  let creditUtilizationPct: number | null = null;
  let totalCreditDebt: number | null = null;
  let worstCreditCardName: string | null = null;
  if (creditAccounts && creditAccounts.length > 0) {
    totalCreditDebt = creditAccounts.reduce((sum: number, a: any) => sum + Number(a.balance_current ?? 0), 0);
    for (const a of creditAccounts) {
      const current = Number(a.balance_current ?? 0);
      const available = Number(a.balance_available ?? 0);
      const total = current + available;
      if (total <= 0) continue;
      const pct = current / total;
      if (creditUtilizationPct === null || pct > creditUtilizationPct) {
        creditUtilizationPct = pct;
        worstCreditCardName = a.name || a.official_name || null;
      }
    }
  }

  const incomeBasedSafe = effectiveMonthlyIncome - currentMonthSpend - BUFFER;
  const availableSafe   = Math.max(0, Math.min(incomeBasedSafe, currentBalance - BUFFER));

  // ── Categories ────────────────────────────────────────────────────────────
  // isRealExpense here (not just t.type === 'expense') means Transfer/
  // Transfers can no longer appear as a category candidate at all — this is
  // what previously let "Cut Transfer by $X" surface as a real category-
  // spike insight (Step 2, 2026-08-27).
  const categoryMap: Record<string, number> = {};
  current.filter(isRealExpense).forEach((t: any) => {
    const cat = t.category_name || 'Other';
    categoryMap[cat] = (categoryMap[cat] || 0) + Number(t.amount);
  });

  const historyCategoryMap: Record<string, number> = {};
  historical.filter(isRealExpense).forEach((t: any) => {
    const cat = t.category_name || 'Other';
    historyCategoryMap[cat] = (historyCategoryMap[cat] || 0) + Number(t.amount);
  });

  // prevMonthKey is the month before the EFFECTIVE current month (from
  // getCurrentMonthWindow above) — shifts back one extra month automatically
  // when isFallback is true, same as App.jsx's twoMonthsAgo comparison.
  const lastMonthCategoryMap: Record<string, number> = {};
  monthTransactions(historical, prevMonthKey)
    .filter(isRealExpense)
    .forEach((t: any) => {
      const cat = t.category_name || 'Other';
      lastMonthCategoryMap[cat] = (lastMonthCategoryMap[cat] || 0) + Number(t.amount);
    });
  const lastMonthTotalSpend = Object.values(lastMonthCategoryMap)
    .reduce((s: number, v: number) => s + v, 0);

  const categories = Array.from(
    new Set([...Object.keys(categoryMap), ...Object.keys(historyCategoryMap)])
  ).map((name) => ({
    name,
    currentMonthSpend: categoryMap[name] || 0,
    avg3mSpend: monthsOfHistory > 0 ? (historyCategoryMap[name] || 0) / monthsOfHistory : 0,
    lastMonthSpend: lastMonthCategoryMap[name] || 0,
  }));

  const goals = (savingsGoals || []).map((g: any) => ({
    id: g.id, name: g.name,
    monthlyTarget: Number(g.target) || 0,
    monthlyActual: Number(g.current) || 0,
  }));

  // A fallback month (isFallback) is already fully over — "3 days left to
  // adjust" would be nonsensical for a closed month, so it's treated as its
  // own last day (daysLeft: 0, monthPhase: 'late' downstream) rather than
  // real today's day-of-month, which belongs to a different, empty month.
  const [effYear, effMonthNum] = effectiveMonthKey.split('-').map(Number);
  const daysInMonth = new Date(effYear, effMonthNum, 0).getDate();
  const dayOfMonth  = isFallback ? daysInMonth : now.getDate();
  const daysLeft    = daysInMonth - dayOfMonth;

  // Real upcoming bills due in the next 7 days — same recurring-charge
  // detector Dashboard.jsx Cash Flow Forecast already uses, so both agree.
  const upcomingBills7d = getUpcomingCharges([...historical, ...current], aliasMap, new Date(), { maxDays: 7 })
    .reduce((sum: number, c: any) => sum + Number(c.amount), 0);

  return {
    currentBalance,
    currentMonthSpend,
    effectiveMonthlyIncome,
    availableSafe,
    avg3mSpend,
    lastMonthTotalSpend,
    upcomingBills7d,
    monthsOfHistory,
    dataFreshnessHours: 0,
    categories,
    goals,
    rawTransactions:        current,
    historicalTransactions: historical,
    dayOfMonth,
    daysLeft,
    isFallback,
    creditUtilizationPct,
    totalCreditDebt,
    worstCreditCardName,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// AI BRAIN
// ══════════════════════════════════════════════════════════════════════════════

function generateInsights(input: any, lang: 'en' | 'ru' | 'es' = 'en') {
  const ctx        = buildRenderContext(input);
  const metrics    = computeMetrics(input, ctx);
  const allSignals = detectSignals(metrics);
  const deduped    = deduplicateSignals(allSignals);
  const { winner } = prioritize(deduped, ctx, lang);
  const screens    = resolveScreens(deduped, winner, ctx, lang);

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
  // True when "current month" is actually last calendar month, shown in
  // place of a real current month that has no transactions yet
  // (getCurrentMonthWindow, Step 3, 2026-08-27) — narrative copy that
  // literally says "this month" needs to say "last month" instead here, or
  // it recreates the exact "different period, same label" issue the
  // budget/overspending-signals investigation started by fixing (Step 1).
  isFallback: boolean;
}

function buildRenderContext(input: any): RenderContext {
  const day  = input.dayOfMonth || new Date().getDate();
  const left = input.daysLeft ?? 10;
  return {
    dayOfMonth: day,
    daysLeft:   left,
    monthPhase: day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late',
    isFallback: !!input.isFallback,
  };
}

function computeMetrics(input: any, ctx: RenderContext) {
  const spendDelta = input.currentMonthSpend - input.avg3mSpend;

  const recommended   = computeRecommendedAmount(input.availableSafe);
  const keepAfterSave = Math.max(0, input.effectiveMonthlyIncome - input.currentMonthSpend - recommended);
  const saveRangeLow  = roundTo50(Math.max(0, recommended * 0.75));
  const saveRangeHigh = recommended;

  return {
    currentBalance:         input.currentBalance,
    currentMonthSpend:      input.currentMonthSpend,
    effectiveMonthlyIncome: input.effectiveMonthlyIncome,
    avg3mSpend:             input.avg3mSpend,
    spendDelta,
    upcomingBills7d:        input.upcomingBills7d,
    availableSafe:          input.availableSafe,
    suggestedSave:          recommended,
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
    lastMonthTotalSpend:    input.lastMonthTotalSpend || 0,
    creditUtilizationPct:   input.creditUtilizationPct,
    totalCreditDebt:        input.totalCreditDebt,
    worstCreditCardName:    input.worstCreditCardName,
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
          lastMonthSpend: cat.lastMonthSpend || 0,
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
  debt_utilization:     68,
  goal_off_track:       65,
  savings_opportunity:  60,
  positive_progress:    40,
};

const WARNING_TYPES = ['cash_risk', 'category_spike', 'overspending', 'debt_utilization', 'goal_off_track'];

function detectSignals(metrics: any) {
  if (metrics.dataIsStale) return [];
  if (!metrics.hasEnoughHistory) {
    return [...detectCashRisk(metrics), ...detectDebtUtilization(metrics), ...detectSavingsOpportunity(metrics)];
  }
  return [
    ...detectCashRisk(metrics),
    ...detectCategorySpike(metrics),
    ...detectOverspending(metrics),
    ...detectDebtUtilization(metrics),
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

// Categories that are inherently recurring — never label as "one-time"
const ALWAYS_RECURRING_CATEGORIES = new Set([
  'housing', 'rent', 'mortgage', 'bills', 'utilities', 'insurance',
  'subscriptions', 'phone', 'internet', 'loan', 'finance',
  'health insurance', 'car payment', 'auto loan', 'auto insurance',
]);

function normalizeMerchant(raw: string): string {
  return (raw || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Returns true if the transaction is a known recurring charge, checked three ways:
//   0. Category shortcut: category_name is in ALWAYS_RECURRING_CATEGORIES
//   1. Category: same category_name appears in 2+ historical months (no spread check needed)
//   2. Description: meaningful token overlap in 2+ historical months, spread ≤ $10
function isKnownRecurringMerchant(description: string, categoryName: string, historical: any[]): boolean {
  // ── 0. Always-recurring category shortcut ───────────────────────────────
  if (categoryName && ALWAYS_RECURRING_CATEGORIES.has(categoryName.toLowerCase())) return true;

  // ── 1. Category-level check ──────────────────────────────────────────────
  if (categoryName) {
    const catLower = categoryName.toLowerCase();
    const catMonths = new Set<string>();
    for (const t of historical) {
      if (t.type !== 'expense') continue;
      if ((t.category_name || '').toLowerCase() === catLower) {
        catMonths.add((t.date || '').slice(0, 7));
      }
    }
    if (catMonths.size >= 2) return true;
  }

  // ── 2. Description token-overlap check ──────────────────────────────────
  const key = normalizeMerchant(description);
  if (!key || key.length < 3) return false;
  // Extract meaningful tokens (4+ chars) to avoid matching "rent" in "current"
  const keyTokens = key.split(' ').filter((tok: string) => tok.length >= 4);
  if (keyTokens.length === 0) return false;

  // Use the largest amount per month to represent the primary charge; avoids
  // inflating spread when multiple sub-transactions match the same token.
  const monthMaxAmount: Record<string, number> = {};
  for (const t of historical) {
    if (t.type !== 'expense') continue;
    const tKey = normalizeMerchant(t.description || '');
    if (!tKey) continue;
    const hasTokenMatch = keyTokens.some((tok: string) => tKey.includes(tok));
    if (!hasTokenMatch) continue;
    const mo = (t.date || '').slice(0, 7);
    const amt = Number(t.amount);
    monthMaxAmount[mo] = Math.max(monthMaxAmount[mo] ?? 0, amt);
  }
  const monthAmounts = Object.values(monthMaxAmount);
  if (monthAmounts.length < 2) return false;
  const spread = Math.max(...monthAmounts) - Math.min(...monthAmounts);
  return spread <= 10;
}

function detectCategorySpike(m: any) {
  if (!m.topCategorySpike) return [];
  const s     = m.topCategorySpike;
  const topTx = m.topCategoryTransaction;

  // A transaction is only "one-time" if it dominates the category spend AND
  // is NOT a known recurring merchant/category.
  const dominatesCategory = topTx && s.currentSpend > 0 &&
    (Number(topTx.amount) / s.currentSpend) >= 0.60;
  const categoryAlwaysRecurring = ALWAYS_RECURRING_CATEGORIES.has((s.name || '').toLowerCase());
  const merchantIsRecurring = categoryAlwaysRecurring || (topTx &&
    isKnownRecurringMerchant(topTx.description || '', topTx.category_name || '', m.historicalTransactions || []));
  const isOneTime = dominatesCategory && !merchantIsRecurring;

  return [{ type: 'category_spike', priority: PRIORITY.category_spike, data: {
    categoryName:  s.name,
    currentSpend:  s.currentSpend,
    avgSpend:      s.avgSpend,
    lastMonthSpend: s.lastMonthSpend || 0,
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
      currentMonthSpend:   m.currentMonthSpend,
      avg3mSpend:          m.avg3mSpend,
      delta:               m.spendDelta,
      lastMonthTotalSpend: m.lastMonthTotalSpend || 0,
    }}];
  }
  return [];
}

function detectDebtUtilization(m: any) {
  if (m.creditUtilizationPct == null || m.creditUtilizationPct < 0.30) return [];
  return [{ type: 'debt_utilization', priority: PRIORITY.debt_utilization, data: {
    utilizationPct: m.creditUtilizationPct,
    totalDebt:      m.totalCreditDebt,
    cardName:       m.worstCreditCardName,
  }}];
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
      reason:              'underspending',
      currentMonthSpend:   m.currentMonthSpend,
      avg3mSpend:          m.avg3mSpend,
      delta:               m.avg3mSpend - m.currentMonthSpend,
      lastMonthTotalSpend: m.lastMonthTotalSpend || 0,
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
  if (signal.type === 'debt_utilization') return true;
  if (signal.type === 'goal_off_track' && signal.priority >= 65) return true;
  if (signal.type === 'savings_opportunity') {
    return (signal.data?.recommendedAmount ?? 0) >= 200;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// PRIORITY & SUPPRESSION
// ══════════════════════════════════════════════════════════════════════════════

function prioritize(signals: any[], ctx: RenderContext, lang: 'en' | 'ru' | 'es' = 'en') {
  if (!signals.length) return { winner: null, suppressedTypes: [] };
  const suppressed = new Set<string>();
  const types      = new Set(signals.map((s: any) => s.type));

  if (types.has('cash_risk') || types.has('debt_utilization')) { suppressed.add('savings_opportunity'); suppressed.add('positive_progress'); }
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
      rendered:   renderInsight(top, ctx, lang),
    },
    suppressedTypes: [...suppressed],
  };
}

function prioritizeTop(signals: any[], n: number, ctx: RenderContext, lang: 'en' | 'ru' | 'es' = 'en') {
  if (!signals.length) return [];
  const suppressed = new Set<string>();
  const types      = new Set(signals.map((s: any) => s.type));

  if (types.has('cash_risk') || types.has('debt_utilization')) { suppressed.add('savings_opportunity'); suppressed.add('positive_progress'); }
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
    rendered:   renderInsight(s, ctx, lang),
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER INSIGHT
// ══════════════════════════════════════════════════════════════════════════════

function renderInsight(signal: any, ctx: RenderContext, lang: 'en' | 'ru' | 'es' = 'en') {
  const d = signal.data;
  const ru = lang === 'ru';
  const es = lang === 'es';

  switch (signal.type) {

    case 'cash_risk': {
      const urgency = ru
        ? (ctx.daysLeft <= 3 ? 'очень скоро' : 'в ближайшие 7 дней')
        : es
        ? (ctx.daysLeft <= 3 ? 'muy pronto' : 'en los próximos 7 días')
        : (ctx.daysLeft <= 3 ? 'very soon' : 'in the next 7 days');
      return ru ? {
        headline: `Вам не хватает $${fmt(d.shortfall)} для предстоящих счетов`,
        body:     `На вашем счёте $${fmt(d.currentBalance)}, но счета на $${fmt(d.upcomingBills7d)} должны быть оплачены ${urgency}. Пополните счёт заранее.`,
        cta:      'Посмотреть счета',
        range:    null, action: 'view_bills',
      } : es ? {
        headline: `Te faltan $${fmt(d.shortfall)} para las próximas facturas`,
        body:     `Tienes $${fmt(d.currentBalance)} disponibles, pero hay facturas por $${fmt(d.upcomingBills7d)} que vencen ${urgency}. Transfiere fondos antes de que venzan.`,
        cta:      'Ver facturas',
        range:    null, action: 'view_bills',
      } : {
        headline: `You're $${fmt(d.shortfall)} short for upcoming bills`,
        body:     `You have $${fmt(d.currentBalance)} available, but $${fmt(d.upcomingBills7d)} in bills due ${urgency}. Move funds before they're due.`,
        cta:      'View Bills',
        range:    null, action: 'view_bills',
      };
    }

    case 'category_spike': {
      const pct          = Math.round(d.pctIncrease * 100);
      const midMonthNote = ctx.monthPhase !== 'late'
        ? (ru ? ` Осталось ${ctx.daysLeft} дней для корректировки.` : es ? ` Quedan ${ctx.daysLeft} días para ajustar.` : ` ${ctx.daysLeft} days left to adjust.`)
        : '';
      if (d.subtype === 'one_time_driver' && d.primaryDriver) {
        // A tiny base (e.g. avgSpend ~$2/mo) turns a real but small delta into
        // a mathematically-correct but meaningless percentage (e.g. 8000%+).
        // Below this floor, state the absolute difference instead of a %.
        const baseTooSmallForPct = d.avgSpend < 15;
        const headline = baseTooSmallForPct
          ? (ru ? `${d.categoryName}: на $${fmt(d.delta)} больше обычного — разовая трата`
             : es ? `${d.categoryName}: $${fmt(d.delta)} más de lo habitual — gasto único`
             : `${d.categoryName}: $${fmt(d.delta)} more than usual — one-time expense`)
          : (ru ? `${d.categoryName} вырос на ${pct}% — разовая трата`
             : es ? `${d.categoryName} subió ${pct}% — gasto único`
             : `${d.categoryName} up ${pct}% — one-time expense`);
        return ru ? {
          headline,
          body:     `Рост вызван ${d.primaryDriver.label} на $${fmt(d.primaryDriver.amount)}. Ваши обычные расходы на ${d.categoryName} значительно ниже.\n\n→ Это разовая трата, не тренд.\n→ Пока ничего менять не нужно, но отслеживайте следующий месяц.`,
          cta:      'Отслеживать расходы',
          range:    null, action: 'reduce_category',
        } : es ? {
          headline,
          body:     `Este aumento fue causado por ${d.primaryDriver.label} de $${fmt(d.primaryDriver.amount)}. Tu gasto habitual en ${d.categoryName} es mucho menor.\n\n→ Es un gasto único, no una tendencia.\n→ No necesitas hacer cambios ahora, pero revisa el próximo mes.`,
          cta:      'Monitorear gastos',
          range:    null, action: 'reduce_category',
        } : {
          headline,
          body:     `This increase was caused by a $${fmt(d.primaryDriver.amount)} ${d.primaryDriver.label}. Your usual ${d.categoryName} spending is much lower.\n\n→ This is a one-time expense, not a trend.\n→ No changes needed now, but monitor next month to confirm stability.`,
          cta:      'Monitor Spending',
          range:    null, action: 'reduce_category',
        };
      }
      const momNote = d.lastMonthSpend ? '\n' + momLine(d.currentSpend, d.lastMonthSpend, lang) : '';
      return ru ? {
        headline: `Сократите ${d.categoryName} на ~$${fmt(d.delta)} для возврата в норму`,
        body:     `Вы потратили $${fmt(d.currentSpend)} на ${d.categoryName} — на $${fmt(d.delta)} выше обычных $${fmt(d.avgSpend)}/мес.${midMonthNote}${momNote}\n\n→ Это повторяющийся паттерн. Сокращение сейчас поможет в следующем месяце.`,
        cta:      'Просмотреть категорию',
        range:    null, action: 'reduce_category',
      } : es ? {
        headline: `Reduce ${d.categoryName} ~$${fmt(d.delta)} para retomar el rumbo`,
        body:     `Has gastado $${fmt(d.currentSpend)} en ${d.categoryName} — $${fmt(d.delta)} más de tu promedio de $${fmt(d.avgSpend)}/mes.${midMonthNote}${momNote}\n\n→ Es un patrón recurrente. Reducir ahora te ayuda a estar en camino el próximo mes.`,
        cta:      'Revisar categoría',
        range:    null, action: 'reduce_category',
      } : {
        headline: `Cut ${d.categoryName} by ~$${fmt(d.delta)} to get back on track`,
        body:     `You've spent $${fmt(d.currentSpend)} on ${d.categoryName} — $${fmt(d.delta)} above your usual $${fmt(d.avgSpend)}/month.${midMonthNote}${momNote}\n\n→ This is a recurring pattern. Reducing now keeps you on track for next month.`,
        cta:      'Review Category',
        range:    null, action: 'reduce_category',
      };
    }

    case 'overspending': {
      const timeNote = ru
        ? (ctx.monthPhase === 'early' ? 'Ещё начало месяца — есть время скорректировать.' : ctx.monthPhase === 'mid' ? `Осталось ${ctx.daysLeft} дней, чтобы снизить.` : 'Стоит разобраться, что привело к перерасходу.')
        : es
        ? (ctx.monthPhase === 'early' ? 'Es temprano — aún hay tiempo para corregir el rumbo.' : ctx.monthPhase === 'mid' ? `Quedan ${ctx.daysLeft} días para reducirlo.` : 'Vale la pena revisar qué generó el gasto extra.')
        : (ctx.monthPhase === 'early' ? "It's early — there's still time to course-correct." : ctx.monthPhase === 'mid' ? `${ctx.daysLeft} days left to bring it down.` : 'Worth reviewing what drove the extra spend.');
      const momNoteOver = d.lastMonthTotalSpend ? '\n' + momLine(d.currentMonthSpend, d.lastMonthTotalSpend, lang) : '';
      // "This month" would mislabel a fallback month (real current month
      // still empty, showing last month's already-closed numbers instead —
      // getCurrentMonthWindow, Step 3) as if it were in progress. Same
      // honesty fix as Step 1's financial-diagnosis TIME WINDOW HONESTY.
      const periodWord = ctx.isFallback
        ? (ru ? 'в прошлом месяце' : es ? 'el mes pasado' : 'last month')
        : (ru ? 'в этом месяце' : es ? 'este mes' : 'this month');
      return ru ? {
        headline: `Расходы на $${fmt(d.delta)} выше обычного темпа`,
        body:     `$${fmt(d.currentMonthSpend)} ${periodWord} против среднего $${fmt(d.avg3mSpend)}.${momNoteOver}\n\n→ ${timeNote}`,
        cta:      'Просмотреть расходы',
        range:    null, action: 'review_spending',
      } : es ? {
        headline: `El gasto está $${fmt(d.delta)} sobre tu ritmo habitual`,
        body:     `$${fmt(d.currentMonthSpend)} ${periodWord} vs tu promedio de $${fmt(d.avg3mSpend)}.${momNoteOver}\n\n→ ${timeNote}`,
        cta:      'Revisar gastos',
        range:    null, action: 'review_spending',
      } : {
        headline: `Spending is $${fmt(d.delta)} above your usual pace`,
        body:     `$${fmt(d.currentMonthSpend)} ${periodWord} vs your $${fmt(d.avg3mSpend)} average.${momNoteOver}\n\n→ ${timeNote}`,
        cta:      'Review Spending',
        range:    null, action: 'review_spending',
      };
    }

    case 'debt_utilization': {
      const pct = Math.round(d.utilizationPct * 100);
      const card = d.cardName || (ru ? 'Ваша карта' : es ? 'Tu tarjeta' : 'Your card');
      const severe = d.utilizationPct >= 0.70;
      const severityNote = ru
        ? (severe ? ' Такой уровень использования лимита особенно сильно влияет на кредитный рейтинг.' : '')
        : es
        ? (severe ? ' Este nivel de uso afecta especialmente tu puntaje crediticio.' : '')
        : (severe ? ' That level of utilization hits your credit score especially hard.' : '');
      return ru ? {
        headline: `${card} использована на ${pct}% лимита`,
        body:     `У вас $${fmt(d.totalDebt)} долга по кредитным картам.${severityNote} Высокая загрузка лимита обычно обходится дороже в процентах, чем приносят любые накопления.\n\n→ Сейчас погашение долга — более выгодное решение, чем откладывать в сбережения.`,
        cta:      'Посмотреть кредитные карты',
        range:    null, action: 'view_debt',
      } : es ? {
        headline: `${card} está al ${pct}% de su límite`,
        body:     `Tienes $${fmt(d.totalDebt)} en deuda de tarjetas de crédito.${severityNote} Un uso alto del límite suele costar más en intereses de lo que rendiría cualquier ahorro.\n\n→ Pagar esta deuda ahora es mejor uso del dinero extra que ahorrarlo.`,
        cta:      'Ver tarjetas de crédito',
        range:    null, action: 'view_debt',
      } : {
        headline: `${card} is at ${pct}% of its limit`,
        body:     `You're carrying $${fmt(d.totalDebt)} in credit card debt.${severityNote} High utilization usually costs more in interest than any savings goal earns.\n\n→ Paying this down is a better use of extra cash than saving right now.`,
        cta:      'Review Credit Cards',
        range:    null, action: 'view_debt',
      };
    }

    case 'savings_opportunity': {
      const rec = d.recommendedAmount ?? computeRecommendedAmount(d.availableSafe);
      const recHigh = Math.min(rec + 100, Math.round(d.availableSafe));
      const { saveRangeLow, saveRangeHigh, availableSafe } = d;

      const timeNote = ru
        ? (ctx.monthPhase === 'late' ? 'Месяц заканчивается — хороший момент зафиксировать накопления.' : ctx.monthPhase === 'mid' ? `Ещё ${ctx.daysLeft} дней — это сохранит комфортный буфер.` : 'Начало месяца, поэтому это консервативная стартовая сумма.')
        : es
        ? (ctx.monthPhase === 'late' ? 'El mes está terminando — un buen momento para asegurar los ahorros.' : ctx.monthPhase === 'mid' ? `Aún quedan ${ctx.daysLeft} días — esto mantiene un margen cómodo.` : 'Es temprano en el mes, así que este es un monto inicial conservador.')
        : (ctx.monthPhase === 'late' ? 'The month is wrapping up — a good time to lock in savings.' : ctx.monthPhase === 'mid' ? `Still ${ctx.daysLeft} days left — this keeps a comfortable buffer.` : `It's early in the month, so this is a conservative starting amount.`);

      const spareChangeLine = d.roundUpMonthly > 0
        ? (ru ? ` У вас также есть $${fmt(d.roundUpMonthly)} сдачи от округления для инвестирования.` : es ? ` También tienes $${fmt(d.roundUpMonthly)} en cambio de redondeos que puedes invertir.` : ` You also have $${fmt(d.roundUpMonthly)} in spare change from round-ups you can invest.`)
        : '';

      return ru ? {
        headline: `Вы можете отложить $${fmt(rec)}–$${fmt(recHigh)} в накопления`,
        body:     `Расходы под контролем. Безопасный взнос — $${fmt(rec)}–$${fmt(recHigh)} для сохранения буфера.${spareChangeLine}\n\n→ ${timeNote}`,
        cta:      `Добавить $${fmt(rec)}–$${fmt(recHigh)} безопасно`,
        range:    `Безопасный диапазон: $${fmt(saveRangeLow)} – $${fmt(saveRangeHigh)}`,
        action:   'move_to_savings',
        breakdown: { available: availableSafe + BUFFER, suggestedSave: rec, keepAfterSave: d.keepAfterSave, bufferAmount: BUFFER },
        roundUpPrompt: d.roundUpPrompt ?? true,
      } : es ? {
        headline: `Puedes mover $${fmt(rec)}–$${fmt(recHigh)} a ahorros`,
        body:     `Tus gastos están bajo control. Una contribución segura es $${fmt(rec)}–$${fmt(recHigh)} para mantener tu colchón estable.${spareChangeLine}\n\n→ ${timeNote}`,
        cta:      `Agregar $${fmt(rec)}–$${fmt(recHigh)} de forma segura`,
        range:    `Rango seguro: $${fmt(saveRangeLow)} – $${fmt(saveRangeHigh)}`,
        action:   'move_to_savings',
        breakdown: { available: availableSafe + BUFFER, suggestedSave: rec, keepAfterSave: d.keepAfterSave, bufferAmount: BUFFER },
        roundUpPrompt: d.roundUpPrompt ?? true,
      } : {
        headline: `You can move $${fmt(rec)}–$${fmt(recHigh)} to savings`,
        body:     `Your spending is under control. A safer contribution is $${fmt(rec)}–$${fmt(recHigh)} to keep your buffer stable.${spareChangeLine}\n\n→ ${timeNote}`,
        cta:      `Add $${fmt(rec)}–$${fmt(recHigh)} safely`,
        range:    `Safe range: $${fmt(saveRangeLow)} – $${fmt(saveRangeHigh)}`,
        action:   'move_to_savings',
        breakdown: { available: availableSafe + BUFFER, suggestedSave: rec, keepAfterSave: d.keepAfterSave, bufferAmount: BUFFER },
        roundUpPrompt: d.roundUpPrompt ?? true,
      };
    }

    case 'goal_off_track': {
      const { shortfall, recommendedContribution, goalName, monthlyActual, monthlyTarget } = d;

      const timeNote = ctx.monthPhase !== 'late'
        ? (ru ? `Осталось ${ctx.daysLeft} дней, чтобы закрыть разрыв.` : es ? `Quedan ${ctx.daysLeft} días para cerrar la brecha.` : `${ctx.daysLeft} days left to close the gap.`)
        : (ru ? 'Частичный взнос всё равно поможет не отстать.' : es ? 'Una contribución parcial igual te mantiene en camino.' : 'A partial contribution still keeps you on track.');

      const progressLine = ru
        ? `Вы накопили $${fmt(monthlyActual)} из цели $${fmt(monthlyTarget)}.`
        : es
        ? `Has ahorrado $${fmt(monthlyActual)} de tu meta de $${fmt(monthlyTarget)}.`
        : `You've saved $${fmt(monthlyActual)} of your $${fmt(monthlyTarget)} goal.`;

      const roundUpLine = d.roundUpMonthly > 0
        ? (ru ? ` Также у вас есть $${fmt(d.roundUpMonthly)} сдачи от округления.` : es ? ` También tienes $${fmt(d.roundUpMonthly)} en cambio de redondeos.` : ` You've also generated $${fmt(d.roundUpMonthly)} in spare change from round-ups.`)
        : '';

      return ru ? {
        headline: `Вам не хватает $${fmt(shortfall)} до цели «${goalName}»`,
        body:     `${progressLine} Вы можете добавить $${fmt(recommendedContribution)} из доступного баланса, сохраняя буфер.${roundUpLine}\n\n→ ${timeNote}`,
        cta:      `Добавить $${fmt(recommendedContribution)} в накопления`,
        range:    null, action: 'catch_up_goal',
        contribution: { recommended: recommendedContribution, shortfall },
      } : es ? {
        headline: `Te faltan $${fmt(shortfall)} para «${goalName}»`,
        body:     `${progressLine} Puedes agregar $${fmt(recommendedContribution)} de tu saldo disponible manteniendo tu colchón estable.${roundUpLine}\n\n→ ${timeNote}`,
        cta:      `Agregar $${fmt(recommendedContribution)} a ahorros`,
        range:    null, action: 'catch_up_goal',
        contribution: { recommended: recommendedContribution, shortfall },
      } : {
        headline: `You're $${fmt(shortfall)} away from ${goalName}`,
        body:     `${progressLine} You can add $${fmt(recommendedContribution)} from your available balance while keeping your buffer stable.${roundUpLine}\n\n→ ${timeNote}`,
        cta:      `Add $${fmt(recommendedContribution)} to savings`,
        range:    null, action: 'catch_up_goal',
        contribution: { recommended: recommendedContribution, shortfall },
      };
    }

    case 'positive_progress': {
      const approx  = roundTo50(d.delta);
      const endNote = ctx.monthPhase === 'late'
        ? (ru ? 'Отличный финиш — рассмотрите перевод излишков в накопления.' : es ? 'Excelente cierre — considera mover el excedente a ahorros.' : 'Strong finish — consider moving the surplus to savings.')
        : (ru ? `Продолжайте в том же духе ещё ${ctx.daysLeft} дней.` : es ? `¡Sigue así los ${ctx.daysLeft} días restantes!` : `Keep it up for the remaining ${ctx.daysLeft} days.`);
      const momNotePos = (d.lastMonthTotalSpend && d.currentMonthSpend < d.lastMonthTotalSpend)
        ? '\n' + momLine(d.currentMonthSpend, d.lastMonthTotalSpend, lang) : '';
      return ru ? {
        headline: `Вы укладываетесь в бюджет на $${fmt(approx)}`,
        body:     `Расходы ниже среднего за 3 месяца.${momNotePos}\n\n→ ${endNote}`,
        cta:      'Посмотреть прогресс',
        range:    null, action: 'view_progress',
      } : es ? {
        headline: `Estás $${fmt(approx)} por debajo del presupuesto`,
        body:     `El gasto está por debajo de tu promedio de 3 meses.${momNotePos}\n\n→ ${endNote}`,
        cta:      'Ver progreso',
        range:    null, action: 'view_progress',
      } : {
        headline: `You're $${fmt(approx)} under budget ${ctx.isFallback ? 'last month' : 'this month'}`,
        body:     `Spending is tracking below your 3-month average.${momNotePos}\n\n→ ${endNote}`,
        cta:      'View Progress',
        range:    null, action: 'view_progress',
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
  home:         ['cash_risk', 'debt_utilization', 'category_spike', 'overspending', 'goal_off_track', 'savings_opportunity', 'positive_progress'],
  transactions: ['category_spike', 'overspending', 'cash_risk'],
  savings:      ['goal_off_track', 'savings_opportunity', 'positive_progress'],
};

function resolveScreens(signals: any[], globalWinner: any, ctx: RenderContext, lang: 'en' | 'ru' | 'es' = 'en') {
  return {
    home:         resolveScreen('home', signals, globalWinner, ctx, lang),
    transactions: resolveScreen('transactions', signals, globalWinner, ctx, lang),
    savings:      resolveScreen('savings', signals, globalWinner, ctx, lang),
    insights:     prioritizeTop(signals, 3, ctx, lang),
    ai: {
      activeSignals: signals,
      topInsight:    globalWinner,
      isWarning:     signals.some((s: any) => WARNING_TYPES.includes(s.type)),
      isPositive:    signals.length > 0 && signals.every((s: any) => !WARNING_TYPES.includes(s.type)),
    },
  };
}

function resolveScreen(
  screen: string,
  signals: any[],
  globalWinner: any,
  ctx: RenderContext,
  lang: 'en' | 'ru' | 'es' = 'en'
) {
  for (const preferredType of SCREEN_PREFERENCES[screen]) {
    const match = signals.find((s: any) => s.type === preferredType);
    if (match) {
      return {
        type:       match.type,
        priority:   match.priority,
        autoExpand: shouldAutoExpand(match, match),
        data:       match.data,
        rendered:   renderInsight(match, ctx, lang),
      };
    }
  }
  return null;
}
