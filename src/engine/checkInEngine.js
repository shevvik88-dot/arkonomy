// checkInEngine.js
// Pure logic — no UI dependencies. Import into any React Native component.

const TOTAL_DAYS = 30;

// ── UPCOMING CHARGES STATE ────────────────────────────────────────────────────
// Highest-priority state — overrides all budget signals when recurring charges
// are due within 7 days. Added via the `upcomingCharges` param in getCheckIn.
// Shape of each charge: { merchant, amount, daysUntil, expectedDate }
export const UPCOMING_CHARGES_PRIORITY = 110; // above all other signals

// ── STEP 1: METRICS ──────────────────────────────────────────────────────────
export function calcMetrics(spent, budget, income, savingsRate, day, spikePct, catSpend) {
  const spentRatio       = budget > 0 ? spent / budget : 0;
  const daysPassedRatio  = day / TOTAL_DAYS;
  const expectedSpend    = budget * daysPassedRatio;
  const paceRatio        = expectedSpend > 0 ? spent / expectedSpend : 0;
  const remainingBudget  = budget - spent;
  const daysLeft         = Math.max(0, TOTAL_DAYS - day);
  const rawDaily         = daysLeft > 0 ? remainingBudget / daysLeft : 0;
  const hasData          = spent > 0;
  const overBy           = Math.max(0, spent - budget);
  const baseConfidence   = day <= 5 ? 'low' : day <= 15 ? 'medium' : 'high';
  const catMeaningful    = catSpend >= budget * 0.05;
  const dailyNatural     = (budget / TOTAL_DAYS) * 2;
  const dailyAllowed     = Math.max(0, Math.round(rawDaily / 5) * 5);
  const dailyUsesSoft    = rawDaily < 15 || rawDaily > dailyNatural;
  const projectedEnd     = daysPassedRatio > 0 ? spent / daysPassedRatio : 0;
  const projectedOver    = Math.max(0, Math.round(projectedEnd - budget));
  const projOverRealistic = projectedOver <= budget * 2;

  const safePossible = spent < budget
    && remainingBudget > budget * 0.1
    && baseConfidence === 'high'
    && daysLeft >= 5
    && projectedEnd < budget;

  const tf      = Math.max(0.4, day / TOTAL_DAYS);
  const safeMin = safePossible ? Math.max(0, Math.round(remainingBudget * 0.3 * tf)) : 0;
  const safeMax = safePossible
    ? Math.max(0, Math.min(Math.round(remainingBudget * 0.6 * tf), Math.round(income * 0.2)))
    : 0;

  return {
    spentRatio, daysPassedRatio, expectedSpend, paceRatio,
    remainingBudget, daysLeft, dailyAllowed, dailyUsesSoft,
    hasData, overBy, baseConfidence, catMeaningful,
    safePossible, safeMin, safeMax,
    projectedEnd: Math.round(projectedEnd),
    projectedOver, projOverRealistic,
    spentPct: (spentRatio * 100).toFixed(1),
    pacePct:  Math.round(Math.abs(paceRatio - 1) * 100),
  };
}

// ── STEP 2: STATE ─────────────────────────────────────────────────────────────
// Warning states — never show reassuring helper labels
export const WARNING_STATES = new Set([
  'CRITICAL', 'DANGER', 'NEEDS_ATTENTION', 'WATCH_CATEGORY', 'UPCOMING_CHARGES',
]);

