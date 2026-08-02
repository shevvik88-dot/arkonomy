// src/components/AhaMoment.jsx
// Post-onboarding "here's what we found" interstitial — shown once, right
// after the user's first bank connection + sync, before landing on
// Dashboard. Picks up to 3 facts, in priority order, from data sources
// that already exist elsewhere in the app (recurringSummary.js) — no new
// detection logic, so this can never disagree with Insights/Cash Flow
// Forecast about what's recurring or at risk.
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { C, FONT, CAT_COLORS } from "../utils/colors";
import { fmt, tCat, resolveCategory, cleanMerchantName } from "../utils/helpers";
import Icon from "./shared/Icon";
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "../utils/supabase";
import { getCachedAccounts, setCachedAccounts, sumDepositoryBalance } from "../utils/accountsCache";
import { computeRecurringSummary, findDuplicateSubscriptions, getUpcomingCharges, getUpcomingCardPayments } from "../utils/recurringSummary";

const LARGE_PAYMENT_INCOME_PCT = 0.30;
const CASH_RISK_BUFFER = 100;
const CASH_RISK_DAYS = 7;
const MAX_WAIT_MS = 12000;

// Same fallback as projectBalanceAt's avg3mIncome: monthly average over
// prior full months if there's history, otherwise whatever income exists
// in the available window (onboarding day 1 won't have 3 full months).
function estimateIncome(transactions) {
  const now = new Date();
  const curKey = `${now.getFullYear()}-${now.getMonth()}`;
  const byMonth = {};
  for (const t of transactions) {
    if (t.type !== "income") continue;
    const d = new Date(t.date + "T00:00:00");
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    if (k === curKey) continue;
    byMonth[k] = (byMonth[k] || 0) + Math.abs(Number(t.amount));
  }
  const vals = Object.values(byMonth);
  if (vals.length) return vals.reduce((s, v) => s + v, 0) / vals.length;
  return transactions.filter(t => t.type === "income").reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
}

// Picks up to 3 facts in priority order (duplicates > large recurring
// payment > cash risk), all requiring 2+ months of the same merchant to
// fire (computeRecurringSummary's own threshold) — realistically these
// can come up empty on a thin/Sandbox-style connection, so falls back to
// top spending category over the FULL available history (not just this
// month, which could be nearly empty on day 1).
function computeFacts(transactions, accountBalance) {
  const expenseCount = transactions.filter(t => t.type === "expense" && t.category_name !== "Transfer").length;
  if (expenseCount === 0) return [];

  const facts = [];
  const { subscriptions, regularPayments } = computeRecurringSummary(transactions);

  const duplicates = findDuplicateSubscriptions(subscriptions);
  if (duplicates.length > 0) {
    const [a, b] = duplicates[0].items;
    facts.push({
      type: "duplicate", category: duplicates[0].category, total: a.amount + b.amount,
      a: { ...a, name: cleanMerchantName(a.name) || a.name },
      b: { ...b, name: cleanMerchantName(b.name) || b.name },
    });
  }

  const income = estimateIncome(transactions);
  if (regularPayments.length > 0 && income > 0) {
    const largest = regularPayments[0]; // already sorted desc by avgMonthly
    const pct = largest.avgMonthly / income;
    if (pct >= LARGE_PAYMENT_INCOME_PCT) {
      // computeRecurringSummary keeps the raw bank descriptor (unlike
      // getUpcomingCharges below, which already cleans it) — clean here too
      // so this card doesn't read like a raw ACH string. Even cleaned, some
      // descriptors are just a bare surname with no context (found on real
      // account data) — pairing with category keeps the card meaningful
      // either way.
      facts.push({ type: "largePayment", name: cleanMerchantName(largest.name) || largest.name, category: largest.category || "Bills", amount: largest.avgMonthly, pct: Math.round(pct * 100) });
    }
  }

  if (accountBalance != null) {
    const upcoming = [
      ...getUpcomingCharges(transactions, new Map(), new Date(), { maxDays: CASH_RISK_DAYS, maxResults: Infinity }),
      ...getUpcomingCardPayments(transactions, new Map(), new Date(), { maxDays: CASH_RISK_DAYS, maxResults: Infinity }),
    ].sort((x, y) => x.daysUntil - y.daysUntil);
    if (upcoming.length > 0) {
      const nearest = upcoming[0];
      if (accountBalance < nearest.amount + CASH_RISK_BUFFER) {
        facts.push({ type: "cashRisk", merchant: nearest.merchant, amount: nearest.amount, daysUntil: nearest.daysUntil, balance: accountBalance });
      }
    }
  }

  if (facts.length > 0) return facts.slice(0, 3);

  // Fallback — top category over ALL synced history, not just this month
  const byCat = {};
  let total = 0;
  transactions.forEach(t => {
    if (t.type !== "expense") return;
    const cat = resolveCategory(t);
    if (cat === "Transfer" || cat === "Transfers") return;
    byCat[cat] = (byCat[cat] || 0) + Number(t.amount);
    total += Number(t.amount);
  });
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return [];
  const [topCat, topAmount] = sorted[0];
  const count = transactions.filter(t => t.type === "expense" && resolveCategory(t) === topCat).length;
  const pct = total > 0 ? Math.round((topAmount / total) * 100) : 0;
  return [{ type: "topCategory", category: topCat, amount: topAmount, pct, count }];
}

