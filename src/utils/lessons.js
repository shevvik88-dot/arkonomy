// Today's Lesson — static curated content + streak logic.
//
// v1 scope, deliberate: English only. Real financial-education prose in 4
// languages (en/ru/es/pt) for 12+ lessons is its own content-authoring pass,
// not bundled into this one — flagged in CLAUDE.md Known issues, not a
// silent gap. Chrome text around the lesson (row label, sheet header, streak
// caption) IS localized via the normal translation.json keys; only the
// lesson body/tip stays English for now.
//
// No AI call for personalization — reuses whatever the caller already
// computed (spendingByCategory, cashPositionLow, upcomingCharges), same
// "one relevant real fact in a static template sentence" pattern as
// AhaMoment.jsx, deliberately not a live LLM call on every open.

export const LESSONS = [
  {
    id: "emergency-fund",
    category: "Saving",
    title: "Why an emergency fund comes first",
    body: [
      "Before extra debt payoff or investing, most financial plans start with a small cash buffer — enough to cover a surprise car repair or a missed paycheck without reaching for a credit card.",
      "A common starting target is $500–$1,000, then building toward 3 months of essential expenses over time. It doesn't need to happen this month — it needs to start.",
    ],
    tip: "If you don't have a buffer yet, even $25/week adds up to a real cushion in a few months.",
  },
  {
    id: "needs-vs-wants",
    category: "Budgeting",
    title: "Needs vs. wants — the 50/30/20 split",
    body: [
      "One simple budgeting frame: roughly 50% of income to needs (rent, groceries, utilities), 30% to wants (dining out, subscriptions, hobbies), 20% to savings and debt payoff.",
      "It's a starting ratio, not a rule — the useful part is naming which category each expense actually falls into, since 'wants' quietly disguised as 'needs' is where most budgets leak.",
    ],
    tip: "Pick your 3 biggest expenses this month and honestly sort each into need or want.",
  },
  {
    id: "credit-utilization",
    category: "Credit",
    title: "How credit utilization affects your score",
    body: [
      "Credit utilization — the % of your credit limit you're currently using — is one of the biggest factors in your credit score, right after payment history.",
      "Staying under 30% utilization is a common guideline; under 10% is even better if you can manage it. This resets every statement cycle, so a temporary spike isn't permanent — but a sustained high balance is.",
    ],
    tip: "Paying a card down mid-cycle (not just by the due date) can lower the utilization that actually gets reported.",
  },
  {
    id: "debt-payoff-order",
    category: "Debt",
    title: "Avalanche vs. snowball: which debt to pay first",
    body: [
      "Avalanche method: pay minimums on everything, throw extra at the highest-interest debt first. Mathematically optimal — saves the most money over time.",
      "Snowball method: pay off the smallest balance first, regardless of interest rate. Costs a bit more in interest, but the quick wins keep people motivated to keep going.",
    ],
    tip: "Neither is wrong — pick the one you'll actually stick with for the next 12 months.",
  },
  {
    id: "subscription-creep",
    category: "Spending",
    title: "Why subscriptions quietly add up",
    body: [
      "A single $12/mo subscription doesn't feel like much. Five of them is $60/mo — $720/year — often for services barely used, because each one alone feels too small to cancel.",
      "The fix isn't cutting everything — it's a periodic honest review: which of these did you actually open or use in the last 30 days?",
    ],
    tip: "Once a quarter, scan your Subscriptions list and ask 'would I sign up for this again today?'",
  },
  {
    id: "cash-flow-forecast",
    category: "Planning",
    title: "Reading your cash flow forecast",
    body: [
      "A cash flow forecast projects your balance forward based on known income and upcoming bills — it answers 'will I have enough on the 28th', not just 'what do I have right now'.",
      "It's only as good as what feeds it: a forecast that doesn't know about a big one-time bill will look falsely healthy right up until that bill hits.",
    ],
    tip: "Add one-off payments you already know are coming — the forecast can only account for what it's told.",
  },
  {
    id: "net-worth",
    category: "Planning",
    title: "What 'net worth' actually means",
    body: [
      "Net worth = everything you own (cash, investments, property) minus everything you owe (debt, credit card balances, loans). It's a snapshot, not a judgment.",
      "Income tells you what's coming in; net worth tells you what's actually accumulating. A high earner with high debt can have a lower net worth than a modest earner who saves consistently.",
    ],
    tip: "Net worth can be negative early on (student loans, a new mortgage) — the trend over time matters more than any single number.",
  },
  {
    id: "pay-yourself-first",
    category: "Saving",
    title: "Automating savings: pay yourself first",
    body: [
      "The classic failure mode: pay every bill, spend what's left, save whatever happens to remain — which is usually nothing.",
      "Flipping the order — an automatic transfer to savings right when income arrives, before anything else — treats saving like a fixed bill instead of an afterthought.",
    ],
    tip: "Even a small automatic transfer beats a large manual one you keep meaning to make.",
  },
  {
    id: "high-yield-savings",
    category: "Saving",
    title: "High-yield savings vs. a regular checking account",
    body: [
      "Money sitting in a standard checking account often earns close to 0% interest. A high-yield savings account can pay meaningfully more, with no added risk — it's still cash, just parked somewhere that pays for holding it.",
      "The tradeoff is usually a slightly less convenient transfer (1–2 business days), which is exactly why it's a good place for money you don't need to touch daily.",
    ],
    tip: "Money you won't need for 30+ days is usually better off out of a 0%-interest checking account.",
  },
  {
    id: "credit-card-apr",
    category: "Credit",
    title: "Understanding APR on credit cards",
    body: [
      "APR (Annual Percentage Rate) is the cost of carrying a balance, expressed as a yearly rate — but it's charged monthly on whatever you don't pay off.",
      "If you pay your statement balance in full every month, APR rarely matters — most cards charge zero interest during that grace period. It only bites once a balance carries over.",
    ],
    tip: "Paying in full each month makes the APR number on your card essentially irrelevant to you.",
  },
  {
    id: "diversification",
    category: "Investing",
    title: "Diversification basics",
    body: [
      "Diversification means spreading money across different investments so no single company or sector can sink the whole portfolio if it has a bad year.",
      "A broad index fund already holds hundreds of companies — one of the simplest ways to get diversification without picking individual winners yourself.",
    ],
    tip: "If one holding is more than a small slice of your total portfolio, that's a concentration risk worth being aware of.",
  },
  {
    id: "realistic-budget",
    category: "Budgeting",
    title: "Building a budget that survives real life",
    body: [
      "A budget that assumes zero surprises for 12 straight months will break the first month something unusual happens — a budget's job is to absorb that, not pretend it won't occur.",
      "Building in a small 'miscellaneous/buffer' category for the inevitable one-off expense makes the rest of the budget more honest, not less disciplined.",
    ],
    tip: "A budget you actually follow for 3 months beats a perfect one you abandon in week two.",
  },
];

