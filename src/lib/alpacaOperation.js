// Client idempotency keys for Alpaca purchases.
//
// One key per *intentional* purchase. A retry of that same purchase (an
// auto-retry, or the user tapping Buy again after a response that never
// arrived) reuses the key so alpaca-invest replays the original outcome
// instead of placing a second real order. A genuinely new purchase gets a
// new key.
//
// Retry vs. new is an explicit state, not a timer:
//   - an operation stays "open" until settleOperation() is called for its
//     exact id — and settleOperation() is only ever called on a DEFINITE
//     outcome: a confirmed placement, or a definite server rejection where
//     nothing was placed (see classifyInvestOutcome);
//   - beginOperation() reuses the open operation for that (symbol, amount)
//     and reports isRetry:true; once it is settled, the next call mints a
//     fresh key (isRetry:false).
//
// An open operation's id is NEVER reassigned or evicted — not by elapsed
// time, and not by how many unrelated purchases happened in between.
// Dropping the key of an operation whose outcome the user hasn't seen is
// exactly what lets a second real order through. Only *settled* entries are
// pruned, and only after a short grace period.
//
// Durability: the registry is persisted in sessionStorage, keyed by user
// id. If storage is unavailable, beginOperation() for a NEW operation FAILS
// CLOSED ({ error: 'storage_unavailable' }) rather than hand back an
// in-memory-only id that a reload would lose — the caller must surface that
// and not place the order. An operation already open in this page's memory
// stays reusable for the life of the page even if storage breaks mid-flight.

const STORE_PREFIX = 'arkonomy_alpaca_ops:';
const SETTLED_TTL_MS = 10 * 60 * 1000; // a concluded operation: forget after 10 min

const mem = new Map(); // userId -> { [sig]: { id, ts, settled } }

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

// Round-trips a sentinel through sessionStorage. Returns false if any step
// throws (private mode / disabled) or the value doesn't come back.
function storageWritable() {
  try {
    const k = STORE_PREFIX + '__probe__';
    const v = String(Date.now());
    sessionStorage.setItem(k, v);
    const ok = sessionStorage.getItem(k) === v;
    sessionStorage.removeItem(k);
    return ok;
  } catch {
    return false;
  }
}

function load(userId) {
  const key = String(userId ?? '');
  let obj = mem.get(key);
  if (!obj) {
    obj = {};
    try {
      const raw = sessionStorage.getItem(STORE_PREFIX + key);
      if (raw) obj = JSON.parse(raw) || {};
    } catch { /* storage unavailable — read what mem has (nothing, first call) */ }
    if (!obj || typeof obj !== 'object') obj = {};
    mem.set(key, obj);
  }
  return obj;
}

function save(userId, obj) {
  const key = String(userId ?? '');
  mem.set(key, obj);
  try { sessionStorage.setItem(STORE_PREFIX + key, JSON.stringify(obj)); } catch { /* mirror is best-effort */ }
}

function prune(obj) {
  const now = Date.now();
  for (const sig of Object.keys(obj)) {
    const e = obj[sig];
    if (!e || typeof e !== 'object' || !e.id) { delete obj[sig]; continue; }
    // ONLY settled entries are ever pruned. An open operation stays,
    // indefinitely, until settleOperation() concludes it.
    if (e.settled && now - (e.ts || 0) > SETTLED_TTL_MS) delete obj[sig];
  }
}

/**
 * Key for an intentional purchase of `amount` of `symbol` by `userId`.
 * Reuses the still-open operation for that exact (symbol, amount) — a
 * retry — otherwise mints a new one.
 *
 * @returns {{ id: string, isRetry: boolean }} on success, or
 *          {{ error: 'storage_unavailable' }} when a NEW operation cannot
 *          be durably persisted — the caller must not place the order.
 */
export function beginOperation(userId, symbol, amount) {
  const obj = load(userId);
  const sig = sigOf(symbol, amount);
  const cur = obj[sig];
  if (cur && cur.id && !cur.settled) {
    return { id: cur.id, isRetry: true };
  }
  // A brand-new operation must be durably trackable before we let an order
  // go out under it.
  if (!storageWritable()) {
    return { error: 'storage_unavailable' };
  }
  const id = uuid();
  obj[sig] = { id, ts: Date.now(), settled: false };
  prune(obj);
  save(userId, obj);
  return { id, isRetry: false };
}

/**
 * Mark the operation with this exact `id` concluded. Only the entry whose
 * id matches is touched — other open operations, including for other
 * (symbol, amount) pairs, are left alone. Call this ONLY on a definite
 * outcome (see classifyInvestOutcome); after it, beginOperation() for the
 * same purchase mints a fresh key.
 */
export function settleOperation(userId, id) {
  if (!id) return;
  const obj = load(userId);
  let changed = false;
  for (const sig of Object.keys(obj)) {
    if (obj[sig] && obj[sig].id === id && !obj[sig].settled) {
      obj[sig] = { ...obj[sig], settled: true, ts: Date.now() };
      changed = true;
    }
  }
  if (changed) { prune(obj); save(userId, obj); }
}

// alpaca-invest error strings / codes that mean "the server definitively
// placed nothing and a retry of this exact call won't change that".
const DEFINITE_REJECTIONS = [
  'brokerage_account_error',
  'operation_parameters_mismatch',
  'previous_attempt_incomplete',
  'Order failed',
  'Invalid symbol',
  'Invalid operation_id',
  'Invalid request body',
];

/**
 * Given an alpaca-invest call outcome, decide whether the operation
 * concluded ('settle') or is still open for reconciliation ('keep').
 *
 * 'settle' — a confirmed placement (success:true), or a DEFINITE rejection
 *            (insufficient buying power, a real Alpaca order rejection, bad
 *            params, a spent/mismatched operation key).
 * 'keep'   — everything else, including: no response at all (network /
 *            FunctionsFetchError), a 409 "already submitted / still
 *            processing", any 5xx, a 503 order_status_unknown, and
 *            alpaca_not_connected (the user reconnects and retries the same
 *            purchase). Unknown errors default here — never settle on a
 *            result we don't understand.
 *
 * @param {{ success?: boolean, threw?: boolean, httpStatus?: number, errorCode?: string }} o
 * @returns {'settle' | 'keep'}
 */
export function classifyInvestOutcome(o = {}) {
  if (o.success === true) return 'settle';
  const code = String(o.errorCode ?? '');
  if (code.includes('Insufficient buying power')) return 'settle';
  if (code.includes('Minimum amount')) return 'settle';
  if (DEFINITE_REJECTIONS.includes(code)) return 'settle';
  return 'keep';
}
