// src/utils/recurringSummary.js
// Pure extract of Insights.jsx's RecurringSummary classification logic —
// used both for rendering (Insights.jsx) and for the ai-chat financialContext
// (App.jsx), so there's one recurring-payments source, not two.
//
// Groups transactions by merchant across calendar months — only flags a
// merchant if seen in 2+ distinct months. Subscriptions: <$100/mo, amount
// consistent (spread <= $0.50). Regular Payments: >=$100/mo fixed bills,
// spread tolerance scales with amount (utilities/insurance vary slightly).
//
// Merchants whose last charge is stale relative to their own billing cadence
// (2x the typical gap between charges, floor 45 days) are moved to
// possiblyCancelled instead of subscriptions/regularPayments, so a cancelled
// subscription doesn't keep inflating totals just because it was seen twice
// months ago.
//
// aliasMap (from the merchant_aliases table, user-confirmed) lets two
// differently-worded bank descriptions of the same real-world payment
// (e.g. a bank changing its ACH descriptor) be grouped as one merchant
// instead of two — see findMerchantAliasCandidates below for how matches
// are suggested (never auto-merged).

import { parseDate } from "./helpers";

const STALE_MULTIPLIER = 2;
const MIN_STALE_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ALIAS_AMOUNT_TOLERANCE_PCT = 0.02;
const MIN_ALIAS_AMOUNT_TOLERANCE = 0.50;
const ALIAS_GAP_MULTIPLIER = 2;
const MIN_ALIAS_GAP_DAYS = 45;
const DEFAULT_ALIAS_INTERVAL_DAYS = 35; // fallback when neither group has 2+ occurrences of its own