// Same day → same lesson for everyone, no DB round-trip needed to pick
// content. Midnight-normalized per project convention (never new Date()
// directly for day-boundary math).
export function getTodaysLesson(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYear = new Date(midnight.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((midnight - startOfYear) / 86400000);
  return LESSONS[dayOfYear % LESSONS.length];
}

// Pure streak-transition function — no I/O, easy to test.
// lastCompletedDate: 'YYYY-MM-DD' string or null/undefined (never completed).
export function computeNextStreak(lastCompletedDate, currentStreak, now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = midnight.toISOString().slice(0, 10);
  if (lastCompletedDate === todayStr) {
    return { streak: currentStreak, alreadyCompletedToday: true, lastCompletedDate: todayStr };
  }
  const yesterday = new Date(midnight);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const nextStreak = lastCompletedDate === yesterdayStr ? currentStreak + 1 : 1;
  return { streak: nextStreak, alreadyCompletedToday: false, lastCompletedDate: todayStr };
}

// One relevant real fact, in priority order — same "pick the single most
// useful signal" approach as AhaMoment.jsx, reusing data the caller already
// computed (no new fetch, no AI call). Returns null if nothing fires.
export function getPersonalizedLessonNote({ cashPositionLow, upcomingCharges = [], spendingByCategory = {} } = {}) {
  if (cashPositionLow) {
    // Was hardcoded to claim "today's lesson on cash flow forecasting" —
    // false whenever the actual lesson (picked independently by day-of-year)
    // isn't that one. Same neutral "see if it connects" phrasing as the
    // topCategory branch below, no specific topic claim.
    return "Heads up — your projected balance is running tight this month. See if today's lesson connects.";
  }
  const nearest = upcomingCharges[0];
  if (nearest && nearest.amount >= 100) {
    return `You have a $${Math.round(nearest.amount)} charge coming up soon — worth keeping in mind while you read.`;
  }
  const topCategory = Object.entries(spendingByCategory).sort((a, b) => b[1] - a[1])[0];
  if (topCategory && topCategory[1] > 0) {
    return `${topCategory[0]} is your top spending category this month — see if today's lesson connects.`;
  }
  return null;
}