export function determineState(m, spent, budget, day, spikePct) {
  const { baseConfidence, spentRatio, paceRatio, hasData, catMeaningful, remainingBudget } = m;

  if (!hasData || (spent < 50 && day <= 3))                                   return 'NO_DATA';
  if (spent >= budget || remainingBudget <= 0)                                return 'CRITICAL';

  if (baseConfidence === 'low') {
    const dt = Math.max(budget * 0.15, 300);
    if (paceRatio > 1.3 && spent > dt)                                        return 'DANGER';
    return 'EARLY_STABLE';
  }

  const dt = Math.max(budget * 0.15, 300);
  if (paceRatio > 1.3 && day <= 10 && spent > dt)                            return 'DANGER';
  if (day >= 20 && spentRatio >= 0.90 && spent < budget)                     return 'NEEDS_ATTENTION';
  if (day >= 10 && spikePct >= 100 && catMeaningful)                         return 'WATCH_CATEGORY';
  if (day < 10)                                                               return 'EARLY_STABLE';
  if (day >= 15 && paceRatio < 0.70 && spentRatio < 0.7
      && baseConfidence === 'high')                                           return 'STRONG_PROGRESS';
  if (day >= 10 && hasData)                                                   return 'ON_TRACK';

  return 'EARLY_STABLE';
}

