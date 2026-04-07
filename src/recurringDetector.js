// src/recurringDetector.js
// Pure function — no side effects, no network calls.
// Scans last 90 days of transactions and detects recurring charges.
// Returns upcoming charges due within the next 7 days.
//
// Expected transaction shape (from Supabase):
//   { date, amount, type, description, category_name }
//
// Expected output format:
//   [{ merchant, amount, daysUntil, expectedDate, category }]

const AMOUNT_TOLERANCE   = 0.05;   // ±5% for amount grouping
const INTERVAL_TARGET    = 30;     // ~monthly billing cycle
const INTERVAL_TOLERANCE = 5;      // accept 25–35 day intervals
const MIN_OCCURRENCES    = 2;      // need ≥2 matching charges to confirm pattern
const LOOKBACK_DAYS      = 90;     // scan last 90 days
const UPCOMING_DAYS      = 7;      // flag charges due within next 7 days

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize merchant/description for grouping.
 * Strips transaction IDs, trailing card digits, special chars.
 */
function normalizeMerchant(raw) {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[#*]\w*\d+\w*/g, '')   // #12345, *4892
    .replace(/\d{4,}/g, '')          // long digit runs (ref numbers, card digits)
    .replace(/[^\w\s&]/g, ' ')       // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

function amountsMatch(a, b) {
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return true;
  return Math.abs(a - b) / max <= AMOUNT_TOLERANCE;
}

function daysBetween(dateA, dateB) {
  return (new Date(dateB) - new Date(dateA)) / 86_400_000;
}

function titleCase(str) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ─── Main detection ───────────────────────────────────────────────────────────

/**
 * detectRecurringCharges(transactions)
 *
 * Algorithm:
 *   1. Filter to expenses from the last 90 days (exclude Transfers)
 *   2. Group by normalized merchant name
 *   3. Within each group, cluster by amount ±5%
 *   4. If a cluster has ≥2 transactions with ~30-day intervals → recurring
 *   5. Project next charge date from last occurrence + average interval
 *   6. Return only charges due within 7 days, sorted by urgency
 */
export function detectRecurringCharges(transactions) {
  const now    = new Date();
  const cutoff = new Date(now - LOOKBACK_DAYS * 86_400_000);

  // Step 1: filter
  const expenses = transactions.filter(t =>
    t.type === 'expense'
    && t.category_name !== 'Transfer'
    && new Date(t.date) >= cutoff
  );

  // Step 2: group by normalized merchant
  const byMerchant = {};
  for (const t of expenses) {
    const key = normalizeMerchant(t.description || t.category_name || '');
    if (!key || key.length < 2) continue;
    (byMerchant[key] ??= []).push(t);
  }

  const upcoming = [];

  for (const [key, txs] of Object.entries(byMerchant)) {
    if (txs.length < MIN_OCCURRENCES) continue;

    // Sort oldest → newest
    const sorted = [...txs].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Step 3: cluster by amount ±5%
    const clusters = [];
    for (const tx of sorted) {
      const amt = Math.abs(Number(tx.amount));
      let placed = false;
      for (const c of clusters) {
        if (amountsMatch(c.ref, amt)) {
          c.txs.push(tx);
          // Update ref to running average
          c.ref = c.txs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0) / c.txs.length;
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ ref: amt, txs: [tx] });
    }

    // Step 4: check ~30-day intervals per cluster
    for (const cluster of clusters) {
      if (cluster.txs.length < MIN_OCCURRENCES) continue;

      const cs = [...cluster.txs].sort((a, b) => new Date(a.date) - new Date(b.date));

      const gaps = [];
      for (let i = 1; i < cs.length; i++) {
        gaps.push(daysBetween(cs[i - 1].date, cs[i].date));
      }

      // All gaps must be within the accepted range
      const allValid = gaps.every(
        g => g >= INTERVAL_TARGET - INTERVAL_TOLERANCE
          && g <= INTERVAL_TARGET + INTERVAL_TOLERANCE
      );
      if (!allValid) continue;

      // Step 5: project next date
      const avgGap   = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const lastTx   = cs[cs.length - 1];
      const nextDate = new Date(new Date(lastTx.date).getTime() + avgGap * 86_400_000);
      const daysUntil = Math.round((nextDate - now) / 86_400_000);

      if (daysUntil < 0 || daysUntil > UPCOMING_DAYS) continue;

      const rawName    = lastTx.description || lastTx.category_name || key;
      const displayName = titleCase(normalizeMerchant(rawName) || rawName);

      upcoming.push({
        merchant:     displayName,
        amount:       Math.round(cluster.ref * 100) / 100,
        daysUntil,
        expectedDate: nextDate.toISOString().split('T')[0],
        category:     lastTx.category_name || 'Bills',
      });
    }
  }

  // Sort by soonest first
  return upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
}
