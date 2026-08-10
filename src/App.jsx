// arkonomy v1
import { logger } from "./utils/logger";
// Single source of truth for colors — src/utils/colors.js, same as the
// other 6 screens. Local C (below) is now built by spreading this, plus
// one deliberately App.jsx-local field (trialEndedAccent) — no hardcoded
// duplicate values left here. Aliased since the file also has its own
// local `const C` derived from it (name collision otherwise).
import { C as sharedC, RADIUS, DASHBOARD_C as DC } from "./utils/colors";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePostHog } from "@posthog/react";
import { useTranslation } from "react-i18next";
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "./utils/supabase";
import { callEdgeFunction } from "./lib/callEdgeFunction";
import { getCachedAccounts, setCachedAccounts, clearAccountsCache, sumDepositoryBalance, getCreditAccounts } from "./utils/accountsCache";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { usePlaidOAuth, PLAID_REDIRECT_URI } from "./hooks/usePlaidOAuth";
import CheckInCard from "./components/CheckInCard";
import UpgradeModal from "./components/UpgradeModal";
import UpcomingChargesCard from "./components/UpcomingChargesCard";
import { usePlan } from "./hooks/usePlan";
import { usePushNotifications } from "./hooks/usePushNotifications";
import { calculateHealthScore, generateHealthComment, getScoreLabel } from "./healthScore";
import { BUFFER } from "./shared/financialConstants";
import { IS_IOS_NATIVE } from "./lib/platform";
import { useUSStorefront } from "./lib/storefront";
import { computeRecurringSummary, findDuplicateSubscriptions, getUpcomingCharges, getUpcomingCardPayments } from "./utils/recurringSummary";
import { computeNextStreak } from "./utils/lessons";
import GlassCard from "./components/shared/GlassCard";
import AuthScreen from "./components/AuthScreen";
import Icon from "./components/shared/Icon";
import PlaidLinkButton from "./components/shared/PlaidLinkButton";
import OnboardingFlow, { TutorialOverlay, HelpButton, TUTORIAL_STEPS, MINI_TOURS } from "./components/OnboardingFlow";
import BottomNav from "./components/BottomNav";
import Chat, { CHAT_SUGGESTIONS_BY_SCREEN } from "./components/Chat";
import Profile from "./components/Profile";
import Markets from "./components/Markets";
import Savings from "./components/Savings";
import Transactions, { AddTransactionModal, useToasts, ToastStack, fmtMoney } from "./components/Transactions";
import { cleanMerchantName, sumAmounts } from "./utils/helpers";
import Insights, { InsightCard } from "./components/Insights";
import Dashboard from "./components/Dashboard";

// ─── AI Brain: useInsights hook ───────────────────────────────
function useInsights(screen, userId, lang) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    callEdgeFunction("get-insights", { userId, lang: lang ?? "en" })
      .then(result => {
        if (!mounted) return;
        if (result?.error) { logger.error("useInsights error:", result.error); return; }
        setData(result);
      });
    return () => { mounted = false; };
  }, [userId, lang]);

  if (!data) return { insight: null, allInsights: [], aiContext: null };

  const insight = screen === "insights"
    ? data.screens?.insights?.[0] ?? null
    : data.screens?.[screen] ?? null;

  return {
    insight,
    allInsights: data.screens?.insights ?? [],
    aiContext: data.screens?.ai ?? null,
  };
}

// Home's Upcoming Charges carousel — same merge Dashboard's Cash Flow
// Forecast/Month Calendar already do (getUpcomingCharges + getUpcomingCardPayments),
// re-sorted and capped to the carousel's top-4 after merging.
function getUpcomingChargesForCarousel(transactions, aliasMap) {
  const referenceDate = new Date();
  return [
    ...getUpcomingCharges(transactions, aliasMap, referenceDate, { maxDays: 14, maxResults: Infinity }),
    ...getUpcomingCardPayments(transactions, aliasMap, referenceDate, { maxDays: 14, maxResults: Infinity }),
  ].sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 4);
}


const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
document.head.appendChild(fontLink);

const APP_VERSION = "1.0.1";
const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

// ── Sync staleness ────────────────────────────────────────────────────────────
const SYNC_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function isSyncStale(lastSyncedAt) {
  if (!lastSyncedAt) return true;
  return Date.now() - new Date(lastSyncedAt).getTime() > SYNC_CACHE_TTL;
}

// Alpaca OAuth — redirect URI points to the Supabase edge function which
// exchanges the code for tokens and then redirects back to https://app.arkonomy.com
const ALPACA_CLIENT_ID    = import.meta.env.VITE_ALPACA_CLIENT_ID ?? "";
const ALPACA_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/alpaca-oauth-callback`;
function alpacaOAuthUrl(nonce) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     ALPACA_CLIENT_ID,
    redirect_uri:  ALPACA_REDIRECT_URI,
    scope:         "account:write trading",
    // Opaque, single-use, short-TTL nonce from alpaca-oauth-start — not the
    // user's JWT, which would otherwise travel through Alpaca's access logs,
    // browser history, and Referer headers as a live bearer credential.
    state:         nonce,
  });
  return `https://app.alpaca.markets/oauth/authorize?${params}`;
}


// bg/card/border/text/etc. now come from the shared palette (colors.js) —
// faint changes value here as a result: was #4A5E7A locally, shared value
// is #8BA1B7 (the only field that actually drifted; everything else was
// already byte-identical to the shared object).
const C = {
  ...sharedC,
  // Trial-ended icon accent — local, one-off value, nothing else in this
  // file (or elsewhere) needs to stay in sync with it, unlike proAccent/
  // alpacaAccent (also from sharedC). Same hex coincidentally appears in
  // Markets.jsx as C.nonUsTickerWarning — unrelated feature, not merged.
  trialEndedAccent: "#F5A623",
};