// ── STEP 3: CONTENT ───────────────────────────────────────────────────────────
export function buildContent(state, m, spent, budget, income, day, spikePct, cat) {
  const {
    daysLeft, dailyAllowed, dailyUsesSoft, spentPct, pacePct, overBy,
    baseConfidence, safeMin, safeMax, safePossible,
    catMeaningful, projectedOver, projOverRealistic,
  } = m;

  // CRITICAL always shows high confidence
  const confidence  = state === 'CRITICAL' ? 'high' : baseConfidence;
  const endOfMonth  = daysLeft <= 2;
  const isWarning   = WARNING_STATES.has(state);
  const safeOk      = safePossible && state === 'STRONG_PROGRESS';

  const actionPace = dailyUsesSoft
    ? 'Try to reduce daily spending over the next few days.'
    : `Keep daily spending around $${dailyAllowed} to get back on track.`;
  const actionBudget = dailyUsesSoft
    ? 'Reduce spending over the next few days to stay within budget.'
    : `Keep daily spending around $${dailyAllowed} to stay within budget.`;

  const catOk = spikePct >= 100 && catMeaningful && day >= 10
    && ['ON_TRACK', 'STRONG_PROGRESS'].includes(state);
  const catNote = catOk
    ? `${cat} is ${spikePct}% above your usual level — worth monitoring.`
    : null;

  const projText = projOverRealistic
    ? `At this pace, you're on track to overspend by about $${projectedOver} this month.`
    : `At this pace, you're likely to significantly exceed your budget.`;

  // Early label: only for non-warning states
  const earlyLabel = !isWarning && (confidence === 'low' || confidence === 'medium')
    ? 'Early month — insights will improve as more data comes in.'
    : null;

  switch (state) {

    case 'NO_DATA':
      return {
        insight:    'Not enough data yet. Check back once you\'ve recorded some spending.',
        projection: null, action: null, secondary: null, timeCtx: null,
        showSafe: false, safeMin: 0, safeMax: 0, safeHint: '',
        earlyLabel: null, confidence,
      };

    case 'EARLY_STABLE':
      return {
        insight:    'It\'s too early to draw conclusions, but your spending is within a healthy range so far.',
        projection: null, action: null, secondary: null, timeCtx: null,
        showSafe: false, safeMin: 0, safeMax: 0, safeHint: '',
        earlyLabel: 'Early month — insights will improve as more data comes in.',
        confidence,
      };

    case 'CRITICAL':
      return {
        insight:    `You've exceeded your $${budget.toLocaleString()} budget by $${overBy.toLocaleString()}.`,
        projection: !endOfMonth ? projText : null,
        action:     endOfMonth
          ? 'The month is almost over. Stick to essentials only.'
          : 'Focus on essential spending only for the rest of the month.',
        secondary:  null,
        timeCtx:    daysLeft > 0
          ? `You have ${daysLeft} days remaining.`
          : 'Today is the last day of the month.',
        showSafe: false, safeMin: 0, safeMax: 0, safeHint: '',
        earlyLabel: null, confidence,
      };

    case 'DANGER': {
      const softTone    = baseConfidence === 'low';
      const dangerHelper = softTone
        ? 'Based on limited data so far, your spending is higher than expected.'
        : null;
      return {
        insight:    softTone
          ? 'Early spending is higher than usual. Monitor closely over the next few days.'
          : `Spending is ${pacePct}% ahead of where you'd normally be at this point.`,
        projection: (!softTone && !endOfMonth)
          ? 'At your current pace, you may exceed your budget before month-end.'
          : null,
        action:     softTone ? null : actionPace,
        secondary:  (!softTone && spikePct >= 100 && catMeaningful)
          ? `${cat} may be contributing to this.` : null,
        timeCtx:    daysLeft > 0 ? `You have ${daysLeft} days remaining.` : null,
        showSafe: false, safeMin: 0, safeMax: 0, safeHint: '',
        earlyLabel: dangerHelper, confidence,
      };
    }

    case 'NEEDS_ATTENTION':
      return {
        insight:    endOfMonth
          ? `You've used ${spentPct}% of your budget. The month is nearly over.`
          : `You've used ${spentPct}% of your budget with ${daysLeft} days to go.`,
        projection: endOfMonth
          ? null
          : 'At your current pace, you may exceed your budget before month-end.',
        action:     endOfMonth
          ? 'Stick to essential spending for the final days.'
          : actionBudget,
        secondary: null, timeCtx: null,
        showSafe: false, safeMin: 0, safeMax: 0, safeHint: '',
        earlyLabel: null, confidence,
      };

    case 'WATCH_CATEGORY':
      return {
        insight:   `${cat} is ${spikePct}% above your normal pattern for this point in the month.`,
        projection: null,
        action:    `Try to reduce ${cat.toLowerCase()} spending over the next few days.`,
        secondary: null, timeCtx: null,
        showSafe: false, safeMin: 0, safeMax: 0, safeHint: '',
        earlyLabel: null, confidence,
      };

    case 'UPCOMING_CHARGES': {
      // upcomingCharges are passed through the state; content built in getCheckIn
      const count = m._upcomingCount || 1;
      const total = m._upcomingTotal || 0;
      return {
        insight:    `${count} recurring charge${count > 1 ? 's' : ''} expected in the next 7 days — totalling $${total.toFixed(2)}.`,
        projection: 'Make sure you have enough balance to cover these automatic payments.',
        action:     'Review your upcoming charges and confirm you have sufficient funds.',
        secondary:  null, timeCtx: null,
        showSafe: false, safeMin: 0, safeMax: 0, safeHint: '',
        earlyLabel: null, confidence,
      };
    }

    case 'STRONG_PROGRESS':
      return {
        insight:   'You\'re well below your planned spending for this point in the month.',
        projection: null,
        action:    'At this pace, you may be able to save even more.',
        secondary: catNote, timeCtx: null,
        showSafe: safeOk, safeMin, safeMax,
        safeHint: 'Based on your current spending pattern',
        earlyLabel, confidence,
      };

    default: // ON_TRACK
      return {
        insight:   'You\'re on track with your spending this month.',
        projection: null, action: null,
        secondary: catNote, timeCtx: null,
        showSafe: false, safeMin: 0, safeMax: 0, safeHint: '',
        earlyLabel, confidence,
      };
  }
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────
// Single entry point — call this from your component.
// Optional `upcomingCharges` array from recurringDetector — when provided and
// non-empty, UPCOMING_CHARGES state takes highest priority over all others.
export function getCheckIn({ spent, budget, income, savingsRate, day, spikePct, catSpend, cat, upcomingCharges = [] }) {
  const m     = calcMetrics(spent, budget, income, savingsRate, day, spikePct, catSpend);

  // Inject upcoming charge metadata so buildContent can reference it
  if (upcomingCharges.length > 0) {
    m._upcomingCount = upcomingCharges.length;
    m._upcomingTotal = upcomingCharges.reduce((s, c) => s + c.amount, 0);
  }

  const state  = upcomingCharges.length > 0
    ? 'UPCOMING_CHARGES'
    : determineState(m, spent, budget, day, spikePct);

  const content = buildContent(state, m, spent, budget, income, day, spikePct, cat);
  return { state, ...content, upcomingCharges };
}
