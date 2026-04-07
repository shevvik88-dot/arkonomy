// src/recurringDetector.js
// Detects recurring subscription/bill charges from the last 90 days.
// Conservative by design — only flags genuine recurring billing, not
// frequent casual spending like coffee shops or fast food.
//
// Expected transaction shape: { date, amount, type, description, category_name }
// Output shape: [{ merchant, amount, daysUntil, expectedDate, category }]

// ─── Thresholds ───────────────────────────────────────────────────────────────

const AMOUNT_TOLERANCE    = 0.02;   // ±2% — subscriptions charge the exact same amount
const INTERVAL_TARGET     = 30;     // monthly billing cycle
const INTERVAL_TOLERANCE  = 5;      // accept 25–35 day gap between charges
const DAY_OF_MONTH_TOL    = 5;      // charge must land within ±5 days of same DOM
const MIN_OCCURRENCES     = 2;      // need ≥2 confirmed charges
const MIN_AMOUNT          = 10;     // ignore anything under $10 (coffee, small tips)
const LOOKBACK_DAYS       = 90;
const UPCOMING_DAYS       = 7;
const MAX_RESULTS         = 4;      // cap at 4 most critical items
const MIN_CONFIRMED       = 2;      // hide the section if fewer than this confirmed

// ─── Merchant allow-list: keywords that signal a subscription or bill ─────────
// A transaction must match at least one of these to be considered recurring.
// This is the primary defense against coffee shops, restaurants, Uber rides, etc.

const SUBSCRIPTION_KEYWORDS = [
  // Streaming & entertainment
  'netflix', 'spotify', 'hulu', 'disney', 'hbo', 'max', 'peacock', 'paramount',
  'apple tv', 'prime video', 'crunchyroll', 'youtube premium', 'tidal', 'deezer',
  'pandora', 'siriusxm', 'twitch', 'xbox game pass', 'playstation plus', 'ps plus',
  'nintendo switch online', 'ea play',

  // Telecom & internet
  'at&t', 'att', 'verizon', 'tmobile', 't-mobile', 'sprint', 'comcast', 'xfinity',
  'spectrum', 'cox', 'optimum', 'frontier', 'centurylink', 'lumen', 'boost mobile',
  'cricket wireless', 'metro', 'visible', 'mint mobile',

  // Utilities
  'electric', 'electricity', 'water bill', 'gas bill', 'utility', 'utilities',
  'pge', 'pg&e', 'con edison', 'coned', 'duke energy', 'dominion energy',
  'national grid', 'dte energy', 'consumers energy', 'eversource',

  // Insurance
  'insurance', 'geico', 'progressive', 'state farm', 'allstate', 'nationwide',
  'travelers', 'liberty mutual', 'farmers', 'usaa', 'aaa', 'cigna', 'aetna',
  'humana', 'blue cross', 'bluecross', 'united health', 'oscar health',

  // Fitness & wellness
  'gym', 'fitness', 'planet fitness', 'la fitness', 'equinox', 'anytime fitness',
  '24 hour fitness', 'crunch', 'gold\'s gym', 'ymca', 'peloton', 'classpass',

  // Software & cloud
  'adobe', 'microsoft', 'office 365', 'microsoft 365', 'dropbox', 'icloud',
  'google one', 'google storage', 'google workspace', 'github', 'notion',
  'slack', 'zoom', 'figma', 'canva', 'grammarly', 'lastpass', '1password',
  'nordvpn', 'expressvpn', 'surfshark', 'malwarebytes', 'norton', 'mcafee',

  // Finance & banking
  'credit card', 'card payment', 'loan payment', 'mortgage', 'rent', 'lease',
  'minimum payment', 'autopay', 'auto pay',

  // News & education
  'nytimes', 'new york times', 'wsj', 'wall street journal', 'washington post',
  'the atlantic', 'medium', 'substack', 'duolingo', 'coursera', 'udemy',
  'skillshare', 'masterclass', 'chegg',

  // Subscriptions (generic)
  'subscription', 'monthly fee', 'annual fee', 'membership', 'renewal',
];

// ─── Category allow-list: Supabase category_name values that indicate bills ───

