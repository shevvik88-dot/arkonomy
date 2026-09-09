// Classify a callEdgeFunctionWithStatus() result for plaid-sync-transactions
// into 'clean' | 'partial' | 'error'.
//
// Only 'clean' means a full sync completed and last_synced_at may be
// advanced. Anything that isn't a 2xx with the expected JSON contract
// (added/modified/removed/synced numbers) is an error, not a success — a
// 502 with an HTML body, an empty body, a 401/500, or a 200 whose shape is
// wrong must NOT read as a clean sync (#96 P2).
//
// Kept in its own module (no Vite `import.meta.env` deps) so it is unit-
// testable under plain `node --test`.

export function classifySyncResult({ status, ok, data } = {}) {
  if (!ok || !data || typeof data !== 'object' || data.error) return 'error';
  const failed = Array.isArray(data.failed_items) ? data.failed_items : [];
  if (status === 207 || failed.length > 0) return 'partial';
  if (typeof data.synced !== 'number') return 'error'; // 200 but not the sync contract
  return 'clean';
}
