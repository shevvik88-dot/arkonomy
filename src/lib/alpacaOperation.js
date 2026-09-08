// One idempotency key per *intentional* Alpaca purchase.
//
// The same key is reused on every retry of the same purchase — an
// auto-retry, or the user tapping Buy again after a response that never
// arrived — so alpaca-invest resolves the retry to the original row and
// replays its outcome instead of placing a second real order (REQ-3).
// A genuinely new purchase (different symbol/amount, or after a confirmed
// success) gets a fresh key.
//
// Persisted in sessionStorage, keyed by (symbol|amount), so a page reload
// between a lost 200 and the retry does not mint a new key. TTL-bounded so
// a long-abandoned attempt doesn't shadow a later, deliberate repeat buy.

const KEY = 'arkonomy_alpaca_op';
const TTL_MS = 15 * 60 * 1000;

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

function sigOf(symbol, amount) {
  return `${String(symbol ?? '').toUpperCase()}|${Number(amount)}`;
}

/** Stable operation_id for this (symbol, amount) purchase; new one if none is live. */
export function operationIdFor(symbol, amount) {
  const sig = sigOf(symbol, amount);
  try {
    const o = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (o && o.sig === sig && o.id && Date.now() - o.ts < TTL_MS) return o.id;
  } catch { /* private mode / blocked storage — fall through to a fresh id */ }
  const id = uuid();
  try { sessionStorage.setItem(KEY, JSON.stringify({ sig, id, ts: Date.now() })); } catch { /* ignore */ }
  return id;
}

/** Call on a confirmed placement (or when abandoning) so the next purchase is fresh. */
export function clearOperationId() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