const SUBSCRIPTION_CATEGORIES = new Set([
  'bills', 'subscriptions', 'utilities', 'insurance', 'phone', 'internet',
  'rent', 'mortgage', 'health', 'fitness', 'software', 'streaming',
  'telecom', 'loan', 'finance',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeMerchant(raw) {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[#*]\w*\d+\w*/g, '')   // strip ref IDs like #12345
    .replace(/\d{4,}/g, '')          // strip long digit runs
    .replace(/[^\w\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(str) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function amountsMatch(a, b) {
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return true;
  return Math.abs(a - b) / max <= AMOUNT_TOLERANCE;
}

function daysBetween(dateA, dateB) {
  return (new Date(dateB) - new Date(dateA)) / 86_400_000;
}

/** Check if the merchant name or category signals a subscription/bill. */
function isLikelySubscription(description, categoryName) {
  // Category match is the strongest signal
  const cat = (categoryName || '').toLowerCase().trim();
  if (SUBSCRIPTION_CATEGORIES.has(cat)) return true;

  // Keyword match against description
  const desc = normalizeMerchant(description || categoryName || '');
  return SUBSCRIPTION_KEYWORDS.some(kw => desc.includes(kw));
}

/** Day-of-month check: all charges must land within ±DAY_OF_MONTH_TOL of each other. */
function sameDayOfMonth(txs) {
  const days = txs.map(t => new Date(t.date).getDate());
  const min  = Math.min(...days);
  const max  = Math.max(...days);
  // Handle month-end wrapping (e.g. charge on 28th sometimes hits 30th)
  return (max - min) <= DAY_OF_MONTH_TOL;
}

// ─── Main detection ───────────────────────────────────────────────────────────

export function detectRecurringCharges(transactions) {
  const now    = new Date();
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

  // Step 1: filter — real expenses above $10 in the lookback window
  const expenses = transactions.filter(t =>
    t.type === 'expense'
    && t.category_name !== 'Transfer'
    && Math.abs(Number(t.amount)) >= MIN_AMOUNT
    && new Date(t.date) >= cutoff
  );

  // Step 2: group by normalized merchant name
  const byMerchant = {};
  for (const t of expenses) {
    const key = normalizeMerchant(t.description || t.category_name || '');
    if (!key || key.length < 2) continue;
    (byMerchant[key] ??= []).push(t);
  }

  const upcoming = [];

  for (const [key, txs] of Object.entries(byMerchant)) {
    if (txs.length < MIN_OCCURRENCES) continue;

    // Step 3: subscription/bill filter — skip casual merchants
    const sample = txs[0];
    if (!isLikelySubscription(sample.description, sample.category_name)) continue;

    const sorted = [...txs].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Step 4: cluster by amount ±2%
    const clusters = [];
    for (const tx of sorted) {
      const amt = Math.abs(Number(tx.amount));
      let placed = false;
      for (const c of clusters) {
        if (amountsMatch(c.ref, amt)) {
          c.txs.push(tx);
          c.ref = c.txs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0) / c.txs.length;
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ ref: amt, txs: [tx] });
    }

    for (const cluster of clusters) {
      if (cluster.txs.length < MIN_OCCURRENCES) continue;

      const cs = [...cluster.txs].sort((a, b) => new Date(a.date) - new Date(b.date));

      // Step 5: interval check — all gaps must be ~30 days
      const gaps = [];
      for (let i = 1; i < cs.length; i++) {
        gaps.push(daysBetween(cs[i - 1].date, cs[i].date));
      }
      const allGapsValid = gaps.every(
        g => g >= INTERVAL_TARGET - INTERVAL_TOLERANCE
          && g <= INTERVAL_TARGET + INTERVAL_TOLERANCE
      );
      if (!allGapsValid) continue;

      // Step 6: day-of-month consistency — charges must hit on roughly the same date
      if (!sameDayOfMonth(cs)) continue;

      // Step 7: project next charge
      const avgGap    = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const lastTx    = cs[cs.length - 1];
      const nextDate  = new Date(new Date(lastTx.date).getTime() + avgGap * 86_400_000);
      const daysUntil = Math.round((nextDate.getTime() - now.getTime()) / 86_400_000);

      if (daysUntil < 0 || daysUntil > UPCOMING_DAYS) continue;

      const rawName     = lastTx.description || lastTx.category_name || key;
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

  // Sort by urgency, cap at MAX_RESULTS
  const sorted = upcoming.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, MAX_RESULTS);

  // Return empty if fewer than MIN_CONFIRMED confirmed — hide the section entirely
  return sorted.length >= MIN_CONFIRMED ? sorted : [];
}
