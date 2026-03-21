// ─── metrics.ts ────────────────────────────────────────────────────────────
// Transforms raw FinancialInput into computed Metrics.
// Pure functions — no side effects, easy to unit test.

import type {
  FinancialInput,
  Metrics,
  CategorySpike,
  OffTrackGoal,
} from "./types";

const STALE_THRESHOLD_HOURS = 6;

export function computeMetrics(input: FinancialInput): Metrics {
  const spendDelta = input.currentMonthSpend - input.avg3mSpend;

  // balance - upcoming bills - 200 buffer
  const safeSurplus =
    input.currentBalance - input.upcomingBills7d - 200;

  return {
    currentBalance: input.currentBalance,
    currentMonthSpend: input.currentMonthSpend,
    avg3mSpend: input.avg3mSpend,
    spendDelta,
    upcomingBills7d: input.upcomingBills7d,
    safeSurplus,
    topCategorySpike: findTopCategorySpike(input),
    offTrackGoal: findOffTrackGoal(input),
    hasEnoughHistory: input.monthsOfHistory >= 2,
    dataIsStale: input.dataFreshnessHours > STALE_THRESHOLD_HOURS,
  };
}

// Returns the single most severe category spike (highest absolute delta)
function findTopCategorySpike(input: FinancialInput): CategorySpike | null {
  let top: CategorySpike | null = null;

  for (const cat of input.categories) {
    if (cat.avg3mSpend === 0) continue; // avoid division by zero

    const delta = cat.currentMonthSpend - cat.avg3mSpend;
    const pctIncrease = delta / cat.avg3mSpend;

    // Rule: >25% AND delta >= 75
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

// Returns the most off-track goal (highest shortfall)
function findOffTrackGoal(input: FinancialInput): OffTrackGoal | null {
  let worst: OffTrackGoal | null = null;

  for (const goal of input.goals) {
    if (goal.monthlyTarget === 0) continue;

    // Rule: actual < 80% of target
    if (goal.monthlyActual < goal.monthlyTarget * 0.8) {
      const shortfall = goal.monthlyTarget - goal.monthlyActual;
      if (!worst || shortfall > worst.shortfall) {
        worst = {
          id: goal.id,
          name: goal.name,
          monthlyTarget: goal.monthlyTarget,
          monthlyActual: goal.monthlyActual,
          shortfall,
        };
      }
    }
  }

  return worst;
}