function FactCard({ fact, index, t }) {
  const cfg = {
    duplicate:    { icon: "repeat",        color: C.yellow },
    largePayment: { icon: "trending-up",   color: CAT_COLORS[fact.category] || C.purple },
    cashRisk:     { icon: "alert-circle",  color: C.red },
    topCategory:  { icon: "pie-chart",     color: CAT_COLORS[fact.category] || C.cyan },
  }[fact.type];

  let headline, body;
  if (fact.type === "duplicate") {
    headline = `$${fmt(fact.total, 0)}/mo`;
    body = t("onboarding.aha_duplicate_body", { a: fact.a.name, b: fact.b.name, category: tCat(fact.category, t) });
  } else if (fact.type === "largePayment") {
    headline = `$${fmt(fact.amount, 0)}/mo`;
    body = t("onboarding.aha_large_payment_body", { name: fact.name, category: tCat(fact.category, t), pct: fact.pct });
  } else if (fact.type === "cashRisk") {
    headline = t("onboarding.aha_cash_risk_headline", { amount: `$${fmt(fact.amount, 0)}`, days: fact.daysUntil });
    body = t("onboarding.aha_cash_risk_body", { merchant: fact.merchant, balance: `$${fmt(fact.balance, 0)}` });
  } else {
    headline = `$${fmt(fact.amount, 0)}`;
    body = t("onboarding.aha_top_category_body", { category: tCat(fact.category, t), pct: fact.pct, count: fact.count });
  }

  return (
    <div style={{
      display: "flex", gap: 14, padding: "16px", background: C.bgSecondary,
      border: `1px solid ${cfg.color}33`, borderRadius: 18, marginBottom: 12,
      opacity: 0, animation: `ahaCardIn 0.5s ease ${index * 0.18}s forwards`,
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 14, background: cfg.color + "22", border: `1px solid ${cfg.color}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name={cfg.icon} size={20} color={cfg.color} strokeWidth={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {fact.type === "topCategory" && (
          <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 3 }}>
            {t("onboarding.aha_top_category_eyebrow")}
          </div>
        )}
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: -0.3, marginBottom: 4 }}>{headline}</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

export default function AhaMoment({ transactions, onDone }) {
  const { t } = useTranslation();
  const [accountBalance, setAccountBalance] = useState(null);
  const [balanceLoaded, setBalanceLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => { if (!cancelled) setBalanceLoaded(true); }, MAX_WAIT_MS);
    (async () => {
      try {
        let accounts = getCachedAccounts();
        if (!accounts) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            const res = await fetch(`${SUPABASE_URL}/functions/v1/plaid-get-accounts`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}`, "apikey": SUPABASE_KEY },
              body: "{}",
            });
            if (res.ok) {
              const d = await res.json();
              accounts = d.accounts ?? [];
              if (accounts.length) setCachedAccounts(accounts);
            }
          }
        }
        if (!cancelled && accounts?.length) {
          const bal = sumDepositoryBalance(accounts);
          if (bal != null) setAccountBalance(bal);
        }
      } catch { /* balance is best-effort — cashRisk fact just won't fire */ }
      if (!cancelled) { setBalanceLoaded(true); clearTimeout(timeout); }
    })();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  const facts = useMemo(
    () => (balanceLoaded ? computeFacts(transactions, accountBalance) : null),
    [balanceLoaded, transactions, accountBalance]
  );

  // Nothing worth showing (no expense history at all) — skip straight through
  useEffect(() => {
    if (facts !== null && facts.length === 0) onDone();
  }, [facts, onDone]);

  if (!balanceLoaded || facts === null) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT, padding: 24 }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", border: `3px solid ${C.border}`, borderTopColor: C.cyan, animation: "ahaSpin 0.8s linear infinite", marginBottom: 20 }} />
        <div style={{ color: C.muted, fontSize: 14, fontWeight: 500 }}>{t("onboarding.aha_analyzing")}</div>
        <style>{`@keyframes ahaSpin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (facts.length === 0) return null; // onDone() already fired above

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px", fontFamily: FONT }}>
      <style>{`@keyframes ahaCardIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div style={{ width: "100%", maxWidth: 390 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.text, marginBottom: 8, lineHeight: 1.2 }}>{t("onboarding.aha_title")}</div>
          <div style={{ fontSize: 14, color: C.muted }}>{t("onboarding.aha_subtitle")}</div>
        </div>

        {facts.map((fact, i) => <FactCard key={fact.type} fact={fact} index={i} t={t} />)}

        <button
          onClick={onDone}
          style={{ width: "100%", marginTop: 8, padding: 16, background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})`, border: "none", borderRadius: 16, color: "#000", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 24px ${C.cyan}44`, opacity: 0, animation: `ahaCardIn 0.5s ease ${facts.length * 0.18}s forwards` }}
        >
          {t("onboarding.aha_cta")}
        </button>
      </div>
    </div>
  );
}
