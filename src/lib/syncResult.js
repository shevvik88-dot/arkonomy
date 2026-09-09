// Classify a callEdgeFunctionWithStatus() result for plaid-sync-transactions
// into 'clean' | 'partial' | 'error'.
//
// Only 'clean' means a full sync completed and last_synced_at may be
// advanced. Anything that is not a 200/207 carrying the exact server
// contract — { added, modified, removed, synced } as non-negative safe
// integers with synced === added + modified, plus an optional failed_items
// array of non-empty string item ids — is an error, not a success. A 502
// with an HTML body, an empty body, a 401/500, an unexpected 2xx (201/204),
// or a 200 whose numbers are missing / negative / fractional / internally
// inconsistent must NOT read as a clean sync (#96 P2). The call-site wiring
// (real fetch -> decode -> this -> App.jsx reaction) is covered in
// syncPaths.test.mjs; the classifier itself in syncResult.test.mjs.
//
// Kept in its own module (no Vite `import.meta.env` deps) so it is unit-
// testable under plain `node --test`.

const COUNT_KEYS = ['added', 'modified', 'removed', 'synced'];

export function classifySyncResult({ status, ok, data } = {}) {
  if (ok !== true || (status !== 200 && status !== 207)) return 'error';
  if (!data || typeof data !== 'object' || Array.isArray(data) || 'error' in data) return 'error';

  // Every count must be a real, non-negative integer, and the server's own
  // invariant (synced counts the rows it applied) must hold.
  if (!COUNT_KEYS.every((k) => Number.isSafeInteger(data[k]) && data[k] >= 0)) return 'error';
  if (data.synced !== data.added + data.modified) return 'error';

  // failed_items, when present, must be a list of usable item ids.
  const hasFailed = 'failed_items' in data;
  if (hasFailed) {
    if (!Array.isArray(data.failed_items)) return 'error';
    if (!data.failed_items.every((id) => typeof id === 'string' && id.trim().length > 0)) return 'error';
  }

  if (status === 207 || (hasFailed && data.failed_items.length > 0)) return 'partial';
  return 'clean';
}
