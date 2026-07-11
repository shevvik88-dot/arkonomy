// src/utils/recurringSummary.js
// Pure extract of Insights.jsx's RecurringSummary classification logic —
// used both for rendering (Insights.jsx) and for the ai-chat financialContext
// (App.jsx), so there's one recurring-payments source, not two.
//
// Groups transactions by merchant across calendar months — only flags a
// merchant if seen in 2+ distinct months. Subscriptions: <$100/mo, amount
// consistent (spread <= $0.50). Regular Payments: >=$100/mo fixed bills,
// spread tolerance scales with amount (utilities/insurance vary slightly).

import { parseDate } from "./helpers";

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

export function computeRecurringSummary(transactions) {
  const map = {};
  transactions
    .filter(t => t.type === "expense" && t.category_name !== "Transfer")
    .forEach(t => {
      const raw = (t.description || t.category_name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!raw || raw.length < 3) return;
      const d = parseDate(t.date);
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
      if (!map[raw]) map[raw] = { name: t.description || t.category_name || raw, months: new Set(), amounts: [], total: 0 };
      map[raw].months.add(monthKey);
      map[raw].amounts.push(Number(t.amount));
      map[raw].total += Number(t.amount);
    });

  const candidates = Object.values(map)
    .filter(m => m.months.size >= 2 && !isRecurringExcluded(m.name))
    .map(m => {
      const sorted = m.amounts.slice().sort((a, b) => a - b);
      const spread = sorted[sorted.length - 1] - sorted[0];
      return { name: m.name, months: m.months.size, avgMonthly: m.total / m.months.size, spread };
    })
    .sort((a, b) => b.avgMonthly - a.avgMonthly);

  // Subscriptions: consistent amount (spread <= $0.50) and under $100/mo
  const subscriptions   = candidates.filter(m => m.avgMonthly <  100 && m.spread <= 0.50);
  // Regular Payments: >= $100/mo fixed bills — allow up to $10 spread for utilities/insurance
  // that may vary slightly, but reject wildly variable retail/variable spend
  const regularPayments = candidates.filter(m => m.avgMonthly >= 100 && m.spread <= Math.max(10, m.avgMonthly * 0.10));

  const subTotal     = subscriptions.reduce((s, m)   => s + m.avgMonthly, 0);
  const regularTotal = regularPayments.reduce((s, m) => s + m.avgMonthly, 0);

  return { subscriptions, regularPayments, subTotal, regularTotal };
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
