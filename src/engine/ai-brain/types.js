// ─── types.ts ──────────────────────────────────────────────────────────────
// Single source of truth for all AI Brain types

export type InsightType =
  | "overspending"
  | "category_spike"
  | "cash_risk"
  | "savings_opportunity"
  | "goal_off_track"
  | "positive_progress";

export type ScreenName = "home" | "transactions" | "savings" | "insights" | "ai";

// ── Raw input the backend receives (from Supabase queries) ──────────────────

export interface FinancialInput {
  currentBalance: number;
  currentMonthSpend: number;
  avg3mSpend: number;
  upcomingBills7d: number;
  monthsOfHistory: number; // guard for < 2 months
  dataFreshnessHours: number; // guard for stale data
  categories: CategoryInput[];
  goals: GoalInput[];
}

export interface CategoryInput {
  name: string;
  currentMonthSpend: number;
  avg3mSpend: number;
}

export interface GoalInput {
  id: string;
  name: string;
  monthlyTarget: number;
  monthlyActual: number;
}

// ── Computed metrics (metrics.ts output) ────────────────────────────────────

export interface Metrics {
  currentBalance: number;
  currentMonthSpend: number;
  avg3mSpend: number;
  spendDelta: number;           // currentMonthSpend - avg3mSpend
  upcomingBills7d: number;
  safeSurplus: number;          // balance - bills7d - 200
  topCategorySpike: CategorySpike | null;
  offTrackGoal: OffTrackGoal | null;
  hasEnoughHistory: boolean;
  dataIsStale: boolean;
}

export interface CategorySpike {
  name: string;
  currentSpend: number;
  avgSpend: number;
  delta: number;
  pctIncrease: number;
}

export interface OffTrackGoal {
  id: string;
  name: string;
  monthlyTarget: number;
  monthlyActual: number;
  shortfall: number;
}

// ── Signals (signals.ts output) ─────────────────────────────────────────────

export interface Signal {
  type: InsightType;
  priority: number;
  data: SignalData;
}

export type SignalData =
  | OverspendingData
  | CategorySpikeData
  | CashRiskData
  | SavingsOpportunityData
  | GoalOffTrackData
  | PositiveProgressData;

export interface OverspendingData {
  currentMonthSpend: number;
  avg3mSpend: number;
  delta: number;
}

export interface CategorySpikeData {
  categoryName: string;
  currentSpend: number;
  avgSpend: number;
  delta: number;
  pctIncrease: number;
}

export interface CashRiskData {
  currentBalance: number;
  upcomingBills7d: number;
  shortfall: number;
}

export interface SavingsOpportunityData {
  safeSurplus: number;
  suggestedTransfer: number;
}

export interface GoalOffTrackData {
  goalId: string;
  goalName: string;
  monthlyTarget: number;
  monthlyActual: number;
  shortfall: number;
}

export interface PositiveProgressData {
  reason: "underspending" | "goal_met";
  currentMonthSpend?: number;
  avg3mSpend?: number;
  delta?: number;
  goalName?: string;
  monthlyTarget?: number;
  monthlyActual?: number;
}

// ── Top Insight (prioritize.ts output) ──────────────────────────────────────

export interface TopInsight {
  type: InsightType;
  priority: number;
  autoExpand: boolean;
  data: SignalData;
  rendered: RenderedInsight;
}

export interface RenderedInsight {
  headline: string;
  body: string;
  cta: string;
  action: ActionType;
}

export type ActionType =
  | "view_bills"
  | "review_spending"
  | "reduce_category"
  | "move_to_savings"
  | "catch_up_goal"
  | "view_progress";

// ── Screen mapping (screenResolver.ts output) ────────────────────────────────

export interface ScreenInsightMap {
  home: TopInsight | null;
  transactions: TopInsight | null;
  savings: TopInsight | null;
  insights: TopInsight[];       // up to 3
  ai: AiContext;
}

export interface AiContext {
  activeSignals: Signal[];
  topInsight: TopInsight | null;
}

// ── Final API response ───────────────────────────────────────────────────────

export interface InsightApiResponse {
  generatedAt: string;          // ISO timestamp
  hasInsights: boolean;
  screens: ScreenInsightMap;
  debug?: DebugInfo;            // only in dev/staging
}

export interface DebugInfo {
  metrics: Metrics;
  allSignals: Signal[];
  suppressedTypes: InsightType[];
}

