// src/healthScore.js
// Financial Health Score: 0–100
// Savings rate:          max 30 pts  (min  5 pts)
// Budget adherence:      max 25 pts  (min  5 pts)
// Recurring charges:     max 20 pts
// Balance trend:         max 25 pts

/**
 * @param {object} params
 * @param {number} params.totalIncome     — this month's income
 * @param {number} params.totalSpent      — this month's expenses
 * @param {number} params.lastIncome      — last month's income
 * @param {number} params.lastSpent       — last month's expenses
 * @param {number} params.budget          — monthly budget target
 * @param {number} params.subscriptionSpend — detected recurring / subscription spend
 */
export function calculateHealthScore({
  totalIncome,
  totalSpent,
  lastIncome,
  lastSpent,
  budget,
  subscriptionSpend,
}) {
  // ── 1. Savings rate (30 pts, minimum 5) ────────────────────────────────────
  // rate: signed, for display (can be negative — spending more than income).
  // rateForPoints: floored at 0, only used for the points formula so score
  // never drops below the 5pt floor.
  const savingsRate       = totalIncome > 0 ? (totalIncome - totalSpent) / totalIncome : 0;
  const savingsRateForPts = Math.max(savingsRate, 0);
  // Full 30 pts at ≥ 20% savings rate, linear below that, floor at 5 pts
  const savingsPoints = Math.max(5, Math.min(30, Math.round((savingsRateForPts / 0.20) * 30)));

  // ── 2. Budget adherence (25 pts, minimum 5) ─────────────────────────────────
  let budgetPoints = 12; // neutral when no budget set
  if (budget > 0) {
    const ratio = totalSpent / budget;
    if (ratio <= 0.80) {
      budgetPoints = 25;
    } else if (ratio <= 1.00) {
      // Interpolate: 80% → 25 pts, 100% → 12 pts
      budgetPoints = Math.round(12 + ((1 - ratio) / 0.20) * 13);
    } else {
      // Over budget — penalise proportionally, floor at 5
      // 100% over = ~8 pts, 200% over = 5 pts minimum
      budgetPoints = Math.max(5, Math.round((1 - Math.min((ratio - 1) / 1.0, 1)) * 12));
    }
  }

  // ── 3. Recurring charges ratio (20 pts) ────────────────────────────────────
  const recurringRatio = totalIncome > 0 ? subscriptionSpend / totalIncome : 0;
  // < 10% of income → full 20 pts, ≥ 40% → 0 pts (linear between)
  const recurringPoints = Math.max(
    0,
    Math.min(20, Math.round((1 - Math.max(0, recurringRatio - 0.10) / 0.30) * 20))
  );

  // ── 4. Balance trend (25 pts) ───────────────────────────────────────────────
  const thisBalance = totalIncome - totalSpent;
  const lastBalance = lastIncome - lastSpent;
  let trendPoints   = 12; // neutral when no history
  if (lastBalance !== 0 || lastIncome > 0) {
    const delta = thisBalance - lastBalance;
    if (delta >= 0) {
      trendPoints = 25;
    } else {
      // How severe is the drop?
      const dropRatio = Math.abs(delta) / Math.max(Math.abs(lastBalance), 100);
      trendPoints     = Math.max(0, Math.round((1 - Math.min(dropRatio, 1)) * 25));
    }
  }

  // Minimum total score of 20 — nobody starts at rock bottom
  const score = Math.min(100, Math.max(20,
    savingsPoints + budgetPoints + recurringPoints + trendPoints
  ));

  const color = score <= 40 ? '#FF5C7A' : score <= 70 ? '#FFB800' : '#12D18E';

  const breakdown = {
    savings:   { points: savingsPoints,   max: 30, rate: savingsRate },
    budget:    { points: budgetPoints,    max: 25 },
    recurring: { points: recurringPoints, max: 20, ratio: recurringRatio },
    trend:     { points: trendPoints,     max: 25, thisBalance, lastBalance },
  };

  return { score, color, breakdown };
}

/**
 * Returns a { key, rawCat?, params } object for i18n. Callers must call t(key, params).
 * If rawCat is present, callers should resolve it via tCat() and merge into params as {cat}.
 */
export function generateHealthComment({ score, breakdown, spendingByCategory, prevSpendingByCategory }) {
  let topCat = null;
  let topPct  = 0;
  for (const [cat, amt] of Object.entries(spendingByCategory || {})) {
    const prev = (prevSpendingByCategory || {})[cat] || 0;
    if (prev > 50 && amt > prev) {
      const pct = ((amt - prev) / prev) * 100;
      if (pct > topPct) { topPct = pct; topCat = cat; }
    }
  }

  const trendDrop = breakdown.trend.thisBalance < breakdown.trend.lastBalance;

  if (breakdown.trend.thisBalance < 0) return { key: "health.comment_overspend" };
  if (breakdown.savings.rate < 0.05)   return { key: "health.comment_low_savings" };
  if (breakdown.budget.points < 8)     return { key: "health.comment_over_budget" };
  if (topCat && topPct > 20)           return { key: "health.comment_cat_spike", rawCat: topCat, params: { pct: Math.round(topPct) } };
  if (trendDrop)                       return { key: "health.comment_shrinking" };
  if (breakdown.recurring.ratio > 0.25) return { key: "health.comment_high_recurring" };
  if (score >= 81)  return { key: "health.comment_great" };
  if (score >= 61)  return { key: "health.comment_solid" };
  if (score >= 31)  return { key: "health.comment_making_progress" };
  return { key: "health.comment_getting_started" };
}

/**
 * Returns an i18n key for the score range. Callers must wrap with t().
 */
export function getScoreLabel(score) {
  // Below 31 used to always read "Getting started" regardless of exact
  // value — but hasData already gates the true "no data yet" case into a
  // completely separate render branch upstream (HealthScoreBar's own
  // !hasData early return), so by the time this function is ever called
  // the user already has real income/spending history. A score in this
  // bucket (floor is 20, see calculateHealthScore) is an established-but-
  // poor score, not a new account — "Getting started" undersold how bad a
  // near-floor score actually is. Dashboard redesign, 2026-08-28.
  if (score >= 81) return "health.label_excellent";
  if (score >= 61) return "health.label_doing_well";
  if (score >= 31) return "health.label_making_progress";
  return "health.label_needs_attention";
}
