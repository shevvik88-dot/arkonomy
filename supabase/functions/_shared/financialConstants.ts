// Shared financial constants (and a couple of tiny shared predicates) for
// edge functions.
// Keep in sync with src/shared/financialConstants.js — no automated linkage
// across Vite (frontend) and Deno (edge functions) runtimes, so both files
// must be updated together by hand when any value changes.

export const BUFFER = 1_000;

export const SAVE_CAP_SMALL  = 200;
export const SAVE_CAP_MEDIUM = 500;
export const SAVE_CAP_LARGE  = 1_000;

export const REC_MIN = 200;
export const REC_MAX = 400;

export const SAVINGS_TARGET_RATE = 0.20;

// ── "What counts as an expense" — single source of truth ────────────────────
// Mirrors src/shared/financialConstants.js's isTransferCategory/isRealExpense
// exactly — see that file's comment for the full rationale (budget/
// overspending-signals investigation, 2026-08-26). Deliberately not the same
// scope as resolveCategory() on the client (that also re-guesses unrelated
// categories via guessCategory(), irrelevant to transfer detection).
export function isTransferCategory(t: { category_name?: string | null; description?: string | null }): boolean {
  if (t.category_name === 'Transfer' || t.category_name === 'Transfers') return true;
  return /\bzelle\b|\bvenmo\b/i.test(t.description || '');
}

export function isRealExpense(t: { type: string; category_name?: string | null; description?: string | null }): boolean {
  return t.type === 'expense' && !isTransferCategory(t);
}
