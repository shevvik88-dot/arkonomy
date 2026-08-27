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

// Extracted from Savings.jsx's Asset Allocation fix (2026-08-24) so
// Dashboard's net worth calc (Step 2.5, 2026-08-27) can share the exact same
// definition of "Plaid investment total" instead of a second copy.
//
// Double-count guard: if a Plaid-linked "investment" account is actually the
// same Alpaca account this app already holds a direct OAuth connection to
// (Plaid does support linking Alpaca as an institution), its balance would
// otherwise be counted twice — once via Plaid, once via the direct
// alpaca-portfolio fetch (sumAlpacaPositionsValue below). Matched by
// institution name since Plaid's account object has no other Alpaca-
// account-identity field to cross-reference against our own alpaca_account_id.
function isAlpacaViaPlaid(a) {
  return /alpaca/i.test(a.institution_name ?? "");
}

export function sumInvestmentBalance(accounts) {
  if (!accounts) return 0;
  return accounts
    .filter(a => a.type === "investment" && !isAlpacaViaPlaid(a))
    .reduce((sum, a) => sum + Number(a.balance_available ?? a.balance_current ?? 0), 0);
}

// market_value sum, not portfolio_value — portfolio_value is Alpaca's
// account-level equity (positions + uninvested cash sitting in the brokerage
// account), which would inflate this with cash that isn't actually invested.
// Summing positions keeps this representing only what's really held in
// stocks/ETFs, same meaning as the Plaid side (sumInvestmentBalance above).
export function sumAlpacaPositionsValue(alpacaPortfolio) {
  return (alpacaPortfolio?.positions ?? []).reduce((sum, p) => sum + Number(p.market_value ?? 0), 0);
}
