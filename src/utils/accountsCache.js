const ACCOUNTS_CACHE_KEY = "arkonomy_accounts_v2";
const ACCOUNTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function getCachedAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_CACHE_KEY);
    if (!raw) return null;
    const { ts, accounts } = JSON.parse(raw);
    if (Date.now() - ts > ACCOUNTS_CACHE_TTL) return null;
    return accounts;
  } catch { return null; }
}
export function setCachedAccounts(accounts) {
  try {
    localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify({ ts: Date.now(), accounts }));
  } catch {}
}
export function clearAccountsCache() {
  try {
    console.log("[cache] clearAccountsCache called — removing", ACCOUNTS_CACHE_KEY);
    localStorage.removeItem(ACCOUNTS_CACHE_KEY);
  } catch {}
}

// Sums balance_available (fallback balance_current) across all depository
// accounts — same pattern as get-insights/index.ts:244-264. Excludes credit
// (debt, not cash). Returns null if accounts is null/empty/no depository
// accounts, so callers keep their existing "not loaded yet" semantics.
export function sumDepositoryBalance(accounts) {
  if (!accounts) return null;
  const depository = accounts.filter(a => a.type === "depository");
  if (depository.length === 0) return null;
  return depository.reduce((sum, a) => sum + Number(a.balance_available ?? a.balance_current ?? 0), 0);
}

export function getCreditAccounts(accounts) {
  if (!accounts) return [];
  return accounts.filter(a => a.type === "credit");
}

// balance_current = debt, balance_available = remaining credit (Plaid's
// convention for credit accounts) — current+available approximates the
// limit without needing the Liabilities product. Returns null when there's
// nothing to divide by (no available field from this institution).
export function creditUtilization(account) {
  const current = Number(account.balance_current ?? 0);
  const available = Number(account.balance_available ?? 0);
  const total = current + available;
  return total > 0 ? current / total : null;
}

export function sumCreditDebt(accounts) {
  const credit = getCreditAccounts(accounts);
  if (credit.length === 0) return null;
  return credit.reduce((sum, a) => sum + Number(a.balance_current ?? 0), 0);
}
