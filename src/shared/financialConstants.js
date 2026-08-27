// Shared financial constants (and a couple of tiny shared predicates) for
// the frontend.
// Keep in sync with supabase/functions/_shared/financialConstants.ts — no
// automated linkage across Vite (frontend) and Deno (edge functions)
// runtimes, so both files must be updated together by hand when any value
// changes.

export const BUFFER = 1000;

export const SAVE_CAP_SMALL  = 200;
export const SAVE_CAP_MEDIUM = 500;
export const SAVE_CAP_LARGE  = 1000;

export const REC_MIN = 200;
export const REC_MAX = 400;

export const SAVINGS_TARGET_RATE = 0.20;

// ── "What counts as an expense" — single source of truth ────────────────────
// Budget/overspending-signals investigation (2026-08-26) found 3 different
// exclusion rules for Transfer/Transfers across the app: Transactions.jsx
// excluded only the singular Plaid-native "Transfer"; get-insights and
// financial-diagnosis excluded nothing at all; only App.jsx/ai-chat/
// Insights' budget bar (via resolveCategory() in utils/helpers.js)
// correctly excluded both forms. This is the extracted, minimal version of
// that check — deliberately NOT the same thing as resolveCategory(), which
// also re-guesses unrelated categories (Housing, Food & Dining, etc.) via
// guessCategory() for transactions with a missing/'Other' category_name.
// That broader re-categorization has drifted between its two independent
// copies (App.jsx's local one vs. utils/helpers.js's) — a separate, still-
// open issue (see docs/known-issues.md) — and is irrelevant to transfer
// detection specifically: resolveCategory() already never lets
// guessCategory() produce a 'Transfer' result (see its own comment), so the
// only two conditions that ever matter for exclusion are reproduced here
// directly, without pulling in that unrelated drift.
//
// A transaction is Transfer/Transfers (money movement, not spending) when
// either category_name is already 'Transfer' or 'Transfers' — Plaid-native,
// or written at sync time by plaid-sync-transactions' own Zelle/Venmo
// override — or its description still matches Zelle/Venmo despite an
// older/legacy category_name (defense-in-depth, mirrors resolveCategory()).
export function isTransferCategory(t) {
  if (t.category_name === 'Transfer' || t.category_name === 'Transfers') return true;
  return /\bzelle\b|\bvenmo\b/i.test(t.description || '');
}

export function isRealExpense(t) {
  return t.type === 'expense' && !isTransferCategory(t);
}