function fmt(n, decimals = 2) {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Keyword-based category guesser — used as fallback when no category is assigned
function guessCategory(description, type = "expense") {
  if (!description) return null;
  const d = description.toLowerCase();
  if (type === "income") {
    if (/salary|payroll|direct.?deposit|wages|paycheck/.test(d)) return "Salary";
    if (/freelance|consulting|contract|self.?employ/.test(d)) return "Freelance";
    if (/refund|reimburs|cashback|cash.?back/.test(d)) return "Refund";
    return null;
  }
  // Transfers first — always exclude from spending
  if (/transfer|zelle|venmo|paypal|cash.?app|wire|ach|atm |atm$|cash withdrawal|teller|check cashing/.test(d)) return "Transfer";
  // Housing
  if (/rent|lease|mortgage|apartment|hoa|homeowner|property mgmt|management fee/.test(d)) return "Housing";
  // Food
  if (/grocery|groceries|supermarket|walmart|target|costco|trader.?joe|whole.?food|safeway|kroger|aldi|publix|h\.e\.b|wegman|food.?4.?less|sprouts|fresh market/.test(d)) return "Food & Dining";
  if (/restaurant|mcdonald|burger.?king|pizza|subway|starbucks|chipotle|taco.?bell|wendy|dunkin|chick.?fil|panera|doordash|ubereats|uber.?eats|grubhub|postmates|instacart|coffee|cafe|diner|bistro|sushi|grill|tavern|bbq|bakery|deli/.test(d)) return "Food & Dining";
  // Transport
  if (/uber|lyft|taxi|cab |parking|gas.?station|shell|chevron|exxon|bp |mobil|fuel|transit|metro|train|bus |amtrak|airline|delta|united|southwest|spirit|jetblue|toll |sunpass|fastrak|automobile|auto.?repair|mechanic|jiffy.?lube|oil.?change/.test(d)) return "Transport";
  // Travel
  if (/hotel|airbnb|vrbo|expedia|booking\.com|hotels\.com|marriott|hilton|hyatt|radisson|hampton.?inn|rental.?car|hertz|enterprise.?rent|avis|budget.?rent/.test(d)) return "Travel";
  // Subscriptions/streaming
  if (/netflix|hulu|spotify|disney\+|amazon.?prime|apple.?tv|youtube.?premium|hbo|peacock|paramount\+|subscription|crunchyroll|tidal|siriusxm|pandora/.test(d)) return "Subscriptions";
  // Health
  if (/doctor|physician|hospital|pharmacy|cvs|walgreens|rite.?aid|medical|dental|vision|health.?insur|urgent.?care|clinic|therapist|counseling|optometrist|youtalk|talkspace|betterhelp|cerebral|headspace|calm\.com|hims|hers|noom/.test(d)) return "Health";
  // Utilities
  if (/electric|electricity|water.?bill|sewer|gas.?bill|utility|at&t|verizon|t-mobile|sprint|comcast|xfinity|spectrum|internet|phone.?bill|pge|pg&e|sdge/.test(d)) return "Utilities";
  // Shopping
  if (/amazon|ebay|etsy|best.?buy|apple.?store|nike|zara|h&m|nordstrom|gap |old.?navy|macy|target\.com|walmart\.com|wayfair|shein|temu|wish\.com|shopify/.test(d)) return "Shopping";
  // Health & Fitness
  if (/gym|fitness|planet.?fitness|equinox|crossfit|yoga|peloton|24.?hour|la.?fitness|anytime.?fitness|crunch.?fitness/.test(d)) return "Health & Fitness";
  // Entertainment
  if (/movie|cinema|theater|concert|ticketmaster|stubhub|steam|playstation|xbox|gaming|regal|amc.?theater|bowling|mini.?golf|arcade/.test(d)) return "Entertainment";
  // Personal Care
  if (/salon|barber|spa |nail |massage|haircut|waxing|great.?clips|supercuts|beauty.?supply|ulta|sephora|laundry|dry.?clean/.test(d)) return "Personal Care";
  // Education
  if (/tuition|university|college|student.?loan|udemy|coursera|skillshare|school|chegg|duolingo|masterclass/.test(d)) return "Education";
  // Taxes
  if (/irs |tax.?payment|tax.?service|h&r.?block|turbotax|taxact|franchise.?tax|state.?tax|federal.?tax/.test(d)) return "Taxes";
  // Government
  if (/dmv |department.?of|dept.?of|county.?of|city.?of|government|postal.?service|usps|court.?fee|traffic.?fine|parking.?ticket/.test(d)) return "Government";
  // Charity
  if (/donation|charity|nonprofit|non.?profit|church|temple|mosque|synagogue|red.?cross|goodwill|salvation.?army|habitat.?for.?humanity/.test(d)) return "Charity";
  // Fees
  if (/\bfee\b|service.?charge|annual.?charge|late.?fee|overdraft|account.?fee|maintenance.?fee|foreign.?transaction/.test(d)) return "Fees";
  // Cost of Debt — interest charges, loan interest, finance charges
  if (/interest.?charge|credit.?card.?interest|finance.?charge|interest.?payment|loan.?interest|interest.?on.?loan|minimum.?payment|accrued.?interest/.test(d)) return "Cost of Debt";
  // Bills/insurance (catch-all)
  if (/insurance|geico|state.?farm|progressive|allstate|travelers|liberty.?mutual|farmers.?insur|usaa/.test(d)) return "Bills";
  return null;
}

// Re-categorize transactions at display time via keyword matching.
// Module-level so Dashboard and App both use identical logic for chart & breakdown.
function resolveCategory(t) {
  const raw = t.category_name;
  const desc = (t.description || '').toLowerCase();

  // Peer-to-peer transfers: visible in chart, counted in spending (unlike bank "Transfer").
  // Plaid can classify Zelle rent payments as RENT_AND_UTILITIES → Housing, which
  // would double-count rent. Override unconditionally to the visible "Transfers" category.
  if (/\bzelle\b|\bvenmo\b/.test(desc)) return 'Transfers';

  if (!raw || raw === 'Other') {
    const guessed = guessCategory(t.description, t.type);
    if (guessed && guessed !== 'Transfer') return guessed;
  }
  return raw || 'Other';
}

// Parse a YYYY-MM-DD date string in LOCAL time (not UTC).
// new Date("2026-04-11") is parsed as UTC midnight, which shifts to the
// previous day for any UTC+ timezone. Appending T00:00:00 forces local time.
function timeAgo(iso) {
  if (!iso) return null;
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  return new Date(dateStr + "T00:00:00");
}

function localDateString(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function fmtDate(dateStr) {
  return parseDate(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}




// AuthScreen moved to src/components/AuthScreen.jsx


// ─── Dynamic first suggestion for dashboard screen ───────────
function buildFirstDashboardSuggestion({ spendingByCategory, prevSpendingByCategory, transactions, balance, upcomingCharges }) {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth(), daysInMonth)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // 1. Duplicate charges — same merchant + amount, 2+ times within 7 days this month
  const thisMonthExp = transactions.filter(t => {
    const d = new Date(t.date);
    return t.type === 'expense'
      && d.getMonth() === now.getMonth()
      && d.getFullYear() === now.getFullYear();
  });
  const dupGroups = {};
  for (const t of thisMonthExp) {
    const k = `${(t.description || '').toLowerCase().trim()}|${Math.round(Number(t.amount))}`;
    (dupGroups[k] = dupGroups[k] || []).push(new Date(t.date).getTime());
  }
  for (const [key, timestamps] of Object.entries(dupGroups)) {
    if (timestamps.length >= 2) {
      const sorted = timestamps.slice().sort((a, b) => a - b);
      if ((sorted[sorted.length - 1] - sorted[0]) / 86400000 <= 7) {
        const desc = key.split('|')[0];
        const name = cleanMerchantName(desc) || desc;
        if (name) return `Review duplicate charges at ${name}`;
      }
    }
  }

  // 2. Category significantly over last month (largest absolute delta > $100)
  let topCat = null, topDelta = 100;
  for (const [cat, amt] of Object.entries(spendingByCategory)) {
    if (cat === 'Transfer' || cat === 'Transfers' || cat === 'Income') continue;
    const delta = amt - (prevSpendingByCategory[cat] || 0);
    if (delta > topDelta) { topDelta = delta; topCat = cat; }
  }
  if (topCat) return `Why is ${topCat} up $${Math.round(topDelta)} this month?`;

  // 3. Cash flow at risk or deficit
  if (dayOfMonth >= 2) {
    const monthSpend = sumAmounts(
      thisMonthExp.filter(t => t.category_name !== 'Transfer' && t.category_name !== 'Transfers')
    );
    const dailyRate = monthSpend / Math.max(dayOfMonth - 1, 1);
    const upcomingTotal = (upcomingCharges || []).reduce((s, c) => s + Number(c.amount), 0);
    const projected = balance - dailyRate * (daysInMonth - dayOfMonth) - upcomingTotal;
    if (projected <= 0) return `How can I avoid a deficit by ${endOfMonth}?`;
    if (balance > 0 && projected / balance < 0.12) return `My cash flow is at risk by ${endOfMonth} — what should I do?`;
  }

  // 4. Default
  return "How much can I save this week?";
}

// ─── Context-aware chat greeting ─────────────────────────────
function buildContextGreeting(screen, { totalIncome, totalSpent, spendingByCategory, savings, transactions, profile, allInsights, healthScore }) {
  const balance    = totalIncome - totalSpent;
  const balSign    = balance >= 0 ? '+' : '-';
  const balStr     = `${balSign}$${fmt(Math.abs(balance), 0)}`;
  const topCat     = Object.entries(spendingByCategory).sort((a, b) => b[1] - a[1])[0];

  switch (screen) {
    case 'dashboard': {
      const catPart = topCat ? `, with ${topCat[0]} as your biggest category at $${fmt(topCat[1], 0)}` : '';
      return `I can see you're on the Dashboard — your cash flow this month is ${balStr}${catPart}. What would you like to dig into?`;
    }

    case 'transactions': {
      const now = new Date();
      const monthExpenses = transactions.filter(t => {
        const d = new Date(t.date);
        return t.type === 'expense' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.category_name !== 'Transfer';
      });
      const count = monthExpenses.length;
      const catPart = topCat ? ` Top category: ${topCat[0]} ($${fmt(topCat[1], 0)}).` : '';
      return `I can see you're on the Transactions screen — you have ${count} expense${count !== 1 ? 's' : ''} this month totaling $${fmt(totalSpent, 0)}.${catPart} Want me to help analyze your spending?`;
    }

    case 'markets': {
      const watchlist = (profile?.watchlist ?? ['SPY', 'QQQ', 'BTC', 'ETH']).slice(0, 4);
      return `I can see you're on the Markets screen — you're watching ${watchlist.join(', ')}. Ask me about any ticker, get a market outlook, or I can help you decide what to invest in.`;
    }

    case 'savings': {
      const totalSaved = savings.reduce((s, sv) => s + Number(sv.current), 0);
      if (savings.length === 0) {
        return `I can see you're on the Savings screen — you haven't set up any goals yet. Want me to help you create a savings plan?`;
      }
      if (savings.length === 1) {
        const sv = savings[0];
        const pct = sv.target > 0 ? Math.round((sv.current / sv.target) * 100) : 0;
        return `I can see you're on the Savings screen — you have $${fmt(sv.current, 0)} saved toward your ${sv.name} goal of $${fmt(sv.target, 0)} (${pct}% there). Want me to help you make a plan?`;
      }
      const onTrack = savings.filter(sv => sv.target > 0 && Number(sv.current) / Number(sv.target) >= 0.5).length;
      return `I can see you're on the Savings screen — you have ${savings.length} goals with $${fmt(totalSaved, 0)} saved in total, ${onTrack} of them at least halfway there. Want help prioritizing or accelerating any goal?`;
    }

    case 'insights': {
      const scoreStr = healthScore != null ? `your financial health score is ${healthScore}/100` : 'your financial insights are ready';
      const topInsight = allInsights?.[0];
      const insightPart = topInsight?.title ? ` Your top insight: "${topInsight.title}".` : '';
      return `I can see you're on the Insights screen — ${scoreStr}.${insightPart} What would you like to understand or improve?`;
    }

    default:
      return `Hi! I'm your Arkonomy AI assistant. Ask me anything about your finances.`;
  }
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const posthog = usePostHog();
  const { t, i18n } = useTranslation();
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [savings, setSavings] = useState([]);
  const [merchantAliases, setMerchantAliases] = useState([]);
  const [scheduledPayments, setScheduledPayments] = useState([]);
  const [lessonStreak, setLessonStreak] = useState({ current_streak: 0, last_completed_date: null });
  const [loading, setLoading] = useState(true);
  const [showAddTx, setShowAddTx] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [catFilter, setCatFilter] = useState(null);
  const [merchantFilter, setMerchantFilter] = useState(null);
  const [dateFilter, setDateFilter] = useState(null);
  const [chatMessages, setChatMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem('arkonomy_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [{ role: "assistant", text: "Hi! I'm your Arkonomy AI assistant. Ask me anything about your finances." }];
  });
  const [chatInput, setChatInput] = useState("");
  const [autopilot, setAutopilot] = useState(() => {
    try {
      const saved = localStorage.getItem("arkonomy_autopilot");
      if (saved) return { overspendAlerts: true, largeTxAlerts: true, unusualSpending: true, largeTxThreshold: 200, lowBalanceAlerts: true, lowBalanceThreshold: 500, ...JSON.parse(saved) };
    } catch {}
    return { overspendAlerts: true, largeTxAlerts: true, unusualSpending: true, largeTxThreshold: 200, lowBalanceAlerts: true, lowBalanceThreshold: 500 };
  });
  const { toasts: alertToasts, show: showAlert, dismiss: dismissAlert } = useToasts();
  // Refs keep addTransaction (async) from using stale closures after awaits
  const showAlertRef = useRef(showAlert);
  showAlertRef.current = showAlert;
  // Stable ref to syncBankTransactions so onPlaidSuccess (useCallback [])
  // always calls the current version, not the mount-time stale closure.
  const syncBankTransactionsRef = useRef(null);
  const autopilotRef = useRef(autopilot);
  autopilotRef.current = autopilot;

  // ─── Plaid state ──────────────────────────────────────────────
  const [linkToken, setLinkToken] = useState(null);
  const [bankConnected, setBankConnected] = useState(false);
  const [bankName, setBankName] = useState(null);
  const [bankCount, setBankCount] = useState(0);
  const [syncingBank, setSyncingBank] = useState(false);
  const [alpacaToast, setAlpacaToast] = useState(null);
  const [alpacaConnected, setAlpacaConnected] = useState(false);
  const [roundupEnabled, setRoundupEnabled]   = useState(false);
  const [alpacaDisclosureUrl, setAlpacaDisclosureUrl] = useState(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showLeavingAppSheet, setShowLeavingAppSheet] = useState(false);
  const [showTrialExpiredModal, setShowTrialExpiredModal] = useState(false);
  const [proToast, setProToast] = useState(false);
  const [showChat, setShowChat]     = useState(false);
  const [chatDragY, setChatDragY]   = useState(0);
  const chatDragStart     = useRef(0);
  const chatDragStartX    = useRef(0);
  const chatDragging      = useRef(false);
  const chatContainerRef  = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(68);
  const headerRef = useRef(null);
  const [seenInsightCount, setSeenInsightCount] = useState(() => {
    try { return JSON.parse(localStorage.getItem('arkonomy_insights_seen') || '{}').count ?? 0; }
    catch { return 0; }
  });
  const [onboardingDone, setOnboardingDone] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("trial_started") === "true") {
        localStorage.setItem("arkonomy_onboarding_done", "1");
        return true;
      }
      if (params.get("reset_onboarding") === "1") {
        localStorage.removeItem("arkonomy_onboarding_done");
        return false;
      }
      return !!localStorage.getItem("arkonomy_onboarding_done");
    } catch { return false; }
  });
  const [trialCancelled, setTrialCancelled] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("trial_cancelled") === "true"; }
    catch { return false; }
  });
  const [upcomingCharges, setUpcomingCharges] = useState([]);
  const [marketInitSymbol, setMarketInitSymbol] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(() => {
    try { return localStorage.getItem("arkonomy_last_synced") || null; } catch { return null; }
  });
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const bgSyncRef = useRef(null);
  const bgSyncLockRef = useRef(false);
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialStepIdx, setTutorialStepIdx] = useState(0);
  const [activeTourSteps, setActiveTourSteps] = useState(TUTORIAL_STEPS);
  const tutorialStartedRef = useRef(false);
  const [idleBubble, setIdleBubble] = useState(null);
  const idleTimerRef = useRef(null);
  const idleDismissRef = useRef(null);
  const showChatRef = useRef(false);
  const alpacaToastTimerRef = useRef(null);

  const { isPro, isTrial, trialDaysLeft, trialExpired } = usePlan(profile);
  // Real Upgrade UI/flow on iOS only for US App Store storefront users (per
  // the April 2025 Epic v. Apple ruling on Guideline 3.1.3 anti-steering);
  // every other iOS storefront keeps the fully-suppressed behavior.
  const isUSStorefront = useUSStorefront();
  const showRealUpgrade = !IS_IOS_NATIVE || isUSStorefront;
  useEffect(() => { if (trialExpired) setShowTrialExpiredModal(true); }, [trialExpired]);

  useEffect(() => {
    if (!langOpen) return;
    function handleClick(e) { if (langRef.current && !langRef.current.contains(e.target)) setLangOpen(false); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [langOpen]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user ?? null); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (user) { clearAccountsCache(); loadAll(); checkBankConnection(); } }, [user]);

  // Android back button: navigate to dashboard instead of closing the app
  useEffect(() => {
    let handler;
    CapApp.addListener("backButton", ({ canGoBack }) => {
      if (showChat) { setShowChat(false); return; }
      if (screen !== "dashboard") { setScreen("dashboard"); return; }
      // On dashboard with no modals, allow the OS to minimize (do nothing — Android handles it)
    }).then(h => { handler = h; });
    return () => { handler?.remove(); };
  }, [screen, showChat]);

  // Detect return from Stripe checkout or Alpaca OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("upgraded") === "true") {
      posthog?.capture('plan_upgraded');
      setProToast(true);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => { if (user) loadAll(); }, 2000);
      setTimeout(() => setProToast(false), 6000);
    }

    if (params.get("trial_started") === "true") {
      posthog?.capture('trial_started');
      window.history.replaceState({}, "", window.location.pathname);
      setProToast(true);
      setTimeout(() => { if (user) loadAll(); }, 2000);
      setTimeout(() => setProToast(false), 6000);
    }

    if (params.get("trial_cancelled") === "true") {
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (params.get("reset_onboarding") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (params.get("alpaca_connected") === "true") {
      posthog?.capture('alpaca_account_connected');
      window.history.replaceState({}, "", window.location.pathname);
      // Refresh profile to pick up the new alpaca_access_token
      setTimeout(() => { if (user) loadAll(); }, 500);
      setAlpacaToast({ alpacaSuccess: true });
      setTimeout(() => setAlpacaToast(null), 5000);
    }

    if (params.get("alpaca_error")) {
      const errCode = params.get("alpaca_error");
      window.history.replaceState({}, "", window.location.pathname);
      const msgs = {
        missing_code:        "Investment account connection cancelled.",
        token_exchange_failed: "Investment account connection failed — please try again.",
        auth_failed:         "Could not verify your session. Please log in again.",
        server_misconfigured: "Investment account is not configured yet. Contact support.",
        network_error:       "Network error — please try again.",
        db_error:            "Connection succeeded but could not save — please try again.",
      };
      setAlpacaToast({ error: msgs[errCode] ?? "Investment account error. Please try again." });
      setTimeout(() => setAlpacaToast(null), 6000);
    }
  }, []);

  // Register push notifications (no-op until VAPID key is configured)
  usePushNotifications(supabase, user?.id);

  // Persist autopilot toggles across reloads
  useEffect(() => {
    try { localStorage.setItem("arkonomy_autopilot", JSON.stringify(autopilot)); } catch {}
  }, [autopilot]);

  // Auto-sync on load: fires once when bankConnected first becomes true.
  // Staleness check is inside bgSync itself — this just triggers the attempt.
  useEffect(() => {
    if (!bankConnected || !user) return;
    const t = setTimeout(() => bgSyncRef.current?.(), 1500);
    return () => clearTimeout(t);
  }, [bankConnected, user]);

  // Auto-sync every 4 hours
  useEffect(() => {
    if (!bankConnected || !user) return;
    const id = setInterval(() => bgSyncRef.current?.(), 4 * 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [bankConnected, user]);

  // Auto-start tutorial once for users who haven't completed it
  useEffect(() => {
    if (!profile || loading) return;
    if (profile.tutorial_completed) return;
    if (tutorialActive || tutorialStartedRef.current) return;
    const stillOnboarding = !onboardingDone && !isPro;
    if (stillOnboarding) return;
    tutorialStartedRef.current = true;
    setTimeout(() => {
      setActiveTourSteps(TUTORIAL_STEPS);
      setTutorialStepIdx(0);
      setScreen("dashboard");
      setTutorialActive(true);
    }, 900);
  }, [profile, loading, onboardingDone, transactions.length, bankConnected]);

  async function loadAll(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [p, t, c, sv, ma, sp, ls, alpacaCheck] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name, avatar_url, monthly_budget, savings_goal, roundup_enabled, created_at, plan, push_subscription, watchlist, stripe_customer_id, tutorial_completed, last_synced_at, trial_ends_at, trial_web_search_count").eq("id", user.id).single(),
        supabase.from("transactions").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(5000),
        supabase.from("categories").select("*").eq("user_id", user.id),
        supabase.from("savings").select("*").eq("user_id", user.id),
        supabase.from("merchant_aliases").select("*").eq("user_id", user.id),
        supabase.from("scheduled_payments").select("*").eq("user_id", user.id).eq("status", "pending"),
        supabase.from("lesson_streaks").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.rpc("has_alpaca_token"),
      ]);
      if (p.data) {
        setProfile(p.data);
        posthog?.identify(user.id, { plan: p.data.plan });
        setAlpacaConnected(!!alpacaCheck.data);
        setRoundupEnabled(!!p.data.roundup_enabled);
        if (p.data.last_synced_at && !silent) {
          setLastSyncedAt(p.data.last_synced_at);
          try { localStorage.setItem("arkonomy_last_synced", p.data.last_synced_at); } catch {}
        }
        const lang = p.data.preferred_language
          || (() => { try { return localStorage.getItem("arkonomy_language"); } catch { return null; } })()
          || "en";
        if (i18n.language !== lang) {
          i18n.changeLanguage(lang);
          try { localStorage.setItem("arkonomy_language", lang); } catch {}
        }
      }
      if (t.data) {
        setTransactions(t.data);
        setUpcomingCharges(getUpcomingChargesForCarousel(t.data, merchantAliasMap));
      }
      if (sv.data) setSavings(sv.data);
      if (c.data) { setCategories(c.data); if (c.data.length === 0) await seedCategories(); }
      if (ma.data) setMerchantAliases(ma.data);
      if (sp.data) setScheduledPayments(sp.data);
      // No row yet = brand new user, never completed a lesson — keep the
      // useState default (streak 0, last_completed_date null) rather than
      // overwriting with nothing.
      if (ls.data) setLessonStreak(ls.data);
    } catch (err) {
      logger.error("[loadAll] failed:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function checkBankConnection() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data, error } = await supabase.functions.invoke("check-bank-connection", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      if (data?.connected) {
        setBankConnected(true);
        setBankName(data.institution_name);
        setBankCount(data.count ?? 1);
      }
    } catch (err) {
      logger.error("[checkBankConnection] failed:", err);
    }
  }

  async function getReconnectToken() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session");
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/plaid-link-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": SUPABASE_KEY,
          },
          body: JSON.stringify({ mode: "update" }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.link_token) {
        setLinkToken(data.link_token);
      } else {
        throw new Error("Missing link_token in response");
      }
    } catch (err) {
      logger.error("[Plaid] getReconnectToken exception:", err);
      showAlert(err.message || "Could not initiate bank reconnect. Try again.", "danger", "alert-circle");
    }
  }

  async function getLinkToken() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session");
      // Only send redirect_uri in native Capacitor context where deep link
      // OAuth handling is active. In a browser, the URI must be registered
      // in the Plaid Dashboard before it can be used — omitting it lets the
      // web flow work for all banks without that prerequisite.
      const isNative = typeof window !== "undefined" && Boolean(window.Capacitor);
      const body = isNative ? { redirect_uri: PLAID_REDIRECT_URI } : {};
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/plaid-link-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": SUPABASE_KEY,
          },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.link_token) {
        setLinkToken(data.link_token);
      } else {
        throw new Error("Missing link_token in response");
      }
    } catch (err) {
      logger.error("[Plaid] getLinkToken exception:", err);
      showAlert(err.message || "Could not connect to bank service. Try again.", "danger", "alert-circle");
    }
  }

  const onPlaidSuccess = useCallback(async (public_token, metadata) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const exchangeRes = await fetch(
        `${SUPABASE_URL}/functions/v1/plaid-exchange-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": SUPABASE_KEY,
          },
          body: JSON.stringify({
            public_token,
            institution_name: metadata.institution.name,
            institution_id: metadata.institution.institution_id,
          }),
        }
      );
      const exchangeData = await exchangeRes.json();
      if (!exchangeRes.ok || exchangeData.error) {
        logger.error("[Plaid] exchange-token error:", exchangeData);
        showAlertRef.current(exchangeData.error ?? "Bank connection failed", "danger", "alert-circle");
        return;
      }
    } catch (err) {
      logger.error("[Plaid] exchange-token exception:", err);
      showAlertRef.current("Bank connection failed. Try again.", "danger", "alert-circle");
      return;
    }
    setBankConnected(true);
    setBankName(metadata.institution.name);
    setLinkToken(null);
    posthog?.capture('bank_connected', { institution: metadata.institution.name });
    await syncBankTransactionsRef.current();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function syncBankTransactions() {
    setSyncingBank(true);
    clearAccountsCache();
    try {
      const data = await callEdgeFunction("plaid-sync-transactions", {});
      if (data.error) {
        logger.error("[Plaid] sync-transactions error:", data);
      }
      const now = new Date().toISOString();
      setLastSyncedAt(now);
      try { localStorage.setItem("arkonomy_last_synced", now); } catch {}
      await supabase.from("profiles").update({ last_synced_at: now }).eq("id", user.id);
      await loadAll(true); // silent — keep Dashboard mounted, accountBalance must not reset
    } catch (err) {
      logger.error("[Plaid] sync-transactions exception:", err);
      await loadAll(true);
    } finally {
      setSyncingBank(false);
    }
  }
  // Background (silent) sync — always checks 1-hour staleness before hitting Plaid
  async function bgSync() {
    if (bgSyncLockRef.current || syncingBank) return;
    bgSyncLockRef.current = true;

    const { data: profileSnap } = await supabase
      .from("profiles")
      .select("last_synced_at")
      .eq("id", user.id)
      .single();
    const lastTs = profileSnap?.last_synced_at ?? null;
    if (!isSyncStale(lastTs)) {
      bgSyncLockRef.current = false;
      return;
    }

    setBackgroundSyncing(true);
    try {
      const data = await callEdgeFunction("plaid-sync-transactions", {});
      if (!data.error) {
        const now = new Date().toISOString();
        setLastSyncedAt(now);
        try { localStorage.setItem("arkonomy_last_synced", now); } catch {}
        clearAccountsCache();
        await supabase.from("profiles").update({ last_synced_at: now }).eq("id", user.id);
        await loadAll(true);
      }
    } catch {
    } finally {
      setBackgroundSyncing(false);
      bgSyncLockRef.current = false;
    }
  }
  bgSyncRef.current = bgSync;

  // Forces Plaid to re-poll the bank (POST /transactions/refresh) instead of
  // reading its cache like syncBankTransactions/bgSync above. Async on
  // Plaid's side — this call only confirms the request was accepted; the
  // real update lands later via the existing webhook -> sync_item path.
  // Two short delayed re-fetches opportunistically pick it up without
  // requiring the user to manually pull-to-refresh; if the webhook is
  // still slower than that, the next bgSync cycle will catch it anyway.
  async function refreshBalanceNow() {
    setRefreshingBalance(true);
    try {
      const data = await callEdgeFunction("plaid-refresh-balance", {});
      if (data.error === "cooldown") {
        showAlert(t("profile.refresh_balance_cooldown"), "warning", "info");
      } else if (data.error) {
        logger.error("[Plaid] refresh-balance error:", data);
        showAlert(t("profile.refresh_balance_failed"), "danger", "alert-circle");
      } else {
        showAlert(t("profile.refresh_balance_requested"), "success", "repeat");
        setProfile(p => (p ? { ...p, last_balance_refresh_at: new Date().toISOString() } : p));
        clearAccountsCache();
        setTimeout(() => loadAll(true), 15000);
        setTimeout(() => loadAll(true), 45000);
      }
    } catch (err) {
      logger.error("[Plaid] refresh-balance exception:", err);
      showAlert(t("profile.refresh_balance_failed"), "danger", "alert-circle");
    } finally {
      setRefreshingBalance(false);
    }
  }

  async function seedCategories() {
    const defaults = [
      { name: "Food & Dining", icon: "food", color: "#FF6B6B", budget: 600 },
      { name: "Transport", icon: "car", color: "#4ECDC4", budget: 300 },
      { name: "Shopping", icon: "shopping", color: C.amber, budget: 400 },
      { name: "Entertainment", icon: "film", color: "#A78BFA", budget: 200 },
      { name: "Health", icon: "heart", color: "#F472B6", budget: 150 },
      { name: "Bills", icon: "file", color: "#60A5FA", budget: 800 },
    ];
    try {
      const { data } = await supabase.from("categories").insert(defaults.map(d => ({ ...d, user_id: user.id }))).select();
      if (data) setCategories(data);
    } catch (err) {
      logger.error("[seedCategories] failed:", err);
    }
  }

  async function signOut() {
    try {
      posthog?.reset();
      clearAccountsCache();
      localStorage.removeItem('arkonomy_autopilot');
      await supabase.auth.signOut({ scope: 'global' });
    } catch (err) {
      logger.error("[signOut] failed:", err);
    } finally {
      setUser(null); setProfile(null); setTransactions([]); setCategories([]); setSavings([]); setMerchantAliases([]); setScheduledPayments([]);
    }
  }

  async function deleteAccount() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // delete-account now does everything server-side (Stripe subscription
      // cancel, Plaid item/remove, then all rows, then the auth user) — it
      // needs plaid_items/profiles intact to read access_token/stripe_customer_id
      // before anything is deleted, so the client no longer deletes rows itself.
      await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session?.access_token}`,
          "apikey": SUPABASE_KEY,
        }
      });
    } catch (e) {
      if (import.meta.env.DEV) logger.error("[deleteAccount]", e);
    }
    clearAccountsCache();
    await supabase.auth.signOut();
    setUser(null); setProfile(null); setTransactions([]); setCategories([]); setSavings([]); setMerchantAliases([]); setScheduledPayments([]);
  }

  async function addTransaction(tx) {
    try {
      // Auto-assign category from description keywords if none provided
      if (!tx.category_name) {
        const guessed = guessCategory(tx.description, tx.type);
        if (guessed) { tx = { ...tx, category_name: guessed }; }
      }
      const { data, error } = await supabase.from("transactions").insert({ user_id: user.id, ...tx }).select().single();
      if (error) {
        logger.error("[addTransaction] insert failed:", error);
        showAlertRef.current(
          error.code === "22003" ? "Amount is too large — max $99,999,999.99" : "Couldn't save transaction. Try again.",
          "danger", "alert-circle",
        );
        return; // keep the modal open (no finally-close) so the user's input isn't lost
      }
      if (data) {
        // Update state first (pure — no side effects inside the updater)
        setTransactions(prev => [data, ...prev]);

        // ── Alert checks (run outside state updater so showAlert fires reliably) ──
        // autopilotRef.current used instead of autopilot to avoid stale closure after await
        if (tx.type === "expense") {
          const ap = autopilotRef.current;
          const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
          // Use current transactions + newly saved one for accurate totals
          const allTx = [data, ...transactions];
          const monthlyExpenses = sumAmounts(
            allTx.filter(t => {
              if (t.type !== "expense" || new Date(t.date) < monthStart) return false;
              const cat = resolveCategory(t);
              return cat !== "Transfer" && cat !== "Transfers";
            })
          );
          const budget = profile?.monthly_budget || 3000;
          const remaining = budget - monthlyExpenses;


          // Helper: send push via fetch with explicit session JWT (avoids SDK auth edge cases)
          const sendPush = async (payload) => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token ?? SUPABASE_KEY;
              await fetch(`${SUPABASE_URL}/functions/v1/push-notify`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${token}`,
                  "apikey": SUPABASE_KEY,
                },
                body: JSON.stringify({ user_id: user?.id, ...payload }),
              });
            } catch { /* fire-and-forget */ }
          };

          // 1. Large Transaction
          if (ap.largeTxAlerts && Number(tx.amount) > ap.largeTxThreshold) {
            showAlertRef.current(`Large transaction: ${fmtMoney(Number(tx.amount))} added to ${tx.category_name || "Uncategorized"}`, "warning", "alert-circle", true);
            sendPush({ title: "Large Transaction", body: `${fmtMoney(Number(tx.amount))} added to ${tx.category_name || "Uncategorized"}`, icon: "/icon-192.png", tag: "large-tx" });
            // Shared flag with the server-side large-transaction-alert email
            // job — marks this transaction already-notified so that job
            // doesn't also email about it later. Fire-and-forget: a missed
            // update here just means the email job might also alert once,
            // not a correctness issue worth blocking the UI for.
            supabase.from("transactions").update({ large_tx_notified: true }).eq("id", data.id).then(() => {});
          }
          // 2. Overspending Alert
          if (ap.overspendAlerts && monthlyExpenses > budget) {
            showAlertRef.current(`You've exceeded your monthly budget by ${fmtMoney(monthlyExpenses - budget)}`, "danger", "alert-circle", true);
            sendPush({ title: "Budget Exceeded", body: `Monthly spending exceeds your ${fmtMoney(budget)} budget by ${fmtMoney(monthlyExpenses - budget)}`, icon: "/icon-192.png", tag: "budget-exceeded" });
          }
          // 3. Low Balance Alert
          if (ap.lowBalanceAlerts && remaining < ap.lowBalanceThreshold && remaining >= 0) {
            showAlertRef.current(`Low balance warning: ${fmtMoney(remaining)} remaining in budget`, "warning", "dollar", true);
            sendPush({ title: "Low Balance", body: `${fmtMoney(remaining)} remaining in your monthly budget`, icon: "/icon-192.png", tag: "low-balance" });
          }
          // 4. Unusual Spending Alert
          if (ap.unusualSpending && tx.category_name && tx.category_name !== "Transfer") {
            const cat = tx.category_name;
            const now = new Date();
            const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
            const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(),     0, 23, 59, 59, 999);
            const prevTotal = sumAmounts(
              transactions.filter(t => t.type === "expense" && t.category_name === cat && new Date(t.date) >= prevMonthStart && new Date(t.date) <= prevMonthEnd)
            );
            const thisTotal = sumAmounts(
              allTx.filter(t => t.type === "expense" && t.category_name === cat && new Date(t.date) >= monthStart)
            );
            if (prevTotal >= 50 && thisTotal >= prevTotal * 1.25) {
              const pct = Math.round((thisTotal / prevTotal - 1) * 100);
              showAlertRef.current(`${cat} spending is up ${pct}% vs last month`, "warning", "trending-up", true);
              sendPush({
                title: `⚠️ ${cat} Spending Up`,
                body:  `${cat} is up ${pct}% vs last month ($${Math.round(thisTotal)} vs $${Math.round(prevTotal)})`,
                icon:  "/icon-192.png",
                tag:   `unusual-${cat.toLowerCase().replace(/\s+/g, "-")}`,
              });
            }
          }
        }
        // Update upcoming charges based on new transaction set
        setUpcomingCharges(getUpcomingChargesForCarousel([data, ...transactions], merchantAliasMap));
        posthog?.capture('transaction_added', { type: tx.type });
        setShowAddTx(false); // only close on confirmed success
      }
    } catch (err) {
      logger.error("[addTransaction] failed:", err);
      showAlertRef.current("Couldn't save transaction. Try again.", "danger", "alert-circle");
    }
  }

  async function deleteTransaction(id) {
    try {
      await supabase.from("transactions").delete().eq("id", id);
      setTransactions(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      logger.error("[deleteTransaction] failed:", err);
    }
  }

  async function updateTransaction(id, updates) {
    try {
      const { data } = await supabase.from("transactions").update(updates).eq("id", id).select().single();
      if (data) setTransactions(prev => prev.map(t => t.id === id ? data : t));
    } catch (err) {
      logger.error("[updateTransaction] failed:", err);
    } finally {
      setEditTx(null);
    }
  }

  async function decideMerchantAlias(aliasKey, canonicalKey, status) {
    try {
      const { data } = await supabase.from("merchant_aliases")
        .insert({ user_id: user.id, alias_key: aliasKey, canonical_key: canonicalKey, status })
        .select().single();
      if (data) {
        setMerchantAliases(prev => [...prev, data]);
        if (status === 'confirmed') posthog?.capture('merchant_alias_confirmed');
      }
    } catch (err) {
      logger.error("[decideMerchantAlias] failed:", err);
    }
  }

  async function addScheduledPayment(payment) {
    try {
      const { data } = await supabase.from("scheduled_payments")
        .insert({ user_id: user.id, ...payment })
        .select().single();
      if (data) setScheduledPayments(prev => [...prev, data]);
      return data;
    } catch (err) {
      logger.error("[addScheduledPayment] failed:", err);
    }
  }

  async function cancelScheduledPayment(id) {
    try {
      await supabase.from("scheduled_payments").update({ status: "cancelled" }).eq("id", id);
      // Local state only ever holds pending rows (loadAll fetches status=pending),
      // so cancelling just removes it rather than flipping a status flag in place.
      setScheduledPayments(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      logger.error("[cancelScheduledPayment] failed:", err);
    }
  }

  // Tap-to-open on Today's Lesson = completion. No-ops if already completed
  // today (computeNextStreak returns the same streak + alreadyCompletedToday)
  // so re-opening the same lesson twice in a day is safe to call unguarded.
  async function completeLesson() {
    const { streak, lastCompletedDate } = computeNextStreak(lessonStreak.last_completed_date, lessonStreak.current_streak);
    if (lastCompletedDate === lessonStreak.last_completed_date && streak === lessonStreak.current_streak) return;
    try {
      const { data, error } = await supabase.from("lesson_streaks")
        .upsert({ user_id: user.id, current_streak: streak, last_completed_date: lastCompletedDate })
        .select().single();
      if (error) throw error;
      if (data) setLessonStreak(data);
    } catch (err) {
      logger.error("[completeLesson] failed:", err);
    }
  }

  async function addSaving(sv) {
    const { data } = await supabase.from("savings").insert({ ...sv, user_id: user.id }).select().single();
    if (data) {
      setSavings(prev => [...prev, data]);
      posthog?.capture('savings_goal_created');
    }
  }

  async function updateSaving(id, current) {
    try {
      await supabase.from("savings").update({ current }).eq("id", id);
      setSavings(prev => prev.map(s => s.id === id ? { ...s, current } : s));
    } catch (err) {
      logger.error("[updateSaving] failed:", err);
    }
  }

  async function editSaving(id, updates) {
    try {
      await supabase.from("savings").update(updates).eq("id", id);
      setSavings(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    } catch (err) {
      logger.error("[editSaving] failed:", err);
    }
  }

  async function deleteSaving(id) {
    try {
      await supabase.from("savings").delete().eq("id", id);
      setSavings(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      logger.error("[deleteSaving] failed:", err);
    }
  }

  async function saveProfile(updates) {
    try {
      await supabase.from("profiles").update(updates).eq("id", user.id);
      setProfile(prev => ({ ...prev, ...updates }));
    } catch (err) {
      logger.error("[saveProfile] failed:", err);
    }
  }

  function startTutorial() {
    setActiveTourSteps(TUTORIAL_STEPS);
    setTutorialStepIdx(0);
    setScreen("dashboard");
    setTutorialActive(true);
  }

  function startMiniTour(tourId) {
    const steps = MINI_TOURS[tourId];
    if (!steps) return;
    setActiveTourSteps(steps);
    setTutorialStepIdx(0);
    if (steps[0].screen) setScreen(steps[0].screen);
    setTutorialActive(true);
  }

  function advanceTutorial() {
    const nextIdx = tutorialStepIdx + 1;
    if (nextIdx >= activeTourSteps.length) {
      finishTutorial();
      return;
    }
    const nextStep = activeTourSteps[nextIdx];
    if (nextStep.screen) setScreen(nextStep.screen);
    setTutorialStepIdx(nextIdx);
  }

  function finishTutorial() {
    setTutorialActive(false);
    setTutorialStepIdx(0);
    supabase.from("profiles").update({ tutorial_completed: true }).eq("id", user.id).then(() => {
      setProfile(p => p ? { ...p, tutorial_completed: true } : p);
    });
  }

  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // Если текущий месяц пустой — показываем последний активный месяц
  const rawThisMonth = transactions.filter(t => { const d = parseDate(t.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const lastMonthTxs = transactions.filter(t => { const d = parseDate(t.date); return d.getMonth() === prevMonth.getMonth() && d.getFullYear() === prevMonth.getFullYear(); });

  const thisMonth = rawThisMonth.length > 0 ? rawThisMonth : lastMonthTxs;
  const lastMonth = rawThisMonth.length > 0 ? lastMonthTxs : (() => {
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return transactions.filter(t => { const d = parseDate(t.date); return d.getMonth() === twoMonthsAgo.getMonth() && d.getFullYear() === twoMonthsAgo.getFullYear(); });
  })();

  const isRealExpense = t => {
    if (t.type !== "expense") return false;
    const cat = resolveCategory(t);
    return cat !== "Transfer" && cat !== "Transfers";
  };
  const totalSpent = sumAmounts(thisMonth.filter(isRealExpense));
  const totalIncome = sumAmounts(thisMonth.filter(t => t.type === "income"));
  const totalTransfers = sumAmounts(thisMonth.filter(t => t.category_name === "Transfer"));
  const lastSpent = sumAmounts(lastMonth.filter(isRealExpense));
  const lastIncome = sumAmounts(lastMonth.filter(t => t.type === "income"));

  // FIX: sum ALL income from the most recent month, not just the single most
  // recent transaction — same bug already fixed in get-insights/buildFinancialInput
  // (a one-off transaction like a small CD deposit understated real income).
  const effectiveIncome = (() => {
    if (totalIncome > 0) return totalIncome;
    const incomeTxs = transactions.filter(t => t.type === "income");
    if (incomeTxs.length === 0) return 0;
    const mostRecent = [...incomeTxs].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const mostRecentDate = parseDate(mostRecent.date);
    return sumAmounts(
      incomeTxs.filter(t => { const d = parseDate(t.date); return d.getMonth() === mostRecentDate.getMonth() && d.getFullYear() === mostRecentDate.getFullYear(); })
    );
  })();

  const spendingByCategory = {};
  thisMonth.filter(isRealExpense).forEach(t => { const k = resolveCategory(t); spendingByCategory[k] = (spendingByCategory[k] || 0) + Math.abs(Number(t.amount) || 0); });
  const prevSpendingByCategory = {};
  lastMonth.filter(isRealExpense).forEach(t => { const k = resolveCategory(t); prevSpendingByCategory[k] = (prevSpendingByCategory[k] || 0) + Number(t.amount); });

  const insightScreen =
    screen === "dashboard"    ? "home" :
    screen === "transactions" ? "transactions" :
    screen === "savings"      ? "savings" :
    screen === "insights"     ? "insights" : "home";

  const { insight, allInsights, aiContext } = useInsights(insightScreen, user?.id, i18n.language);

  useEffect(() => {
    if (!loading) window.hideSplash?.();
  }, [loading]);

  useEffect(() => {
    function measure() {
      if (!headerRef.current) return;
      setHeaderHeight(headerRef.current.getBoundingClientRect().height);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Imperative touchmove with { passive: false } so preventDefault() works on iOS
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const onMove = (e) => {
      if (!chatDragging.current) return;
      const dy = e.touches[0].clientY - chatDragStart.current;
      if (dy > 0) {
        e.preventDefault();
        setChatDragY(dy);
      }
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  }, [showChat]);

  useEffect(() => {
    try {
      const toSave = chatMessages.filter(m => !m.loading);
      sessionStorage.setItem('arkonomy_chat_history', JSON.stringify(toSave));
    } catch {}
  }, [chatMessages]);

  // Must be before any early return — Rules of Hooks
  useEffect(() => {
    if (screen === 'insights' && (allInsights?.length ?? 0) > 0) {
      const count = allInsights.length;
      setSeenInsightCount(count);
      try { localStorage.setItem('arkonomy_insights_seen', JSON.stringify({ count, at: Date.now() })); } catch {}
    }
  }, [screen, allInsights]);

  // Keep showChatRef in sync so idle timer closure always sees latest value
  useEffect(() => { showChatRef.current = showChat; }, [showChat]);

  // Close chat when user navigates to a different screen
  useEffect(() => { if (showChat) setShowChat(false); }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // AI bubble idle mode — show insight nudge after 30-60s of inactivity
  useEffect(() => {
    if (!user) return;
    const IDLE_MIN = 30000, IDLE_MAX = 60000;
    function pickIdleText(insights) {
      if (!insights?.length) return "Tap to ask your AI assistant anything about your finances.";
      const ins = insights[0];
      if (ins.type === 'category_spike' && ins.data?.categoryName)
        return `${ins.data.categoryName} spending is up this month — want to review?`;
      if (ins.type === 'overspending') return "You're over budget this month. Ask AI how to adjust.";
      if (ins.type === 'savings_opportunity') return "You may have room to save more. Tap to see how.";
      if (ins.type === 'goal_off_track') return "One of your savings goals needs attention.";
      if (ins.type === 'positive_progress') return "Your finances are looking healthy! Ask AI what's next.";
      return "New insight available — tap to chat with your AI assistant.";
    }
    function scheduleIdle() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (idleDismissRef.current) clearTimeout(idleDismissRef.current);
      const delay = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
      idleTimerRef.current = setTimeout(() => {
        if (showChatRef.current) return;
        setIdleBubble(pickIdleText(allInsights));
        idleDismissRef.current = setTimeout(() => setIdleBubble(null), 8000);
      }, delay);
    }
    const events = ['touchstart', 'mousemove', 'mousedown', 'keydown', 'scroll'];
    events.forEach(ev => window.addEventListener(ev, scheduleIdle, { passive: true }));
    scheduleIdle();
    return () => {
      events.forEach(ev => window.removeEventListener(ev, scheduleIdle));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (idleDismissRef.current) clearTimeout(idleDismissRef.current);
    };
  }, [user, allInsights]);

  const merchantAliasMap = useMemo(() => {
    const m = new Map();
    merchantAliases.filter(a => a.status === "confirmed").forEach(a => m.set(a.alias_key, a.canonical_key));
    return m;
  }, [merchantAliases]);

  if (loading && !user) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div style={{ color: C.cyan, fontSize: 16, fontWeight: 500 }}>Loading Arkonomy {APP_VERSION}...</div>
    </div>
  );

  if (!user) return <AuthScreen onAuth={setUser} />;

  // Show onboarding for new users who haven't started a trial yet
  const shouldOnboard = !loading && !onboardingDone && !isPro;
  if (shouldOnboard) return (
    <OnboardingFlow
      user={user}
      profile={profile}
      linkToken={linkToken}
      getLinkToken={getLinkToken}
      onPlaidSuccess={onPlaidSuccess}
      onSaveProfile={saveProfile}
      trialCancelled={trialCancelled}
      transactions={transactions}
      bankConnected={bankConnected}
    />
  );

  const isShowingLastMonth = rawThisMonth.length === 0 && lastMonthTxs.length > 0;
  const onUpgrade = () => {
    posthog?.capture('upgrade_modal_viewed');
    if (IS_IOS_NATIVE && isUSStorefront) { setShowLeavingAppSheet(true); return; }
    setShowUpgradeModal(true);
  };
  const openExternalUpgrade = async () => {
    setShowLeavingAppSheet(false);
    await Browser.open({ url: "https://app.arkonomy.com/upgrade" });
  };
  const plaidBalance = sumDepositoryBalance(getCachedAccounts());
  const shared = { transactions, categories, savings, profile, totalSpent, totalIncome: effectiveIncome, lastSpent, lastIncome, spendingByCategory, prevSpendingByCategory, totalTransfers, isShowingLastMonth, isPro, onUpgrade, plaidBalance };

  function openMarket(symbol) {
    setMarketInitSymbol(symbol ?? null);
    setScreen("markets");
  }

  function handleInsightAction(action, data) {
    if (action === "reduce_category") {
      if (data?.categoryName) setCatFilter(data.categoryName);
      setScreen("transactions");
    } else if (action === "review_spending" || action === "view_bills") {
      setScreen("transactions");
    } else if (action === "move_to_savings" || action === "catch_up_goal") {
      setScreen("savings");
    } else if (action === "view_progress") {
      setScreen("insights");
    } else if (action === "view_debt") {
      setScreen("dashboard");
    } else if (action === "invest_alpaca") {
      investAlpaca(data); setScreen("savings");
    } else {
      setScreen("transactions");
    }
  }

  async function connectAlpaca() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const result = await callEdgeFunction("alpaca-oauth-start", {});
      if (!result?.nonce) { logger.error("[connectAlpaca] no nonce returned:", result); return; }
      const url = alpacaOAuthUrl(result.nonce);
      setAlpacaDisclosureUrl(url);
    } catch (err) {
      logger.error("[connectAlpaca] failed:", err);
    }
  }

  async function investAlpaca(data) {
    // Deliberate: excludes isTrial, not just Free — investing moves real
    // money via Alpaca, and a trial user who doesn't convert would be left
    // holding a position with no clean way to unwind it. Paid Pro only,
    // same reasoning as the Buy tab gate in Markets.jsx and the invest
    // button gate in Savings.jsx. Not a forgotten edge case.
    if (!isPro || isTrial) { posthog?.capture('upgrade_modal_viewed', { trigger: 'invest' }); setShowUpgradeModal(true); return; }
    if (!alpacaConnected) { connectAlpaca(); return; }
    const amount = data?.roundUpMonthly;
    if (!amount || Number(amount) < 1) {
      setAlpacaToast({ error: "No round-up amount available" });
      clearTimeout(alpacaToastTimerRef.current);
      alpacaToastTimerRef.current = setTimeout(() => setAlpacaToast(null), 4000);
      return;
    }
    setAlpacaToast({ loading: true, message: `Investing $${amount} in SPY…` });
    try {
      const { data: result, error } = await supabase.functions.invoke("alpaca-invest", {
        body: { amount: Number(amount), symbol: "SPY" },
      });
      if (error || result?.error) {
        let errMsg = result?.error || error?.message || "Investment failed";
        let details = result?.details ? JSON.stringify(result.details) : '';
        if (error?.context) {
          try {
            const errBody = await error.context.json();
            errMsg = errBody?.error || errMsg;
            details = errBody?.details ? JSON.stringify(errBody.details) : details;
          } catch {}
        }
        if (errMsg === 'alpaca_not_connected') {
          setAlpacaToast(null);
          connectAlpaca();
          return;
        } else if (errMsg === 'brokerage_account_error') {
          setAlpacaToast({ error: t("savings.brokerage_account_error") });
        } else if (errMsg.includes('Insufficient buying power') || errMsg.includes('not configured') || errMsg.includes('ALPACA_API_KEY')) {
          setAlpacaToast({ addFunds: true });
        } else {
          setAlpacaToast({ error: errMsg + (details ? ` | ${details}` : '') });
        }
      } else {
        setAlpacaToast({ success: true, message: result.message || `$${amount} invested in SPY` });
      }
    } catch (err) {
      setAlpacaToast({ error: String(err) });
    }
    clearTimeout(alpacaToastTimerRef.current);
    alpacaToastTimerRef.current = setTimeout(() => setAlpacaToast(null), 5000);
  }

  function markInsightsSeen() {
    const count = allInsights?.length ?? 0;
    setSeenInsightCount(count);
    try { localStorage.setItem('arkonomy_insights_seen', JSON.stringify({ count, at: Date.now() })); } catch {}
  }

  function buildChatGreeting() {
    const budget = Number(profile?.monthly_budget) || 3000;
    const SUB_CATS_HS = ['Subscriptions', 'Bills', 'Utilities', 'Phone', 'Internet', 'Insurance'];
    const subSpend = SUB_CATS_HS.reduce((s, c) => s + (spendingByCategory[c] || 0), 0);
    const { score: hs } = calculateHealthScore({ totalIncome: effectiveIncome, totalSpent, lastIncome, lastSpent, budget, subscriptionSpend: subSpend });
    return buildContextGreeting(screen, {
      totalIncome: effectiveIncome, totalSpent, spendingByCategory, savings,
      transactions, profile, allInsights, healthScore: hs,
    });
  }

  function openChatWithContext() {
    // Preserve existing history; only set greeting when chat is fresh
    const hasHistory = chatMessages.some(m => m.role === "user");
    if (!hasHistory) {
      setChatMessages([{ role: "assistant", text: buildChatGreeting() }]);
    }
    posthog?.capture('ai_chat_opened', { has_history: hasHistory });
    setShowChat(true);
    markInsightsSeen();
  }

  // Dashboard card long-press → opens chat with a specific prefilled
  // question already sent, same mechanism Insights.jsx's "Ask about
  // subscription" search-icon already uses (setChatMessages + setShowChat +
  // sendChat), just generalized to any card instead of one hardcoded prompt.
  function openChatWithMessage(msg) {
    const hasHistory = chatMessages.some(m => m.role === "user");
    const base = hasHistory ? chatMessages : [{ role: "assistant", text: buildChatGreeting() }];
    if (!hasHistory) setChatMessages(base);
    posthog?.capture('ai_chat_opened', { has_history: hasHistory, source: 'card_longpress' });
    setShowChat(true);
    markInsightsSeen();
    sendChat(msg, base);
  }

  function startNewChat() {
    const fresh = [{ role: "assistant", text: buildChatGreeting() }];
    setChatMessages(fresh);
    try { sessionStorage.setItem('arkonomy_chat_history', JSON.stringify(fresh)); } catch {}
  }

  async function sendChat(input, baseMessages) {
    if (!input.trim()) return;
    const userMsg = { role: "user", text: input };
    const updated = [...(baseMessages ?? chatMessages), userMsg];
    setChatMessages(updated);
    setChatInput("");

    // Real account balance is critical financial data going into an AI
    // prompt marked "treat as ground truth" — never substitute a different
    // number (monthly net) if it's missing. getCachedAccounts() reflects
    // whatever the last-visited screen happened to fetch and can be null/
    // expired (5-min TTL) if chat is opened first. Actively fetch instead
    // of passively trusting that cross-screen cache for this specific case.
    let freshAccounts = getCachedAccounts();
    let currentBalance = sumDepositoryBalance(freshAccounts);
    if (currentBalance == null && bankConnected) {
      try {
        const result = await callEdgeFunction("plaid-get-accounts", {});
        if (result?.accounts) {
          freshAccounts = result.accounts;
          if (freshAccounts.length) setCachedAccounts(freshAccounts);
          currentBalance = sumDepositoryBalance(freshAccounts);
        }
      } catch (err) {
        logger.error("[sendChat] balance fetch failed:", err);
      }
    }

    const allAccounts = freshAccounts || [];
    const creditCards = getCreditAccounts(allAccounts)
      .map(a => ({ name: a.name, balance: a.balance_current ?? a.balance_available ?? null }));

    const interestThisMonth = sumAmounts(
      transactions.filter(t => t.type === "expense" && resolveCategory(t) === "Cost of Debt" && (() => { const d = new Date(t.date + "T00:00:00"); return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear(); })())
    );

    const { subscriptions, regularPayments, subTotal, regularTotal } = computeRecurringSummary(transactions, new Date(), merchantAliasMap);
    const duplicates = findDuplicateSubscriptions(subscriptions);

    const ctx = {
      metrics: {
        // null (not a substituted number) when genuinely unavailable —
        // ai-chat's prompt must handle this explicitly, never guess.
        currentBalance,
        currentMonthSpend: totalSpent,
        currentMonthIncome: effectiveIncome,
        monthlyBudget: Number(profile?.monthly_budget) || 3000,
        budgetUsedPct: Math.round((totalSpent / (Number(profile?.monthly_budget) || 3000)) * 100),
        availableSafeToMove: Math.max(0, Math.min(effectiveIncome - totalSpent - BUFFER, currentBalance != null ? currentBalance - BUFFER : Infinity)),
      },
      engine: {
        activeSignals: aiContext?.activeSignals ?? [],
        topInsight: aiContext?.topInsight ?? null,
        isWarning: aiContext?.isWarning ?? false,
        isPositive: aiContext?.isPositive ?? false,
      },
      regularCommitments: {
        subscriptions: subscriptions.map(s => ({ name: s.name, amount: Math.round(s.avgMonthly) })),
        regularPayments: regularPayments.map(s => ({ name: s.name, amount: Math.round(s.avgMonthly) })),
        totalMonthly: Math.round(subTotal + regularTotal),
        duplicates,
      },
      topCategories: Object.entries(spendingByCategory)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([name, amount]) => ({ name, amount: Math.round(amount) })),
      savingsGoals: savings.map(s => ({
        name: s.name, current: Number(s.current), target: Number(s.target),
        progressPct: s.target > 0 ? Math.round((s.current / s.target) * 100) : 0,
        remaining: Math.max(Number(s.target) - Number(s.current), 0),
      })),
      totalSaved: savings.reduce((s, sv) => s + Number(sv.current), 0),
      recentTransactions: transactions.slice(0, 8).map(t => ({
        description: t.description || t.category_name,
        amount: Number(t.amount), type: t.type,
        category: t.category_name, date: t.date,
      })),
      creditCards,
      interestThisMonth,
    };

    const lid = Date.now();
    setChatMessages(prev => [...prev, { role: "assistant", text: "...", id: lid, loading: true }]);

    try {
      const res = await callEdgeFunction("ai-chat", {
        messages: updated.filter(m => !m.loading), financialContext: ctx, plan: profile?.plan ?? 'free'
      });
      const raw = res?.reply || "Sorry, something went wrong.";
      const reply = raw.replace(/^[\s.,!?;:]+/, '');
      setChatMessages(prev => prev.map(m => m.id === lid ? { role: "assistant", text: reply } : m));
    } catch {
      setChatMessages(prev => prev.map(m => m.id === lid ? { role: "assistant", text: "Could not reach AI. Check your connection." } : m));
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: FONT, maxWidth: 430, margin: "0 auto", position: "relative", overflow: "visible" }}>
      {/* Header */}
      <div ref={headerRef} style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)", paddingBottom: "14px", paddingLeft: "18px", paddingRight: "18px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(11,20,38,0.99)", backdropFilter: "blur(20px)", zIndex: 50, borderBottom: `1px solid ${C.sep}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 94, height: 47, objectFit: "contain" }} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.muted, fontSize: 16, fontWeight: 600 }}>{profile?.full_name || user.email?.split("@")[0]}</span>
              {isTrial
                ? <span onClick={onUpgrade} style={{ fontSize: 12, fontWeight: 700, color: DC.gold, background: DC.gold + "20", borderRadius: RADIUS.lg, padding: "3px 9px", cursor: "pointer" }}>Trial: {trialDaysLeft}d left</span>
                : trialExpired
                ? <span onClick={onUpgrade} style={{ fontSize: 12, fontWeight: 700, color: DC.ruby, background: DC.ruby + "20", borderRadius: RADIUS.lg, padding: "3px 9px", cursor: "pointer" }}>Trial ended</span>
                : isPro && <span style={{ fontSize: 10, fontWeight: 700, color: sharedC.proAccent, background: sharedC.proAccent + "18", border: `1px solid ${sharedC.proAccent}44`, borderRadius: RADIUS.full, padding: "2px 8px", letterSpacing: 0.5 }}>PRO</span>
              }
            </div>
            {backgroundSyncing
              ? <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: C.green }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.green, animation: "pulse 1.2s ease-in-out infinite" }} />
                  Syncing…
                </div>
              : <div style={{ color: C.faint, fontSize: 12 }}>AI Financial Autopilot</div>
            }
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Globe / language picker */}
          <div ref={langRef} style={{ position: "relative" }}>
            <button onClick={() => setLangOpen(v => !v)} aria-label="Change language" style={{ background: langOpen ? DC.gold + "18" : DC.card, border: `1px solid ${langOpen ? DC.gold + "44" : `${DC.faint}33`}`, borderRadius: RADIUS.sm, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Icon name="globe" size={19} color={langOpen ? DC.gold : DC.muted} />
            </button>
            {langOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 200, minWidth: 150, overflow: "hidden" }}>
                {[
                  { code: "en", label: "English" },
                  { code: "ru", label: "Русский" },
                  { code: "es", label: "Español" },
                  { code: "pt", label: "Português (BR)" },
                ].map((lang, idx, arr) => {
                  const active = i18n.language?.startsWith(lang.code);
                  return (
                    <button
                      key={lang.code}
                      onClick={() => {
                        i18n.changeLanguage(lang.code);
                        try { localStorage.setItem('arkonomy_language', lang.code); } catch {}
                        if (user) supabase.from('profiles').update({ preferred_language: lang.code }).eq('id', user.id);
                        setLangOpen(false);
                      }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "12px 16px", background: active ? DC.gold + "14" : "transparent", border: "none", borderBottom: idx < arr.length - 1 ? `1px solid ${DC.faint}22` : "none", color: active ? DC.gold : DC.text, fontSize: 14, fontWeight: active ? 600 : 400, cursor: "pointer", fontFamily: FONT, textAlign: "left" }}
                    >
                      {lang.label}
                      {active && <Icon name="check" size={14} color={DC.gold} strokeWidth={2.5} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button data-tutorial="settings-btn" onClick={() => setScreen("profile")} style={{ background: screen === "profile" ? DC.gold + "18" : DC.card, border: `1px solid ${screen === "profile" ? DC.gold + "44" : `${DC.faint}33`}`, borderRadius: RADIUS.sm, width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="settings" size={21} color={screen === "profile" ? DC.gold : DC.muted} />
          </button>
        </div>
      </div>

      {/* Content — paddingTop = measured header height + 8px gap; paddingBottom clears FAB + nav */}
      <div style={{ paddingTop: `${headerHeight + 8}px`, paddingRight: "14px", paddingBottom: "160px", paddingLeft: "14px" }}>
        {isTrial && trialDaysLeft <= 2 && (
          <div
            onClick={showRealUpgrade ? onUpgrade : undefined}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: C.amber + "18", border: `1px solid ${C.amber}44`, borderRadius: RADIUS.md, marginBottom: 14, cursor: showRealUpgrade ? "pointer" : "default" }}
          >
            <Icon name="zap" size={16} color={C.amber} strokeWidth={2} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.amber }}>
                Your trial ends in {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}
                {showRealUpgrade && " —"}
              </span>
              {showRealUpgrade && (
                <span style={{ fontSize: 13, color: C.amber, textDecoration: "underline", textUnderlineOffset: 2 }}>
                  {" "}Upgrade to keep Pro
                </span>
              )}
            </div>
          </div>
        )}
        {loading ? (() => {
          const shimmerStyle = { background: `linear-gradient(90deg, ${C.bgSecondary} 0%, ${C.bgTertiary} 40%, ${C.bgSecondary} 100%)`, backgroundSize: "300% 100%", animation: "shimmer 1.6s ease-in-out infinite", borderRadius: RADIUS.sm };
          const row = (w, h = 14, extra = {}) => <div style={{ ...shimmerStyle, width: w, height: h, marginBottom: 6, borderRadius: RADIUS.xs, ...extra }} />;
          const card = (children, mb = 12) => <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: "18px 16px", marginBottom: mb, overflow: "hidden" }}>{children}</div>;

          if (screen === "transactions") return (
            <div>
              <style>{`@keyframes shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}`}</style>
              {[0,1,2,3,4,5].map(i => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.sep}` }}>
                  <div style={{ ...shimmerStyle, width: 40, height: 40, borderRadius: RADIUS.sm, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    {row("65%", 13)}
                    {row("40%", 10, { marginBottom: 0 })}
                  </div>
                  {row(52, 13, { marginBottom: 0 })}
                </div>
              ))}
            </div>
          );

          if (screen === "insights") return (
            <div>
              <style>{`@keyframes shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}`}</style>
              {card(<>{row("50%", 10, { marginBottom: 10 })}{row("100%", 60, { borderRadius: RADIUS.sm, marginBottom: 0 })}</>)}
              {[0,1,2].map(i => card(<>
                {row("30%", 10)}
                {row("80%", 14)}
                {row("55%", 12, { marginBottom: 0 })}
              </>, 10))}
            </div>
          );

          // Dashboard (default)
          return (
            <div>
              <style>{`@keyframes shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}`}</style>
              {card(<>
                {row("35%", 10)}
                {row("55%", 36, { borderRadius: RADIUS.xs, marginBottom: 10 })}
                <div style={{ display: "flex", gap: 12 }}>
                  {[0,1,2].map(i => <div key={i} style={{ flex: 1 }}>{row("100%", 10)}{row("100%", 18, { marginBottom: 0 })}</div>)}
                </div>
              </>)}
              {card(<>
                {row("45%", 12)}
                {row("100%", 22, { borderRadius: RADIUS.xs })}
                {row("70%", 10, { marginBottom: 0 })}
              </>)}
              {card(<>
                {row("60%", 12)}
                {row("100%", 48, { borderRadius: RADIUS.sm, marginBottom: 0 })}
              </>)}
            </div>
          );
        })() : (
          <>
            {screen === "dashboard" && <Dashboard {...shared} onNavigate={setScreen} onCatClick={cat => { setCatFilter(cat); setMerchantFilter(null); setDateFilter(null); setScreen("transactions"); }} onMerchantClick={tx => { setMerchantFilter(tx.description); setCatFilter(null); setDateFilter(null); setScreen("transactions"); }} onDayClick={date => { setDateFilter(date); setCatFilter(null); setMerchantFilter(null); setScreen("transactions"); }} onDayCategoryClick={(date, cat) => { setDateFilter(date); setCatFilter(cat); setMerchantFilter(null); setScreen("transactions"); }} insight={insight} onInsightAction={handleInsightAction} upcomingCharges={upcomingCharges} onOpenMarket={openMarket} bankConnected={bankConnected} userId={user?.id} lastSyncedAt={lastSyncedAt} hideWelcomeBanner={proToast} merchantAliasMap={merchantAliasMap} scheduledPayments={scheduledPayments} onAddScheduledPayment={addScheduledPayment} onCancelScheduledPayment={cancelScheduledPayment} onOpenChat={openChatWithContext} lessonStreak={lessonStreak} onCompleteLesson={completeLesson} onOpenChatWithMessage={openChatWithMessage} />}
            {screen === "markets"   && <Markets profile={profile} user={user} onSaveProfile={saveProfile} initialSymbol={marketInitSymbol} onClearInit={() => setMarketInitSymbol(null)} alpacaConnected={alpacaConnected} onConnectAlpaca={connectAlpaca} isPro={isPro} isTrial={isTrial} onUpgrade={onUpgrade} onToast={showAlert} />}
            {screen === "transactions" && <Transactions transactions={transactions} categories={categories} onAdd={() => setShowAddTx(true)} onDelete={deleteTransaction} onEdit={setEditTx} activeCatFilter={catFilter} onClearCatFilter={() => setCatFilter(null)} activeMerchantFilter={merchantFilter} onClearMerchantFilter={() => setMerchantFilter(null)} activeDateFilter={dateFilter} onClearDateFilter={() => setDateFilter(null)} insight={insight} onInsightAction={handleInsightAction} onToast={showAlert} bankConnected={bankConnected} onNavigate={setScreen} />}
            {screen === "savings" && <Savings savings={savings} onAdd={addSaving} onUpdate={updateSaving} onEdit={editSaving} onDelete={deleteSaving} totalIncome={totalIncome} totalSpent={totalSpent} transactions={transactions} insight={insight} onInsightAction={handleInsightAction} onInvestAlpaca={investAlpaca} isPro={isPro} isTrial={isTrial} onUpgrade={onUpgrade} alpacaConnected={alpacaConnected} onConnectAlpaca={connectAlpaca} bankConnected={bankConnected} userId={user.id} InsightCard={InsightCard} roundupEnabled={roundupEnabled} onToggleRoundup={v => { setRoundupEnabled(v); saveProfile({ roundup_enabled: v }); }} />}
            {screen === "insights" && <Insights {...shared} onOpenChat={msg => { const budget = Number(profile?.monthly_budget)||3000; const sub = ['Subscriptions','Bills','Utilities','Phone','Internet','Insurance'].reduce((s,c)=>s+(spendingByCategory[c]||0),0); const {score:hs}=calculateHealthScore({totalIncome:effectiveIncome,totalSpent,lastIncome,lastSpent,budget,subscriptionSpend:sub}); const greeting=buildContextGreeting('insights',{totalIncome:effectiveIncome,totalSpent,spendingByCategory,savings,transactions,profile,allInsights,healthScore:hs}); const base=[{role:"assistant",text:greeting}]; setChatMessages(base); setShowChat(true); sendChat(msg,base); }} allInsights={allInsights} onInsightAction={handleInsightAction} isPro={isPro} onUpgrade={onUpgrade} merchantAliasMap={merchantAliasMap} merchantAliases={merchantAliases} onDecideMerchantAlias={decideMerchantAlias} bankConnected={bankConnected} onNavigate={setScreen} />}
            {screen === "profile" && <Profile profile={profile} user={user} onSave={saveProfile} onSignOut={signOut} onDeleteAccount={deleteAccount} onBack={() => setScreen("dashboard")} autopilot={autopilot} setAutopilot={setAutopilot} bankConnected={bankConnected} bankName={bankName} bankCount={bankCount} linkToken={linkToken} getLinkToken={getLinkToken} getReconnectToken={getReconnectToken} onPlaidSuccess={onPlaidSuccess} syncBankTransactions={syncBankTransactions} syncingBank={syncingBank} lastSyncedAt={lastSyncedAt} backgroundSyncing={backgroundSyncing} onRefreshBalance={refreshBalanceNow} refreshingBalance={refreshingBalance} lastBalanceRefreshAt={profile?.last_balance_refresh_at} isPro={isPro} onUpgrade={onUpgrade} transactions={transactions} />}
          </>
        )}
      </div>

      {showAddTx && <AddTransactionModal categories={categories} onAdd={addTransaction} onClose={() => setShowAddTx(false)} />}
      {editTx && <AddTransactionModal categories={categories} existing={editTx} onAdd={data => updateTransaction(editTx.id, data)} onClose={() => setEditTx(null)} />}
      <ToastStack toasts={alertToasts} dismiss={dismissAlert} />
      {proToast && (
        <div style={{
          position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
          background: `linear-gradient(135deg, ${sharedC.proAccent}22, #38B6FF11), ${C.card}`,
          border: `1px solid ${sharedC.proAccent}66`,
          borderRadius: RADIUS.md, padding: "16px 24px", zIndex: 10000,
          color: C.proToastText, fontFamily: FONT,
          textAlign: "center", boxShadow: `0 8px 32px ${sharedC.proAccent}4D`,
          minWidth: 260,
        }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
            <Icon name="zap" size={28} color={sharedC.proAccent} strokeWidth={2} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Welcome to Pro!</div>
          <div style={{ fontSize: 13, color: C.proMuted }}>Your account has been upgraded. Enjoy all features.</div>
        </div>
      )}
      {showUpgradeModal && <UpgradeModal onClose={() => setShowUpgradeModal(false)} supabase={supabase} />}
      {showTrialExpiredModal && (
        <div onClick={() => setShowTrialExpiredModal(false)} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(7,12,24,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "24px 24px 0 0", border: `1px solid ${C.border}`, borderBottom: "none", padding: "28px 20px 36px", fontFamily: FONT, color: C.text, boxShadow: "0 -8px 48px rgba(0,0,0,0.6)" }}>
            <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: C.border, margin: "0 auto 24px" }} />
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: RADIUS.lg, background: C.trialEndedAccent + "22", border: `1px solid ${C.trialEndedAccent}44`, marginBottom: 14 }}>
                <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={C.trialEndedAccent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Your free trial ended</div>
              <div style={{ fontSize: 14, color: C.proMuted }}>{showRealUpgrade ? "Upgrade to keep full access to AI insights, investment tracking, and all Pro features." : t("upgrade.pro_included")}</div>
            </div>
            {/* No purchase UI for non-US iOS storefronts (Guideline 3.1.3 anti-steering) */}
            {showRealUpgrade && (
              <button onClick={() => { setShowTrialExpiredModal(false); onUpgrade(); }} style={{ width: "100%", padding: 16, background: `linear-gradient(135deg,${sharedC.proAccent},#38B6FF)`, border: "none", borderRadius: RADIUS.md, color: "#000", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 24px ${sharedC.proAccent}70`, marginBottom: 12 }}>
                Upgrade to Pro — $9.99/mo
              </button>
            )}
            <button onClick={() => setShowTrialExpiredModal(false)} style={{ width: "100%", padding: 12, background: "none", border: `1px solid ${C.border}`, borderRadius: RADIUS.md, color: C.proMuted, fontWeight: 500, fontSize: 14, cursor: "pointer", fontFamily: FONT }}>
              {showRealUpgrade ? "Maybe later" : t("upgrade.close")}
            </button>
          </div>
        </div>
      )}
      {showLeavingAppSheet && (
        <div onClick={() => setShowLeavingAppSheet(false)} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(7,12,24,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "24px 24px 0 0", border: `1px solid ${C.border}`, borderBottom: "none", padding: "28px 20px 36px", fontFamily: FONT, color: C.text, boxShadow: "0 -8px 48px rgba(0,0,0,0.6)" }}>
            <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: C.border, margin: "0 auto 24px" }} />
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Leaving the app</div>
              <div style={{ fontSize: 14, color: C.proMuted }}>You're leaving the app to complete your purchase on our website.</div>
            </div>
            <button onClick={openExternalUpgrade} style={{ width: "100%", padding: 16, background: `linear-gradient(135deg,${sharedC.proAccent},#38B6FF)`, border: "none", borderRadius: RADIUS.md, color: "#000", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 24px ${sharedC.proAccent}70`, marginBottom: 12 }}>
              Continue
            </button>
            <button onClick={() => setShowLeavingAppSheet(false)} style={{ width: "100%", padding: 12, background: "none", border: `1px solid ${C.border}`, borderRadius: RADIUS.md, color: C.proMuted, fontWeight: 500, fontSize: 14, cursor: "pointer", fontFamily: FONT }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {alpacaDisclosureUrl && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 10000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }} onClick={() => setAlpacaDisclosureUrl(null)}>
          <div style={{
            background: C.card, borderRadius: RADIUS.lg, padding: "28px 24px", maxWidth: 380, width: "100%",
            display: "flex", flexDirection: "column", gap: 16, fontFamily: FONT,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>
              {t("savings.authorize_alpaca")}
            </div>
            <p style={{ fontSize: 13, color: C.subtext, lineHeight: 1.6, margin: 0 }}>
              {t("savings.alpaca_disclaimer1")}
            </p>
            <p style={{ fontSize: 13, color: C.subtext, lineHeight: 1.6, margin: 0 }}>
              {t("savings.alpaca_disclaimer2")}
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={() => setAlpacaDisclosureUrl(null)} style={{
                flex: 1, padding: "11px 0", borderRadius: RADIUS.sm, border: `1px solid ${C.muted}44`,
                background: "transparent", color: C.muted, fontSize: 14, fontWeight: 600,
                fontFamily: FONT, cursor: "pointer",
              }}>{t("savings.cancel")}</button>
              <button onClick={() => { window.open(alpacaDisclosureUrl, "_blank", "noopener"); setAlpacaDisclosureUrl(null); }} style={{
                flex: 2, padding: "11px 0", borderRadius: RADIUS.sm, border: "none",
                background: C.cyan, color: "#000", fontSize: 14, fontWeight: 700,
                fontFamily: FONT, cursor: "pointer",
              }}>{t("savings.confirm_connect_alpaca")}</button>
            </div>
          </div>
        </div>
      )}

      {alpacaToast && (
        <div style={{
          position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: alpacaToast.addFunds ? "#1A1A0D" : alpacaToast.error ? "#2D1515" : alpacaToast.loading ? "#0D1F2D" : "#0D2A1F",
          border: `1px solid ${alpacaToast.addFunds ? sharedC.alpacaAccent + "44" : alpacaToast.error ? "#E05C5C44" : alpacaToast.loading ? "#4B6CB744" : "#12D18E44"}`,
          borderRadius: RADIUS.md, padding: "14px 18px", zIndex: 9999,
          color: alpacaToast.addFunds ? sharedC.alpacaAccent : alpacaToast.error ? "#E05C5C" : alpacaToast.loading ? "#8BA7E8" : "#12D18E",
          fontSize: 13, fontWeight: 600, fontFamily: FONT,
          boxShadow: "0 4px 24px rgba(0,0,0,0.5)", whiteSpace: "pre-wrap", maxWidth: 340,
          display: "flex", flexDirection: "column", gap: 10, alignItems: "center",
        }}>
          {alpacaToast.addFunds ? (
            <>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="dollar" size={15} color={sharedC.alpacaAccent} strokeWidth={2} />
                Your investment account needs funds. Add money first, then come back to invest.
              </span>
              <a
                href="https://app.alpaca.markets/brokerage/funding/deposit"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: sharedC.alpacaAccent, color: "#000", borderRadius: RADIUS.xs,
                  padding: "6px 16px", fontSize: 13, fontWeight: 700,
                  textDecoration: "none", display: "inline-block",
                }}
              >Add funds to account</a>
            </>
          ) : alpacaToast.alpacaSuccess ? (
            <>
              <span>✅ Investment account connected! You can now invest directly from Arkonomy.</span>
            </>
          ) : alpacaToast.error ? `❌ ${alpacaToast.error}` : alpacaToast.loading ? `⏳ ${alpacaToast.message}` : `✅ ${alpacaToast.message}`}
        </div>
      )}

      {/* ── Chat Modal ──────────────────────────────────────── */}
      {showChat && (
        <div
          onClick={() => { setChatDragY(window.innerHeight); setTimeout(() => { setShowChat(false); setChatDragY(0); }, 280); }}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: `rgba(7,12,24,${(0.78 * Math.max(0, 1 - chatDragY / 400)).toFixed(2)})`,
            backdropFilter: "blur(6px)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}
        >
          <div
            ref={chatContainerRef}
            onClick={e => e.stopPropagation()}
            onTouchStart={e => {
              chatDragStart.current  = e.touches[0].clientY;
              chatDragStartX.current = e.touches[0].clientX;
              chatDragging.current   = true;
            }}
            onTouchEnd={() => {
              chatDragging.current = false;
              if (chatDragY > 80) {
                setChatDragY(window.innerHeight);
                setTimeout(() => { setShowChat(false); setChatDragY(0); }, 280);
              } else {
                setChatDragY(0);
              }
            }}
            style={{
              width: "100%", maxWidth: 430,
              height: "88vh",
              background: C.bg,
              borderRadius: "20px 20px 0 0",
              border: `1px solid ${C.border}`,
              borderBottom: "none",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 -8px 48px rgba(0,0,0,0.7)",
              transform: `translateY(${chatDragY}px)`,
              transition: chatDragging.current ? 'none' : 'transform 0.28s cubic-bezier(0.32,0.72,0,1)',
              willChange: "transform",
            }}
          >
            {/* Drag handle pill + header — no extra handlers needed, sheet captures all */}
            <div style={{ flexShrink: 0, userSelect: "none" }}>
              {/* Handle pill */}
              <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
                <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: "rgba(255,255,255,0.18)" }} />
              </div>
              {/* Modal header */}
              <div style={{ padding: "6px 16px 10px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${C.sep}` }}>
              <div style={{ width: 34, height: 34, borderRadius: RADIUS.sm, background: `linear-gradient(135deg,${sharedC.proAccent}22,#00C2FF18)`, border: `1px solid ${sharedC.proAccent}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#00C2FF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>AI Assistant</div>
                <div style={{ fontSize: 11, color: C.faint, display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 5, height: 5, borderRadius: RADIUS.full, background: C.green }} />
                  Powered by Claude · knows your finances
                </div>
              </div>
              <button
                onClick={startNewChat}
                title="New chat"
                style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
              <button
                onClick={() => setShowChat(false)}
                style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            </div>{/* end drag zone */}
            {/* Chat body — touchAction:auto restores scroll inside the message list */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: "0 14px 14px", touchAction: "auto" }}>
              <Chat messages={chatMessages} input={chatInput} setInput={setChatInput} onSend={msg => sendChat(msg ?? chatInput)} onClose={() => setShowChat(false)} isPro={isPro} suggestions={(() => {
                const base = CHAT_SUGGESTIONS_BY_SCREEN[screen] ?? CHAT_SUGGESTIONS_BY_SCREEN.dashboard;
                if (screen !== 'dashboard') return base;
                const first = buildFirstDashboardSuggestion({ spendingByCategory, prevSpendingByCategory, transactions, balance: effectiveIncome - totalSpent, upcomingCharges });
                return [first, ...base.slice(1)];
              })()} onHelpAnswer={(q, a) => setChatMessages(prev => [...prev, { role: "user", text: q }, { role: "assistant", text: a }])} />
            </div>
          </div>
        </div>
      )}

      {/* ── AI Idle Bubble ─────────────────────────────────────── */}
      {/* Hidden on Dashboard only — same pattern as BottomNav's floating
          AI button (2026-08-09): its tail is positioned to visually point
          at that button, now gone there, and the same category of insight
          it nudges toward is already always-visible via CoachBlock on
          Dashboard. Unchanged on every other screen, where the button (and
          the tail pointing at it) is still present. */}
      {idleBubble && !showChat && screen !== 'dashboard' && (
        <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, zIndex: 56, pointerEvents: 'none' }}>
        <div
          onClick={() => { setIdleBubble(null); clearTimeout(idleDismissRef.current); openChatWithContext(); }}
          style={{
            position: 'absolute', bottom: 158, right: 12,
            maxWidth: 220, cursor: 'pointer', pointerEvents: 'auto',
            animation: 'idle-bubble-in 0.3s cubic-bezier(.22,1,.36,1)',
          }}
        >
          <style>{`@keyframes idle-bubble-in{from{opacity:0;transform:translateY(10px) scale(0.92)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>
          <div style={{
            background: 'linear-gradient(135deg,rgba(18,30,60,0.97),rgba(14,24,50,0.97))',
            border: '1px solid rgba(99,102,241,0.4)',
            borderRadius: RADIUS.md, padding: '10px 14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 20px rgba(99,102,241,0.15)',
            backdropFilter: 'blur(12px)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: `linear-gradient(135deg,${sharedC.proAccent},#00C2FF)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                <svg width={10} height={10} viewBox="0 0 24 24" fill="none">
                  <path d="M12 2 L13.4 9.3 L20 12 L13.4 14.7 L12 22 L10.6 14.7 L4 12 L10.6 9.3 Z" fill="#fff"/>
                </svg>
              </div>
              <span style={{ fontSize: 12, color: 'rgba(220,230,255,0.9)', lineHeight: 1.5, fontFamily: FONT }}>{idleBubble}</span>
            </div>
          </div>
          {/* speech bubble tail pointing to AI button */}
          <div style={{ position: 'absolute', bottom: -7, right: 26, width: 14, height: 8, overflow: 'hidden' }}>
            <div style={{ width: 14, height: 14, background: 'rgba(18,30,60,0.97)', border: '1px solid rgba(99,102,241,0.4)', transform: 'rotate(45deg)', transformOrigin: 'center', marginTop: -7, marginLeft: 0 }} />
          </div>
        </div>
        </div>
      )}

      <BottomNav screen={screen} setScreen={setScreen} onOpenChat={() => { setIdleBubble(null); clearTimeout(idleDismissRef.current); openChatWithContext(); }} showChat={showChat} insightCount={Math.max(0, (allInsights?.length ?? 0) - seenInsightCount)} />

      {/* ── Tutorial Overlay ───────────────────────────────────── */}
      {tutorialActive && (
        <TutorialOverlay
          stepIdx={tutorialStepIdx}
          totalSteps={activeTourSteps.length}
          steps={activeTourSteps}
          onNext={advanceTutorial}
          onSkip={finishTutorial}
        />
      )}

    </div>
  );
}

