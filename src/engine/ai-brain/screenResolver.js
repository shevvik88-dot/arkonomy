// ─── screenResolver.ts ─────────────────────────────────────────────────────
// Maps the active signals to each screen.
// Each screen has a preference order — it gets the highest-priority signal
// that matches its preferred types, falling back to the global winner.

import type {
  Signal,
  TopInsight,
  ScreenInsightMap,
  AiContext,
  InsightType,
} from "./types";
import { prioritize, prioritizeTop } from "./prioritize";
import { renderInsight } from "./textRenderer";

// Screen preferences: ordered list of preferred insight types.
// First match wins. Falls back to global winner if no preferred type exists.
const SCREEN_PREFERENCES: Record<
  "home" | "transactions" | "savings",
  InsightType[]
> = {
  home: ["cash_risk", "category_spike", "overspending", "goal_off_track", "savings_opportunity", "positive_progress"],
  transactions: ["category_spike", "overspending", "cash_risk"],
  savings: ["goal_off_track", "savings_opportunity", "cash_risk"],
};

export function resolveScreens(
  signals: Signal[],
  globalWinner: TopInsight | null
): ScreenInsightMap {
  // Insights screen gets top 3 (already suppressed)
  const top3 = prioritizeTop(signals, 3);

  return {
    home: resolveScreen("home", signals, globalWinner),
    transactions: resolveScreen("transactions", signals, globalWinner),
    savings: resolveScreen("savings", signals, globalWinner),
    insights: top3,
    ai: buildAiContext(signals, globalWinner),
  };
}

function resolveScreen(
  screen: "home" | "transactions" | "savings",
  signals: Signal[],
  globalWinner: TopInsight | null
): TopInsight | null {
  const prefs = SCREEN_PREFERENCES[screen];

  // Find the first preferred type that exists in active signals
  for (const preferredType of prefs) {
    const match = signals.find((s) => s.type === preferredType);
    if (match) {
      const rendered = renderInsight(match);
      return {
        type: match.type,
        priority: match.priority,
        autoExpand: match.type === "cash_risk" || match.priority >= 75,
        data: match.data,
        rendered,
      };
    }
  }

  // Fallback to global winner
  return globalWinner;
}

// AI tab gets all active signals as context — it does NOT invent new logic
function buildAiContext(
  signals: Signal[],
  topInsight: TopInsight | null
): AiContext {
  return {
    activeSignals: signals,
    topInsight,
  };
}

