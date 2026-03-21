// ─── signals.ts ────────────────────────────────────────────────────────────
// Evaluates all 6 signal rules against computed Metrics.
// Returns an array of triggered signals (unfiltered, unsuppressed).
// All thresholds and priorities defined here — single place to adjust.

import type { Metrics, Signal } from "./types";

// Priority constants — adjust here only
const PRIORITY = {
  cash_risk: 100,
  category_spike: 75,
  overspending: 70,
  goal_off_track: 65,
  savings_opportunity: 60,
  positive_progress: 40,
} as const;

export function detectSignals(metrics: Metrics): Signal[] {
  // Hard guards — return nothing if data is unusable
  if (metrics.dataIsStale) return [];
  if (!metrics.hasEnoughHistory) {
    // Only allow signals that don't require historical comparison
    return [
      ...detectCashRisk(metrics),
      ...detectSavingsOpportunity(metrics),
    ];
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

// ── 1. Cash Risk ─────────────────────────────────────────────────────────────
// balance < upcoming_bills_7d + 100
function detectCashRisk(metrics: Metrics): Signal[] {
  const buffer = 100;
  if (metrics.currentBalance < metrics.upcomingBills7d + buffer) {
    const shortfall =
      metrics.upcomingBills7d + buffer - metrics.currentBalance;
    return [
      {
        type: "cash_risk",
        priority: PRIORITY.cash_risk,
        data: {
          currentBalance: metrics.currentBalance,
          upcomingBills7d: metrics.upcomingBills7d,
          shortfall,
        },
      },
    ];
  }
  return [];
}

// ── 2. Category Spike ────────────────────────────────────────────────────────
// Handled in metrics.ts (topCategorySpike). Here we just emit the signal.
function detectCategorySpike(metrics: Metrics): Signal[] {
  if (!metrics.topCategorySpike) return [];
  const s = metrics.topCategorySpike;
  return [
    {
      type: "category_spike",
      priority: PRIORITY.category_spike,
      data: {
        categoryName: s.name,
        currentSpend: s.currentSpend,
        avgSpend: s.avgSpend,
        delta: s.delta,
        pctIncrease: s.pctIncrease,
      },
    },
  ];
}

// ── 3. Overspending ───────────────────────────────────────────────────────────
// currentMonthSpend > avg3mSpend * 1.10 AND delta >= 100
function detectOverspending(metrics: Metrics): Signal[] {
  const threshold = metrics.avg3mSpend * 1.1;
  const delta = metrics.spendDelta;

  if (metrics.currentMonthSpend > threshold && delta >= 100) {
    return [
      {
        type: "overspending",
        priority: PRIORITY.overspending,
        data: {
          currentMonthSpend: metrics.currentMonthSpend,
          avg3mSpend: metrics.avg3mSpend,
          delta,
        },
      },
    ];
  }
  return [];
}

// ── 4. Savings Opportunity ───────────────────────────────────────────────────
// Only if NO cash_risk. safeSurplus >= 75.
// Detected here but suppression is enforced in prioritize.ts.
function detectSavingsOpportunity(metrics: Metrics): Signal[] {
  if (metrics.safeSurplus >= 75) {
    const suggestedTransfer = Math.floor(metrics.safeSurplus * 0.5);
    return [
      {
        type: "savings_opportunity",
        priority: PRIORITY.savings_opportunity,
        data: {
          safeSurplus: metrics.safeSurplus,
          suggestedTransfer,
        },
      },
    ];
  }
  return [];
}

// ── 5. Goal Off Track ────────────────────────────────────────────────────────
// monthlyActual < monthlyTarget * 0.80
function detectGoalOffTrack(metrics: Metrics): Signal[] {
  if (!metrics.offTrackGoal) return [];
  const g = metrics.offTrackGoal;
  return [
    {
      type: "goal_off_track",
      priority: PRIORITY.goal_off_track,
      data: {
        goalId: g.id,
        goalName: g.name,
        monthlyTarget: g.monthlyTarget,
        monthlyActual: g.monthlyActual,
        shortfall: g.shortfall,
      },
    },
  ];
}

// ── 6. Positive Progress ─────────────────────────────────────────────────────
// Only if no warning/risk signals exist.
// Triggered if: spend 100 below avg OR savings goal met.
// Suppression enforced in prioritize.ts; here we just detect.
function detectPositiveProgress(metrics: Metrics): Signal[] {
  const underspending =
    metrics.avg3mSpend - metrics.currentMonthSpend >= 100;

  // Check if any goal is met or exceeded
  // We'd need goals in metrics for full check, but metrics exposes offTrackGoal.
  // For V1: use underspending as the main trigger.
  if (underspending) {
    return [
      {
        type: "positive_progress",
        priority: PRIORITY.positive_progress,
        data: {
          reason: "underspending",
          currentMonthSpend: metrics.currentMonthSpend,
          avg3mSpend: metrics.avg3mSpend,
          delta: metrics.avg3mSpend - metrics.currentMonthSpend,
        },
      },
    ];
  }

  return [];
}

