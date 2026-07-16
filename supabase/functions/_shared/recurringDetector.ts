// supabase/functions/_shared/recurringDetector.ts
//
// Ported from src/utils/recurringSummary.js's computeRecurringSummary /
// getUpcomingCharges (the client-side single source of truth for recurring-
// payment detection, including merchant_aliases-aware merging). Deno edge
// functions cannot import from src/, so this file must be kept in sync BY
// HAND whenever recurringSummary.js changes — that's a hard platform
// constraint, not an oversight.
//
// Intentionally left out of this port (not needed by get-insights, the only
// current consumer of this file):
//   - cleanMerchantName — client-only display-formatting helper; get-insights
//     only ever consumes `.amount`, never surfaces `.merchant` to the user.
//   - findDuplicateSubscriptions / findMerchantAliasCandidates /
//     getUpcomingCardPayments — not consumed here.
//
// Expected transaction shape: { date, amount, type, description, category_name }
// Output shape (getUpcomingCharges): [{ merchant, amount, daysUntil, expectedDate, category }]

const STALE_MULTIPLIER = 2;
const MIN_STALE_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function median(nums: number[]): number {
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
function isRecurringExcluded(name: string): boolean {
  const n = " " + name.toLowerCase() + " ";
  if (/ shell /.test(n)) return true;
  return RECURRING_EXCLUDE.some(k => n.includes(k));
}

// Follows an alias chain to its final canonical key (aliasMap entries can
// point to another alias_key rather than the true final canonical — e.g. a
// 3rd bank descriptor variant confirmed against the 2nd, which was itself
// confirmed against the 1st). Cycle-guarded, though real data never cycles.
function resolveAlias(key: string, aliasMap: Map<string, string>): string {
  let resolved = key;
  for (let hops = 0; aliasMap.has(resolved) && hops < 10; hops++) {
    resolved = aliasMap.get(resolved)!;
  }
  return resolved;
}

interface MerchantGroup {
  key: string;
  name: string;
  category: string;
  months: Set<string>;
  monthDates: Record<string, Date>;
  amounts: number[];
  total: number;
  firstDate: Date;
  lastDate: Date;
}

// Groups transactions by normalized merchant description. aliasMap (raw key
// -> canonical raw key, from user-confirmed merchant_aliases) is applied
// before bucketing, so confirmed aliases merge into one group. The bucket's
// displayed .name always tracks the MOST RECENT transaction's description —
// important once merging is involved, since a merged group can contain 2-3
// different bank descriptions over time.
function groupTransactionsByMerchant(transactions: any[], aliasMap: Map<string, string> = new Map()): Map<string, MerchantGroup> {
  // Map, not a plain object — groupKey comes from a bank-controlled transaction
  // description, and a description that normalizes to "constructor" would collide
  // with Object.prototype on a plain object (silently returns the inherited
  // constructor function instead of undefined, corrupting the group).
  const map = new Map<string, MerchantGroup>();
  transactions
    .filter(t => t.type === "expense" && t.category_name !== "Transfer")
    .forEach(t => {
      const raw = (t.description || t.category_name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!raw || raw.length < 3) return;
      const groupKey = resolveAlias(raw, aliasMap);
      // Parse "YYYY-MM-DD" as LOCAL midnight, not UTC — a plain `new Date(dateStr)`
      // can roll back to the previous calendar day in negative-UTC-offset timezones.
      // Mirrors src/utils/helpers.js's parseDate().
      const d = new Date(t.date + "T00:00:00");
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
      const displayName = t.description || t.category_name || raw;
      if (!map.has(groupKey)) map.set(groupKey, { key: groupKey, name: displayName, category: t.category_name, months: new Set(), monthDates: {}, amounts: [], total: 0, firstDate: d, lastDate: d });
      const g = map.get(groupKey)!;
      g.months.add(monthKey);
      g.amounts.push(Number(t.amount));
      g.total += Number(t.amount);
      if (!g.monthDates[monthKey] || d > g.monthDates[monthKey]) g.monthDates[monthKey] = d;
      if (d > g.lastDate) { g.lastDate = d; g.name = displayName; g.category = t.category_name; }
      if (d < g.firstDate) g.firstDate = d;
    });
  return map;
}

interface RecurringCandidate {
  name: string;
  category: string;
  months: number;
  avgMonthly: number;
  spread: number;
  lastSeenDate: Date;
  typicalIntervalDays: number;
  daysSinceLast: number;
  possiblyCancelled: boolean;
}

export function computeRecurringSummary(transactions: any[], referenceDate: Date = new Date(), aliasMap: Map<string, string> = new Map()) {
  const map = groupTransactionsByMerchant(transactions, aliasMap);

  const candidates: RecurringCandidate[] = Array.from(map.values())
    .filter(m => m.months.size >= 2 && !isRecurringExcluded(m.name))
    .map(m => {
      const sorted = m.amounts.slice().sort((a, b) => a - b);
      const spread = sorted[sorted.length - 1] - sorted[0];
      const monthDatesSorted = Object.values(m.monthDates).sort((a, b) => a.getTime() - b.getTime());
      const gaps = monthDatesSorted.slice(1).map((d, i) => (d.getTime() - monthDatesSorted[i].getTime()) / MS_PER_DAY);
      const typicalIntervalDays = median(gaps);
      const daysSinceLast = Math.round((referenceDate.getTime() - m.lastDate.getTime()) / MS_PER_DAY);
      const staleThreshold = Math.max(MIN_STALE_DAYS, typicalIntervalDays * STALE_MULTIPLIER);
      return {
        name: m.name,
        category: m.category,
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

// Projects the next occurrence of a recurring charge: lastDate + intervalDays,
// advanced past todayStart if the projection has already lapsed.
function projectNextDate(lastDate: Date, intervalDays: number, todayStart: Date): Date {
  let nextDate = new Date(lastDate.getTime() + intervalDays * MS_PER_DAY);
  while (nextDate < todayStart) nextDate = new Date(nextDate.getTime() + intervalDays * MS_PER_DAY);
  return nextDate;
}

function formatDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Upcoming charges projection ─────────────────────────────────────────────
// Single source for "what recurring bill is due next and when". Projects
// nextDate = lastSeenDate + typicalIntervalDays (same math as the staleness
// check, run forward instead of backward). Only considers active merchants
// (computeRecurringSummary already excludes possiblyCancelled).
export function getUpcomingCharges(
  transactions: any[],
  aliasMap: Map<string, string> = new Map(),
  referenceDate: Date = new Date(),
  { maxDays = 14, maxResults = 4 }: { maxDays?: number; maxResults?: number } = {},
) {
  const { subscriptions, regularPayments } = computeRecurringSummary(transactions, referenceDate, aliasMap);
  const todayStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());

  const upcoming = [...subscriptions, ...regularPayments].map(m => {
    const nextDate = projectNextDate(m.lastSeenDate, m.typicalIntervalDays, todayStart);
    const daysUntil = Math.round((nextDate.getTime() - referenceDate.getTime()) / MS_PER_DAY);
    return {
      // NOTE: intentionally the raw grouped merchant name, not cleanMerchantName-ed —
      // no current consumer of this function displays .merchant to the user
      // (get-insights only sums .amount).
      merchant: m.name,
      amount: Math.round(m.avgMonthly * 100) / 100,
      daysUntil,
      expectedDate: formatDateStr(nextDate),
      category: m.category || "Bills",
    };
  }).filter(c => c.daysUntil >= 0 && c.daysUntil <= maxDays);

  return upcoming.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, maxResults);
}