function median(nums) {
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Keywords that disqualify a merchant from appearing in either section.
// Uses word-boundary padding (" name ") to avoid false partial matches.
const RECURRING_EXCLUDE = [
  // Credit card / bank payments
  "card payment","ccpymt","credit card","card online","online des:payment",
  "mobile banking","online banking","online payment","payment to ",
  // Person-to-person transfers
  "zelle","venmo","cash app","paypal",
  // Groceries & wholesale
  "trader joe","walmart","costco","grocery","grocer","supermarket",
  "safeway","kroger","albertsons","publix","aldi","whole food","sprouts",
  "target","ralphs","vons","heb ","wegman","meijer","food lion","giant",
  "stop & shop","stop and shop","price chopper","winco","fresh market",
  "grocery outlet","smart & final","piggly","food 4 less","save mart",
  // Pharmacies — variable amounts, not subscriptions
  "cvs","walgreen","rite aid","duane reade","eckerd","health mart","kinney drug",
  // General retail
  "home depot","dollar tree","dollar general","dollar store",
  "petsmart","petco","jcpenny","jcpenney","marshalls","tj maxx","ross store",
  "big lots","five below","amazon","best buy","gamestop","kohl","macy","nordstrom",
  "bath & body","bath and body","gap ","old navy","h&m ","zara ","victoria","sephora","ulta",
  // Restaurants & fast food
  "mcdonald","starbucks","chipotle","dunkin","taco bell","wendy",
  "burger king","pizza hut","domino","restaurant","bistro","diner",
  "chick-fil","subway ","panera","sonic ","in-n-out","five guys",
  // Gas stations
  "chevron","exxon","mobil","arco","fuel","bp ","valero","circle k",
  "sunoco","speedway","76 ","phillips 66","murphy","quiktrip","wawa",
  "racetrac","casey","pilot ","flying j","loves travel",
];

// Shell matches too broadly with padding, check it as a whole-word match separately
function isRecurringExcluded(name) {
  const n = " " + name.toLowerCase() + " ";
  if (/ shell /.test(n)) return true;
  return RECURRING_EXCLUDE.some(k => n.includes(k));
}

// Follows an alias chain to its final canonical key (aliasMap entries can
// point to another alias_key rather than the true final canonical — e.g. a
// 3rd bank descriptor variant confirmed against the 2nd, which was itself
// confirmed against the 1st). Cycle-guarded, though real data never cycles.
function resolveAlias(key, aliasMap) {
  let resolved = key;
  for (let hops = 0; aliasMap.has(resolved) && hops < 10; hops++) {
    resolved = aliasMap.get(resolved);
  }
  return resolved;
}

// Groups transactions by normalized merchant description. aliasMap (raw key
// -> canonical raw key, from user-confirmed merchant_aliases) is applied
// before bucketing, so confirmed aliases merge into one group. The bucket's
// displayed .name always tracks the MOST RECENT transaction's description —
// important once merging is involved, since a merged group can contain 2-3
// different bank descriptions over time.
function groupTransactionsByMerchant(transactions, aliasMap = new Map()) {
  const map = {};
  transactions
    .filter(t => t.type === "expense" && t.category_name !== "Transfer")
    .forEach(t => {
      const raw = (t.description || t.category_name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!raw || raw.length < 3) return;
      const groupKey = resolveAlias(raw, aliasMap);
      const d = parseDate(t.date);
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
      const displayName = t.description || t.category_name || raw;
      if (!map[groupKey]) map[groupKey] = { key: groupKey, name: displayName, months: new Set(), monthDates: {}, amounts: [], total: 0, firstDate: d, lastDate: d };
      const g = map[groupKey];
      g.months.add(monthKey);
      g.amounts.push(Number(t.amount));
      g.total += Number(t.amount);
      if (!g.monthDates[monthKey] || d > g.monthDates[monthKey]) g.monthDates[monthKey] = d;
      if (d > g.lastDate) { g.lastDate = d; g.name = displayName; }
      if (d < g.firstDate) g.firstDate = d;
    });
  return map;
}

export function computeRecurringSummary(transactions, referenceDate = new Date(), aliasMap = new Map()) {
  const map = groupTransactionsByMerchant(transactions, aliasMap);

  const candidates = Object.values(map)
    .filter(m => m.months.size >= 2 && !isRecurringExcluded(m.name))
    .map(m => {
      const sorted = m.amounts.slice().sort((a, b) => a - b);
      const spread = sorted[sorted.length - 1] - sorted[0];
      const monthDatesSorted = Object.values(m.monthDates).sort((a, b) => a - b);
      const gaps = monthDatesSorted.slice(1).map((d, i) => (d - monthDatesSorted[i]) / MS_PER_DAY);
      const typicalIntervalDays = median(gaps);
      const daysSinceLast = Math.round((referenceDate - m.lastDate) / MS_PER_DAY);
      const staleThreshold = Math.max(MIN_STALE_DAYS, typicalIntervalDays * STALE_MULTIPLIER);
      return {
        name: m.name,
        months: m.months.size,
        avgMonthly: m.total / m.months.size,
        spread,
        lastSeenDate: m.lastDate,
        typicalIntervalDays: Math.round(typicalIntervalDays),
        daysSinceLast,
        possiblyCancelled: daysSinceLast > staleThreshold,
      };
    })
    .sort((a, b) => b.avgMonthly - a.avgMonthly);

  const active = candidates.filter(m => !m.possiblyCancelled);
  const possiblyCancelled = candidates.filter(m => m.possiblyCancelled).sort((a, b) => b.daysSinceLast - a.daysSinceLast);

  // Subscriptions: consistent amount (spread <= $0.50) and under $100/mo
  const subscriptions   = active.filter(m => m.avgMonthly <  100 && m.spread <= 0.50);
  // Regular Payments: >= $100/mo fixed bills — allow up to $10 spread for utilities/insurance
  // that may vary slightly, but reject wildly variable retail/variable spend
  const regularPayments = active.filter(m => m.avgMonthly >= 100 && m.spread <= Math.max(10, m.avgMonthly * 0.10));

  const subTotal     = subscriptions.reduce((s, m)   => s + m.avgMonthly, 0);
  const regularTotal = regularPayments.reduce((s, m) => s + m.avgMonthly, 0);

  return { subscriptions, regularPayments, subTotal, regularTotal, possiblyCancelled };
}

// ── Duplicate / overlapping subscription detection ─────────────────────────
// Only flags 2+ DISTINCT brands within the same conceptual category (e.g.
// Claude + OpenAI — both "AI assistant") — never 2+ payments that merely
// share a generic word. Two different insurance policies (Dental + Renters)
// are NOT a duplicate — there's no "Insurance" category here on purpose,
// since holding multiple insurance types is normal, not overlapping.

const DUPLICATE_CATEGORIES = {
  'AI assistant':    ['claude', 'openai', 'chatgpt', 'gemini', 'perplexity', 'copilot'],
  'Cloud storage':   ['dropbox', 'icloud', 'google one', 'google storage', 'onedrive'],
  'Video streaming': ['netflix', 'hulu', 'disney', 'hbo', 'max', 'peacock', 'paramount', 'prime video'],
  'Music streaming': ['spotify', 'apple music', 'tidal', 'youtube music', 'pandora'],
  'Fitness':         ['planet fitness', 'la fitness', 'equinox', 'anytime fitness', '24 hour fitness', 'crunch', 'golds gym', 'ymca', 'peloton', 'classpass'],
  'News & media':    ['nytimes', 'new york times', 'wsj', 'wall street journal', 'washington post', 'the atlantic', 'medium', 'substack'],
};

export function findDuplicateSubscriptions(subscriptions) {
  // category -> brandKeyword -> matched subscription rows
  const byCategory = {};

  for (const sub of subscriptions) {
    const lower = sub.name.toLowerCase();
    for (const [category, keywords] of Object.entries(DUPLICATE_CATEGORIES)) {
      const matchedKeyword = keywords.find(kw => lower.includes(kw));
      if (matchedKeyword) {
        byCategory[category] ??= new Map();
        if (!byCategory[category].has(matchedKeyword)) byCategory[category].set(matchedKeyword, []);
        byCategory[category].get(matchedKeyword).push(sub);
        break; // a subscription belongs to at most one category
      }
    }
  }

  const duplicates = [];
  for (const [category, brandMap] of Object.entries(byCategory)) {
    if (brandMap.size < 2) continue; // need 2+ DISTINCT brands, not just 2+ line items
    const items = [...brandMap.values()].flat();
    duplicates.push({
      category,
      items: items.map(s => ({ name: s.name, amount: Math.round(s.avgMonthly) })),
    });
  }
  return duplicates;
}

// ── Merchant-alias candidate detection ──────────────────────────────────────
// Suggests pairs of raw merchant groups that are LIKELY the same real-world
// payment under two different bank descriptions (e.g. a landlord's rent
// showing as "Turbotenant" for months, then "Sheviakov" after the bank
// changes its ACH descriptor). Never auto-merges — only surfaces candidates
// for the user to confirm or reject via the merchant_aliases table. A pair
// must be: similar amount, non-overlapping in time (one group's activity
// fully precedes the other's — a clean handoff, not two concurrent
// subscriptions), and the gap between them plausible for a missed-or-renamed
// billing cycle, not a coincidental one-off match.
export function findMerchantAliasCandidates(transactions, existingAliases = []) {
  const map = groupTransactionsByMerchant(transactions);
  const groups = Object.values(map)
    .filter(m => !isRecurringExcluded(m.name))
    .map(m => {
      const sorted = m.amounts.slice().sort((x, y) => x - y);
      const avgAmount = m.total / m.months.size;
      const spread = sorted[sorted.length - 1] - sorted[0];
      return { ...m, avgAmount, spread };
    });

  const decided = new Set();
  existingAliases.forEach(a => {
    decided.add(`${a.alias_key}::${a.canonical_key}`);
    decided.add(`${a.canonical_key}::${a.alias_key}`);
  });

  function intervalFor(m) {
    const monthDatesSorted = Object.values(m.monthDates).sort((x, y) => x - y);
    if (monthDatesSorted.length < 2) return null;
    const gaps = monthDatesSorted.slice(1).map((d, i) => (d - monthDatesSorted[i]) / MS_PER_DAY);
    return median(gaps);
  }

  // A group only counts as "already looks like a real bill" if it's been
  // seen 2+ months AND its amount is consistent (same bar as subscriptions/
  // regularPayments) — a one-off or wildly-varying merchant that happens to
  // land near another's amount by chance is not evidence of a handoff.
  function isBillLike(m) {
    if (m.months.size < 2) return false;
    return m.spread <= (m.avgAmount < 100 ? 0.50 : Math.max(10, m.avgAmount * 0.10));
  }

  const candidates = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      if (decided.has(`${a.key}::${b.key}`)) continue;
      // at least one side must already look like a consistent, established
      // bill on its own — otherwise this is just two unrelated charges
      // that happen to be close in amount, not a real descriptor handoff
      if (!isBillLike(a) && !isBillLike(b)) continue;

      const amountTolerance = Math.max(MIN_ALIAS_AMOUNT_TOLERANCE, Math.max(a.avgAmount, b.avgAmount) * ALIAS_AMOUNT_TOLERANCE_PCT);
      if (Math.abs(a.avgAmount - b.avgAmount) > amountTolerance) continue;

      let earlier, later;
      if (a.lastDate <= b.firstDate) { earlier = a; later = b; }
      else if (b.lastDate <= a.firstDate) { earlier = b; later = a; }
      else continue; // overlapping activity — likely two genuinely concurrent merchants, not a descriptor handoff

      const gapDays = (later.firstDate - earlier.lastDate) / MS_PER_DAY;
      const referenceInterval = intervalFor(later) ?? intervalFor(earlier) ?? DEFAULT_ALIAS_INTERVAL_DAYS;
      const gapThreshold = Math.max(MIN_ALIAS_GAP_DAYS, referenceInterval * ALIAS_GAP_MULTIPLIER);
      if (gapDays > gapThreshold) continue;

      const relativeAmountDiff = Math.abs(a.avgAmount - b.avgAmount) / Math.max(a.avgAmount, b.avgAmount, 1);
      candidates.push({
        older: { key: earlier.key, name: earlier.name, amount: Math.round(earlier.avgAmount * 100) / 100, lastSeen: earlier.lastDate, months: earlier.months.size },
        newer: { key: later.key, name: later.name, amount: Math.round(later.avgAmount * 100) / 100, firstSeen: later.firstDate, months: later.months.size },
        relativeAmountDiff,
        gapDays,
      });
    }
  }
  // Tightest amount match first, then shortest gap — surfaces the most
  // plausible handoffs first since amount+timing alone can't fully rule out
  // coincidental matches on common round-dollar amounts ($20, $5, $3...).
  return candidates.sort((x, y) => x.relativeAmountDiff - y.relativeAmountDiff || x.gapDays - y.gapDays);
}
