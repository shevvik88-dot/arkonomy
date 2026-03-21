// ─── prioritize.ts ─────────────────────────────────────────────────────────
// Applies suppression rules, then picks the single winning signal.
// All suppression logic lives here — easy to read, easy to audit.

import type { Signal, TopInsight, InsightType } from "./types";
import { renderInsight } from "./textRenderer";

// ── Suppression Rules ────────────────────────────────────────────────────────
//
// Rule 1: cash_risk exists → suppress savings_opportunity + positive_progress
// Rule 2: category_spike AND overspending both exist → suppress overspending
// Rule 3: any warning/risk signal → suppress positive_progress
// Rule 4: nothing meaningful → return null

const WARNING_TYPES: InsightType[] = [
  "cash_risk",
  "category_spike",
  "overspending",
  "goal_off_track",
];

export function prioritize(signals: Signal[]): {
  winner: TopInsight | null;
  suppressedTypes: InsightType[];
} {
  if (signals.length === 0) {
    return { winner: null, suppressedTypes: [] };
  }

  const suppressed = new Set<InsightType>();
  const types = new Set(signals.map((s) => s.type));

  // Rule 1
  if (types.has("cash_risk")) {
    suppressed.add("savings_opportunity");
    suppressed.add("positive_progress");
  }

  // Rule 2
  if (types.has("category_spike") && types.has("overspending")) {
    suppressed.add("overspending");
  }

  // Rule 3
  const hasWarning = signals.some((s) => WARNING_TYPES.includes(s.type));
  if (hasWarning) {
    suppressed.add("positive_progress");
  }

  // Filter out suppressed signals
  const active = signals.filter((s) => !suppressed.has(s.type));

  if (active.length === 0) {
    return { winner: null, suppressedTypes: [...suppressed] };
  }

  // Sort by priority descending, pick winner
  active.sort((a, b) => b.priority - a.priority);
  const top = active[0];

  const rendered = renderInsight(top);

  const winner: TopInsight = {
    type: top.type,
    priority: top.priority,
    autoExpand: shouldAutoExpand(top),
    data: top.data,
    rendered,
  };

  return { winner, suppressedTypes: [...suppressed] };
}

// Returns top N signals after suppression (for Insights screen)
export function prioritizeTop(
  signals: Signal[],
  n: number = 3
): TopInsight[] {
  const suppressed = new Set<InsightType>();
  const types = new Set(signals.map((s) => s.type));

  if (types.has("cash_risk")) {
    suppressed.add("savings_opportunity");
    suppressed.add("positive_progress");
  }
  if (types.has("category_spike") && types.has("overspending")) {
    suppressed.add("overspending");
  }
  const hasWarning = signals.some((s) => WARNING_TYPES.includes(s.type));
  if (hasWarning) {
    suppressed.add("positive_progress");
  }

  const active = signals
    .filter((s) => !suppressed.has(s.type))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, n);

  return active.map((s) => ({
    type: s.type,
    priority: s.priority,
    autoExpand: shouldAutoExpand(s),
    data: s.data,
    rendered: renderInsight(s),
  }));
}

// ── Auto-Expand Logic ────────────────────────────────────────────────────────
function shouldAutoExpand(signal: Signal): boolean {
  if (signal.type === "cash_risk") return true;
  if (signal.priority >= 75) return true;

  // Expand if rendered CTA will contain a specific dollar amount
  // (proxy: savings_opportunity and cash_risk always have dollar amounts)
  if (signal.type === "savings_opportunity") return true;

  return false;
}

