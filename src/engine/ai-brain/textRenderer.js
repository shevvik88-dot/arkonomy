// ─── textRenderer.ts ───────────────────────────────────────────────────────
// Converts a structured Signal into headline + body + CTA.
//
// RULES:
// - AI does NOT decide what happened. Rules decide. AI only phrases it.
// - All numbers come from signal.data — never invented.
// - No generic advice. No shame tone. No hallucinated values.
// - For V1: templates are hardcoded. In V2 you can swap to LLM call.
//
// V2 upgrade path: replace each template function with an LLM call
// that receives the structured data as input. The contract stays the same.

import type {
  Signal,
  RenderedInsight,
  ActionType,
  CashRiskData,
  CategorySpikeData,
  OverspendingData,
  SavingsOpportunityData,
  GoalOffTrackData,
  PositiveProgressData,
} from "./types";

export function renderInsight(signal: Signal): RenderedInsight {
  switch (signal.type) {
    case "cash_risk":
      return renderCashRisk(signal.data as CashRiskData);
    case "category_spike":
      return renderCategorySpike(signal.data as CategorySpikeData);
    case "overspending":
      return renderOverspending(signal.data as OverspendingData);
    case "savings_opportunity":
      return renderSavingsOpportunity(signal.data as SavingsOpportunityData);
    case "goal_off_track":
      return renderGoalOffTrack(signal.data as GoalOffTrackData);
    case "positive_progress":
      return renderPositiveProgress(signal.data as PositiveProgressData);
  }
}

// ── Action map ───────────────────────────────────────────────────────────────
// Single place to change CTA labels and actions.
const ACTION_MAP: Record<Signal["type"], ActionType> = {
  cash_risk: "view_bills",
  overspending: "review_spending",
  category_spike: "reduce_category",
  savings_opportunity: "move_to_savings",
  goal_off_track: "catch_up_goal",
  positive_progress: "view_progress",
};

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderCashRisk(d: CashRiskData): RenderedInsight {
  return {
    headline: "Low balance alert",
    body: `You have $${fmt(d.currentBalance)} available, but $${fmt(
      d.upcomingBills7d
    )} in bills due in the next 7 days. You're $${fmt(
      d.shortfall
    )} short of a safe buffer.`,
    cta: "View Bills",
    action: ACTION_MAP.cash_risk,
  };
}

function renderCategorySpike(d: CategorySpikeData): RenderedInsight {
  const pct = Math.round(d.pctIncrease * 100);
  return {
    headline: `${d.categoryName} spending up ${pct}%`,
    body: `You spent $${fmt(d.currentSpend)} on ${
      d.categoryName
    } this month — $${fmt(d.delta)} more than your 3-month average of $${fmt(
      d.avgSpend
    )}.`,
    cta: `Reduce ${d.categoryName}`,
    action: ACTION_MAP.category_spike,
  };
}

function renderOverspending(d: OverspendingData): RenderedInsight {
  return {
    headline: "Spending above normal",
    body: `Total spending this month is $${fmt(
      d.currentMonthSpend
    )}, which is $${fmt(
      d.delta
    )} above your 3-month average of $${fmt(d.avg3mSpend)}.`,
    cta: "Review Spending",
    action: ACTION_MAP.overspending,
  };
}

function renderSavingsOpportunity(d: SavingsOpportunityData): RenderedInsight {
  return {
    headline: "You can save more this month",
    body: `After bills and a safety buffer, you have $${fmt(
      d.safeSurplus
    )} available. Moving $${fmt(d.suggestedTransfer)} to savings would keep your balance comfortable.`,
    cta: `Move $${fmt(d.suggestedTransfer)} to Savings`,
    action: ACTION_MAP.savings_opportunity,
  };
}

function renderGoalOffTrack(d: GoalOffTrackData): RenderedInsight {
  return {
    headline: `"${d.goalName}" goal behind schedule`,
    body: `You've saved $${fmt(d.monthlyActual)} toward ${
      d.goalName
    } this month. Your target is $${fmt(
      d.monthlyTarget
    )} — you're $${fmt(d.shortfall)} short.`,
    cta: "Catch Up",
    action: ACTION_MAP.goal_off_track,
  };
}

function renderPositiveProgress(d: PositiveProgressData): RenderedInsight {
  if (d.reason === "underspending" && d.delta !== undefined) {
    return {
      headline: "Spending under control",
      body: `You've spent $${fmt(d.delta)} less than your 3-month average so far this month. Nice work.`,
      cta: "View Progress",
      action: ACTION_MAP.positive_progress,
    };
  }

  if (d.reason === "goal_met" && d.goalName) {
    return {
      headline: `"${d.goalName}" goal on track`,
      body: `You've hit your monthly savings target for ${d.goalName}. Keep it up.`,
      cta: "View Progress",
      action: ACTION_MAP.positive_progress,
    };
  }

  // Fallback (shouldn't reach here in normal flow)
  return {
    headline: "Good progress this month",
    body: "Your finances are on track.",
    cta: "View Progress",
    action: ACTION_MAP.positive_progress,
  };
}

// ── V2 Upgrade: LLM Text Renderer ───────────────────────────────────────────
// When ready to upgrade, replace a template function with this pattern:
//
// async function renderCashRiskWithAI(d: CashRiskData): Promise<RenderedInsight> {
//   const prompt = `
//     You are a financial assistant. Convert this data into a 3-part insight.
//     Return ONLY a JSON object with keys: headline, body, cta.
//     Do not invent any numbers. Use only the data provided.
//
//     Data:
//     - Current balance: $${d.currentBalance}
//     - Upcoming bills (7 days): $${d.upcomingBills7d}
//     - Shortfall: $${d.shortfall}
//
//     Rules:
//     - Headline: max 6 words, specific
//     - Body: 1-2 sentences, dollar amounts only from data above
//     - CTA: 2-3 words action label
//     - No shame, no generic advice
//   `;
//   const response = await callLLM(prompt);
//   return JSON.parse(response);
// }

// ── Utility ──────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

