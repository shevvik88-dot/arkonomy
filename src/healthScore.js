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
  const saved       = Math.max(totalIncome - totalSpent, 0);
  const savingsRate = totalIncome > 0 ? saved / totalIncome : 0;
  // Full 30 pts at ≥ 20% savings rate, linear below that, floor at 5 pts
  const savingsPoints = Math.max(5, Math.min(30, Math.round((savingsRate / 0.20) * 30)));

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
 * Returns a single-line insight comment based on the score breakdown.
 */
export function generateHealthComment({ score, breakdown, spendingByCategory, prevSpendingByCategory }) {
  // Find biggest category increase vs last month
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

  if (breakdown.trend.thisBalance < 0) {
    return "You're spending more than you earn — focus on reducing expenses first.";
  }
  if (breakdown.savings.rate < 0.05) {
    return "Saving less than 5% of income — try cutting discretionary spend.";
  }
  if (breakdown.budget.points < 8) {
    return "Spending is over budget — review your largest expense categories.";
  }
  if (topCat && topPct > 20) {
    return `${topCat} expenses increased ${Math.round(topPct)}% vs last month.`;
  }
  if (trendDrop) {
    return "Balance is shrinking month over month — watch your spending pace.";
  }
  if (breakdown.recurring.ratio > 0.25) {
    return "Recurring charges are above 25% of income — review subscriptions.";
  }
  if (score >= 81) {
    return "Great financial discipline — savings and budget are on track.";
  }
  if (score >= 61) {
    return "Solid score — small savings increases could push you into green.";
  }
  if (score >= 31) {
    return "Making progress — focus on saving a bit more each month.";
  }
  return "Just getting started — small consistent steps add up fast.";
}

/**
 * Returns a label for the score range.
 */
export function getScoreLabel(score) {
  if (score >= 81) return "Excellent";
  if (score >= 61) return "Doing well";
  if (score >= 31) return "Making progress";
  return "Getting started";
}
