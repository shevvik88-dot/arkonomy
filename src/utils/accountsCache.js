const ACCOUNTS_CACHE_KEY = "arkonomy_accounts_v1";
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
  try { localStorage.removeItem(ACCOUNTS_CACHE_KEY); } catch {}
}
