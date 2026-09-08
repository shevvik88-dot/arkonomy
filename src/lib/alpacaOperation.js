// Client idempotency keys for Alpaca purchases.
//
// One key per *intentional* purchase. A retry of that same purchase (an
// auto-retry, or the user tapping Buy again after a response that never
// arrived) reuses the key so alpaca-invest replays the original outcome
// instead of placing a second real order. A genuinely new purchase gets a
// new key.
//
// Retry vs. new is an explicit state, not a timer:
//   - an operation stays "open" (unsettled) until settleOperation() is
//     called for its exact id — a confirmed placement, or a definite
//     failure where the server placed nothing;
//   - beginOperation() reuses the open operation for that (symbol, amount)
//     and reports isRetry:true; once it is settled, the next call mints a
//     fresh key (isRetry:false).
//
// An open operation is NEVER replaced by a TTL or by starting a *different*
// purchase — its outcome may be unknown to the user, and dropping the key
// is exactly what lets a second order through. Only settled operations are
// pruned, and only after a grace period.
//
// State lives in an in-memory map (primary, so a blocked sessionStorage
// still gets correct retry behaviour for the page's lifetime) mirrored to
// sessionStorage per user id (so it survives a reload and is scoped to the
// signed-in account).

const STORE_PREFIX = 'arkonomy_alpaca_ops:';
const MAX_ENTRIES = 25;
const SETTLED_TTL_MS = 10 * 60 * 1000;          // a concluded operation: forget after 10 min
const OPEN_TTL_MS = 24 * 60 * 60 * 1000;        // an unresolved operation: keep a full day (Alpaca/our ambiguity window), then a repeat is genuinely new

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

function load(userId) {
  const key = String(userId ?? '');
  let obj = mem.get(key);
  if (!obj) {
    obj = {};
    try {
      const raw = sessionStorage.getItem(STORE_PREFIX + key);
      if (raw) obj = JSON.parse(raw) || {};
    } catch { /* storage unavailable — in-memory only for this page */ }
    if (!obj || typeof obj !== 'object') obj = {};
    mem.set(key, obj);
  }
  return obj;
}

function save(userId, obj) {
  const key = String(userId ?? '');
  mem.set(key, obj);
  try { sessionStorage.setItem(STORE_PREFIX + key, JSON.stringify(obj)); } catch { /* ignore */ }
}

function prune(obj) {
  const now = Date.now();
  for (const sig of Object.keys(obj)) {
    const e = obj[sig];
    if (!e || typeof e !== 'object' || !e.id) { delete obj[sig]; continue; }
    const age = now - (e.ts || 0);
    if (e.settled && age > SETTLED_TTL_MS) delete obj[sig];
    else if (!e.settled && age > OPEN_TTL_MS) delete obj[sig];
  }
  const sigs = Object.keys(obj);
  if (sigs.length > MAX_ENTRIES) {
    // Evict settled first (oldest), then — only if still over — the oldest
    // open ones. Realistically never reached; a safety valve.
    const ordered = sigs.sort((a, b) => {
      const ea = obj[a], eb = obj[b];
      if (!!ea.settled !== !!eb.settled) return ea.settled ? -1 : 1;
      return (ea.ts || 0) - (eb.ts || 0);
    });
    for (const sig of ordered.slice(0, sigs.length - MAX_ENTRIES)) delete obj[sig];
  }
}

/**
 * Key for an intentional purchase of `amount` of `symbol` by `userId`.
 * Reuses the still-open operation for that exact (symbol, amount) — a
 * retry — otherwise mints a new one.
 * @returns {{ id: string, isRetry: boolean }}
 */
export function beginOperation(userId, symbol, amount) {
  const obj = load(userId);
  const sig = sigOf(symbol, amount);
  const cur = obj[sig];
  if (cur && cur.id && !cur.settled && Date.now() - (cur.ts || 0) <= OPEN_TTL_MS) {
    return { id: cur.id, isRetry: true };
  }
  const id = uuid();
  obj[sig] = { id, ts: Date.now(), settled: false };
  prune(obj);
  save(userId, obj);
  return { id, isRetry: false };
}

/**
 * Mark the operation with this exact `id` concluded (a confirmed
 * placement, or a definite failure). Only the entry whose id matches is
 * touched — other open operations, including for other (symbol, amount)
 * pairs, are left alone. After this, beginOperation() for the same
 * purchase mints a fresh key.
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
