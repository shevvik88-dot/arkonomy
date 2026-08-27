// Single source of truth for "what counts as the current month" — every
// surface that computes a monthly total (Transactions.jsx, App.jsx,
// get-insights, financial-diagnosis) used to implement this independently.
// Budget/overspending-signals investigation, Step 3 (2026-08-27) found this
// wasn't just 4 copies of the same logic — 2 of the 4 (App.jsx,
// Transactions.jsx) already fell back to last month when the real current
// month had zero transactions yet; the other 2 (get-insights,
// financial-diagnosis) didn't, and would show honest zeros / a false
// "declining" trend during the same first-few-days-of-a-new-month window
// where the frontend was already quietly showing last month's numbers as
// "current" — the same class of cross-screen inconsistency as the
// Transfer/Transfers exclusion rule (see financialConstants.js's
// isTransferCategory comment) and the Net Worth formula, just for date
// windows instead of money math.
//
// Keep in sync with supabase/functions/_shared/dateWindows.ts — no
// automated linkage across Vite (frontend) and Deno (edge functions)
// runtimes (same constraint as financialConstants.ts/recurringDetector.ts),
// so that file is a deliberate hand-kept mirror. It's built around "YYYY-MM"
// month-key strings (financial-diagnosis's own pre-existing monthKey()
// idiom) instead of the year/month numbers used here — same rule, different
// shape, not a drifted duplicate.
//
// Fallback rule: if the real calendar current month has zero transactions,
// treat the previous calendar month as "current" — but only if the account
// has transaction history at all; a brand-new account with zero
// transactions stays on its real (empty) current month rather than
// silently jumping to an equally-empty prior month. Deliberately does not
// cascade further than one month back, even if that month is also empty —
// matches the existing App.jsx/Transactions.jsx behavior this unifies,
// rather than inventing a new "search further back" rule.

// Local copy, not imported from utils/helpers.js: that file's parseDate()
// and App.jsx's own local copy of the same function have already drifted
// on falsy-input handling (null vs `new Date()`) — this file stays
// self-contained rather than coupling to either drifted copy, same
// approach financialConstants.js already takes.
function parseLocalDate(dateStr) {
  return new Date(dateStr + "T00:00:00");
}

export function isInMonth(t, year, month) {
  const d = parseLocalDate(t.date);
  return d.getFullYear() === year && d.getMonth() === month;
}

export function monthTransactions(transactions, year, month) {
  return transactions.filter(t => isInMonth(t, year, month));
}

// transactions: whatever the caller already has in hand (does not fetch
// anything) — spanning at least the real current month and, ideally, one
// month before it, or the fallback decision can't see there's history to
// fall back to.
export function getCurrentMonthWindow(transactions, referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const hasAnyHistory = transactions.length > 0;
  const hasCurrent = transactions.some(t => isInMonth(t, year, month));
  const isFallback = hasAnyHistory && !hasCurrent;

  const effYear  = isFallback ? (month === 0 ? year - 1 : year) : year;
  const effMonth = isFallback ? (month === 0 ? 11 : month - 1) : month;
  const prevYear  = effMonth === 0 ? effYear - 1 : effYear;
  const prevMonth = effMonth === 0 ? 11 : effMonth - 1;

  return {
    year: effYear, month: effMonth,       // effective "current" month (0-indexed)
    prevYear, prevMonth,                  // the month before the effective one, for MoM comparisons
    isFallback,
    monthStart: new Date(effYear, effMonth, 1),
    // A fallback month is already over — its range end is its own last day,
    // not "today" (today belongs to a different, empty month). The real
    // current month is still in progress, so its range end is "now".
    rangeEnd: isFallback ? new Date(effYear, effMonth + 1, 0) : referenceDate,
  };
}
