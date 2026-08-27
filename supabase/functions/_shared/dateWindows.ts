// Mirrors src/shared/dateWindows.js — Deno can't import from src/, same
// constraint as financialConstants.ts/recurringDetector.ts, so this is a
// deliberate hand-kept duplicate, not an independent reinvention. Built
// around "YYYY-MM" month-key strings (financial-diagnosis's own
// pre-existing monthKey() idiom) instead of the year/month numbers the
// frontend version uses — same rule, different shape, kept in sync by hand
// whenever the fallback rule itself changes.
//
// See dateWindows.js's header comment for the full rationale (budget/
// overspending-signals investigation, Step 3, 2026-08-27) and the fallback
// rule: real current month if it has any transactions; otherwise the
// previous calendar month, but only if there's transaction history at all,
// and never cascading further than one month back.

export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthTransactions<T extends { date: string }>(transactions: T[], key: string): T[] {
  return transactions.filter(t => monthKey(t.date) === key);
}

// transactions: whatever the caller already fetched (this does not query
// the DB) — must span at least the real current month plus one month
// before it, or the fallback decision can't see there's history to fall
// back to.
export function getCurrentMonthWindow(transactions: { date: string }[], referenceDate: Date = new Date()) {
  const realKey = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, '0')}`;
  const hasAnyHistory = transactions.length > 0;
  const hasCurrent = transactions.some(t => monthKey(t.date) === realKey);
  const isFallback = hasAnyHistory && !hasCurrent;
  const effectiveKey = isFallback ? shiftMonthKey(realKey, -1) : realKey;
  const prevKey = shiftMonthKey(effectiveKey, -1);
  return { monthKey: effectiveKey, prevMonthKey: prevKey, isFallback };
}
